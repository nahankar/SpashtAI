const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const guard = path.join(__dirname, 'deny-network.cjs');
for (const expression of [
  "require('node:http').get('http://127.0.0.1:1')",
  "require('node:https').request('https://example.invalid')",
  "require('node:net').createConnection(1, '127.0.0.1')",
  "new (require('node:net').Socket)().connect(1, '127.0.0.1')",
  "require('node:tls').connect(1, '127.0.0.1')",
  "fetch('https://example.invalid')",
]) {
  test(`rejects before connection: ${expression}`, () => {
    const child = spawnSync(process.execPath, ['--require', guard, '-e', expression], {
      timeout: 5000, encoding: 'utf8', env: { PATH: process.env.PATH },
    });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /OFFLINE_GRADING_NETWORK_DISABLED/);
  });
}
