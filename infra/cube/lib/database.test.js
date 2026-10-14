'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseConfig, assertRuntimeConfig } = require('./database');

test('databaseConfig parses DATABASE_URL into a read-only session', () => {
  const config = databaseConfig({
    DATABASE_URL: 'postgresql://cube_reader:p%40ss@db.internal:5432/spashtai?sslmode=require&schema=public',
  });
  assert.equal(config.host, 'db.internal');
  assert.equal(config.port, '5432');
  assert.equal(config.user, 'cube_reader');
  assert.equal(config.password, 'p@ss');
  assert.equal(config.database, 'spashtai');
  assert.equal(config.readOnly, true);
  assert.match(config.options, /default_transaction_read_only=on/);
  assert.match(config.options, /search_path=public/);
  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
  assert.equal(config.application_name, 'spashtai-cube');
});

test('localhost is rewritten only inside Docker', () => {
  const url = { DATABASE_URL: 'postgresql://reader:secret@127.0.0.1:5432/spashtai' };
  assert.equal(databaseConfig(url).host, '127.0.0.1');
  assert.equal(databaseConfig({ ...url, CUBE_IN_DOCKER: 'true' }).host, 'host.docker.internal');
});

test('verify-full checks the server certificate', () => {
  const config = databaseConfig({
    DATABASE_URL: 'postgresql://reader:secret@db.internal/spashtai?sslmode=verify-full',
  });
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test('runtime config fails closed', () => {
  const valid = {
    CUBEJS_DEV_MODE: 'false',
    CUBEJS_API_SECRET: 'test-secret',
    CUBEJS_CACHE_AND_QUEUE_DRIVER: 'memory',
    DATABASE_URL: 'postgresql://reader:secret@db.internal/spashtai',
  };
  assert.doesNotThrow(() => assertRuntimeConfig(valid));
  assert.throws(() => assertRuntimeConfig({ ...valid, CUBEJS_DEV_MODE: 'true' }), /CUBEJS_DEV_MODE/);
  assert.throws(() => assertRuntimeConfig({ ...valid, CUBEJS_PG_SQL_PORT: '15432' }), /SQL API/);
  assert.throws(() => assertRuntimeConfig({ ...valid, CUBEJS_CACHE_AND_QUEUE_DRIVER: 'cubestore' }), /memory/);
  assert.throws(() => assertRuntimeConfig({ ...valid, DATABASE_URL: 'mysql://db/app' }), /postgres URL/);
});
