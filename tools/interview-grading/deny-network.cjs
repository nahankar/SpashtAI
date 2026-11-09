// Safety guard for this fixed offline Node workflow, not a general OS sandbox.
const { syncBuiltinESMExports } = require('node:module');
const deny = () => { throw new Error('OFFLINE_GRADING_NETWORK_DISABLED: this check must not contact a provider, database or service'); };
for (const name of ['node:http', 'node:https']) {
  const transport = require(name);
  transport.request = deny;
  transport.get = deny;
}
require('node:net').Socket.prototype.connect = deny;
require('node:net').connect = deny;
require('node:net').createConnection = deny;
require('node:tls').connect = deny;
globalThis.fetch = deny;
syncBuiltinESMExports();
