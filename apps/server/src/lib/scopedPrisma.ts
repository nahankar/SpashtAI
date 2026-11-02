import type { Prisma, PrismaClient } from '@prisma/client'
import { currentDataScope, runWithDataScope, type DataScope } from './dataScope'

const RAW = Symbol('scopedPrismaRaw')
const RAW_METHODS = new Set(['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe'])
type AnyPromise = Prisma.PrismaPromise<unknown>
type Deferred = PromiseLike<unknown> & { [RAW]: AnyPromise; catch: Promise<unknown>['catch']; finally: Promise<unknown>['finally'] }

function contextStatement(base: PrismaClient, scope: DataScope) {
  // Transaction-local (third argument true): a pooled connection never keeps a tenant.
  return base.$executeRaw`SELECT set_config('app.workspace_actor_id', ${scope.actorId}, true),
    set_config('app.workspace_id', ${scope.workspaceId}, true),
    set_config('app.workspace_platform_admin', 'false', true),
    set_config('app.workspace_reader', ${scope.reader ?? ''}, true)`
}

export async function applyDataScope(tx: Prisma.TransactionClient, scope: DataScope) {
  await tx.$executeRaw`SELECT set_config('app.workspace_actor_id', ${scope.actorId}, true),
    set_config('app.workspace_id', ${scope.workspaceId}, true),
    set_config('app.workspace_platform_admin', 'false', true),
    set_config('app.workspace_reader', ${scope.reader ?? ''}, true)`
}

/** Executes one lazy Prisma operation inside a short transaction that first establishes the scope. */
function deferred(base: PrismaClient, scope: DataScope, raw: AnyPromise): Deferred {
  let running: Promise<unknown> | undefined
  const run = () => (running ??= base.$transaction([contextStatement(base, scope), raw]).then(results => results[1]))
  return {
    [RAW]: raw,
    then: (onFulfilled, onRejected) => run().then(onFulfilled, onRejected),
    catch: onRejected => run().catch(onRejected),
    finally: onFinally => run().finally(onFinally),
  }
}

function delegateProxy(base: PrismaClient, delegate: object) {
  return new Proxy(delegate, {
    get(target, property) {
      const value = Reflect.get(target, property)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        const scope = currentDataScope()
        const raw = value.apply(target, args) as AnyPromise
        return scope ? deferred(base, scope, raw) : raw
      }
    },
  })
}

/**
 * Wraps the shared client so every operation issued while an organization scope
 * is active runs with transaction-local workspace settings, which PostgreSQL row
 * policies enforce. Without a scope the client is untouched (Personal behaviour).
 */
export function createScopedPrisma<T extends PrismaClient>(base: T): T {
  const delegates = new Map<PropertyKey, object>()
  // Assignments (for example test spies) stay on the wrapper; the underlying client is never mutated.
  const overrides = new Map<PropertyKey, PropertyDescriptor>()
  return new Proxy(base, {
    set(_target, property, value) {
      overrides.set(property, { value, writable: true, configurable: true, enumerable: true })
      return true
    },
    defineProperty(_target, property, descriptor) {
      overrides.set(property, { configurable: true, enumerable: true, ...descriptor })
      return true
    },
    deleteProperty(_target, property) {
      overrides.delete(property)
      return true
    },
    getOwnPropertyDescriptor(target, property) {
      return overrides.get(property) ?? Reflect.getOwnPropertyDescriptor(target, property)
    },
    get(target, property) {
      const override = overrides.get(property)
      if (override) return override.get ? override.get.call(target) : override.value
      const value = Reflect.get(target, property)
      if (!currentDataScope()) return typeof value === 'function' ? value.bind(target) : value
      if (property === '$transaction') {
        return (input: unknown, options?: Parameters<PrismaClient['$transaction']>[1]) => {
          const scope = currentDataScope()!
          if (typeof input === 'function') {
            return target.$transaction(async tx => {
              await applyDataScope(tx, scope)
              return runWithDataScope(scope, () => (input as (tx: Prisma.TransactionClient) => Promise<unknown>)(tx))
            }, options as never)
          }
          const items = (input as Array<AnyPromise | Deferred>).map(item => (item as Deferred)[RAW] ?? item)
          return target.$transaction([contextStatement(target, scope), ...items], options as never)
            .then(results => results.slice(1))
        }
      }
      if (typeof property === 'string' && RAW_METHODS.has(property)) {
        return (...args: unknown[]) => deferred(target, currentDataScope()!, (value as (...a: unknown[]) => AnyPromise).apply(target, args))
      }
      if (typeof value === 'function') return value.bind(target)
      if (value && typeof value === 'object' && typeof property === 'string' && !property.startsWith('$') && !property.startsWith('_')
        && typeof (value as { findMany?: unknown }).findMany === 'function') {
        if (!delegates.has(property)) delegates.set(property, delegateProxy(target, value))
        return delegates.get(property)
      }
      return value
    },
  })
}
