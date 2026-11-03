import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium, type Page } from 'playwright'
import { browserArgs } from './browser/launch.js'
import type { TargetKind } from './config.js'

async function waitForToken(page: Page, timeoutMs: number): Promise<boolean> {
  return await page.waitForFunction(() => Boolean(localStorage.getItem('spashtai_token')), null, { timeout: timeoutMs, polling: 500 }).then(() => true, () => false)
}

/**
 * Signs in through the application's own email/password form (/auth/admin also serves non-admin password
 * accounts) and saves the browser storage state. No trace or screenshots are recorded, so the password is
 * never written anywhere.
 */
export async function loginWithForm(opts: { targetUrl: string; email: string; password: string; authFile: string; headed: boolean; channel?: string }): Promise<void> {
  const browser = await chromium.launch({ headless: !opts.headed, channel: opts.channel, args: browserArgs({ muteSpeakers: true }) })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(new URL('/auth/admin', opts.targetUrl).toString())
    await page.getByLabel('Email').fill(opts.email)
    await page.getByLabel('Password').fill(opts.password)
    await page.getByRole('button', { name: 'Sign In' }).click()
    if (!await waitForToken(page, 20_000)) {
      const message = await page.locator('.text-destructive').first().textContent().catch(() => null)
      throw new Error(`Sign-in did not complete${message ? `: ${message.trim()}` : ''}`)
    }
    await page.waitForURL(url => !url.pathname.startsWith('/auth/admin'), { timeout: 20_000 }).catch(() => undefined)
    if (new URL(page.url()).pathname.startsWith('/auth/complete-profile')) throw new Error('The account must complete its profile in the app before it can be used for tests.')
    await save(context, opts.authFile)
  } finally { await browser.close() }
}

/** Opens a visible browser; the owner signs in (e.g. with Google) and the resulting session is saved. */
export async function loginManually(opts: { targetUrl: string; authFile: string; channel?: string; timeoutMs?: number }): Promise<void> {
  const browser = await chromium.launch({ headless: false, channel: opts.channel, args: browserArgs({ muteSpeakers: true }) })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(new URL('/auth/login', opts.targetUrl).toString())
    process.stdout.write('Sign in with the dedicated test account in the opened browser window. Waiting…\n')
    if (!await waitForToken(page, opts.timeoutMs ?? 10 * 60_000)) throw new Error('No sign-in detected before the timeout')
    await page.waitForURL(url => !url.pathname.startsWith('/auth/'), { timeout: 5 * 60_000 })
    await save(context, opts.authFile)
  } finally { await browser.close() }
}

async function save(context: import('playwright').BrowserContext, authFile: string) {
  mkdirSync(dirname(authFile), { recursive: true, mode: 0o700 })
  await context.storageState({ path: authFile })
  chmodSync(authFile, 0o600)
}

/**
 * One-time creation of a fictional password test account on a LOCAL stack through the public register API.
 * The learner UI only offers Google sign-up, so this is account provisioning, not part of any test run.
 */
export async function registerLocalAccount(opts: { apiUrl: string; email: string; password: string; targetKind: TargetKind }): Promise<string> {
  if (opts.targetKind !== 'local' || !['localhost', '127.0.0.1'].includes(new URL(opts.apiUrl).hostname)) {
    throw new Error('Account creation is limited to local development stacks.')
  }
  const res = await fetch(new URL('/api/auth/register', opts.apiUrl), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: opts.email, password: opts.password, firstName: 'Voice', lastName: 'Candidate (test)',
      phone: '9000000001', dateOfBirth: '1995-01-01', gender: 'FEMALE', pincode: '560001', acceptedTerms: true }),
    signal: AbortSignal.timeout(20_000),
  })
  const body = await res.json().catch(() => ({})) as { error?: string }
  if (res.status === 409 || /exist/i.test(body.error ?? '')) return 'account already exists'
  if (!res.ok) throw new Error(`Registration failed: HTTP ${res.status} ${body.error ?? ''}`)
  return 'account created'
}
