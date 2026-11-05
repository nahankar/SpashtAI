import { createRequire } from 'node:module'

// supertest's request(app) listens on port 0 without a host (the IPv6 wildcard [::]:P) and then connects to
// 127.0.0.1:P. On macOS another process holding an IPv4-only socket on that ephemeral port receives the
// connection instead, so tests intermittently saw a foreign server's response (e.g. Express's HTML 404, 401,
// 409) or a reset. Connect over IPv6 loopback to the wildcard listener supertest just created. Test-only.
const Test = createRequire(import.meta.url)('supertest/lib/test.js') as {
  prototype: { serverAddress(app: { address(): { address: string; port: number } | null; listen(port: number): unknown }, path: string): string }
}
const original = Test.prototype.serverAddress
Test.prototype.serverAddress = function serverAddress(this: { _server?: unknown }, app, path) {
  const url = original.call(this, app, path)
  const bound = app.address()
  return bound && bound.address === '::' ? url.replace('://127.0.0.1:', '://[::1]:') : url
}
