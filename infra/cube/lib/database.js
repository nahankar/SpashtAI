'use strict';

/**
 * Read-only Postgres settings derived from DATABASE_URL.
 * The Cube Postgres driver also defaults readOnly to true, which blocks
 * Cube-initiated DDL. The session GUC blocks writes even when the role
 * itself can write. Prefer a SELECT-only role in DATABASE_URL.
 */

function databaseConfig(env = process.env) {
  const raw = env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is required');

  let url;
  try {
    url = new URL(raw);
  } catch (error) {
    throw new Error('DATABASE_URL is not a valid PostgreSQL URL');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must be a postgres URL');
  }

  let host = url.hostname;
  if (!host) throw new Error('DATABASE_URL must include a host');
  if (env.CUBE_IN_DOCKER === 'true' && (host === 'localhost' || host === '127.0.0.1' || host === '::1')) {
    host = 'host.docker.internal';
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL must include a database name');

  const schema = url.searchParams.get('schema');
  const options = ['-c default_transaction_read_only=on'];
  if (schema) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
      throw new Error('DATABASE_URL schema must be a simple identifier');
    }
    options.push(`-c search_path=${schema}`);
  }

  const config = {
    host,
    port: url.port || '5432',
    user: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || ''),
    database,
    application_name: 'spashtai-cube',
    options: options.join(' '),
    readOnly: true,
  };

  const sslmode = (url.searchParams.get('sslmode') || '').toLowerCase();
  if (sslmode && sslmode !== 'disable' && sslmode !== 'allow' && sslmode !== 'prefer') {
    const verify = sslmode === 'verify-ca' || sslmode === 'verify-full';
    config.ssl = { rejectUnauthorized: verify };
  } else if (env.CUBEJS_DB_SSL === 'true') {
    config.ssl = { rejectUnauthorized: env.CUBEJS_DB_SSL_REJECT_UNAUTHORIZED !== 'false' };
  }

  return config;
}

function assertRuntimeConfig(env = process.env) {
  if (env.CUBEJS_DEV_MODE !== 'false') {
    throw new Error('CUBEJS_DEV_MODE must be false');
  }
  if (env.CUBEJS_PG_SQL_PORT) {
    throw new Error('SQL API is disabled; unset CUBEJS_PG_SQL_PORT');
  }
  if (!env.CUBEJS_API_SECRET) {
    throw new Error('CUBEJS_API_SECRET is required');
  }
  if ((env.CUBEJS_CACHE_AND_QUEUE_DRIVER || 'memory') !== 'memory') {
    throw new Error('CUBEJS_CACHE_AND_QUEUE_DRIVER must stay memory until Cube Store is introduced');
  }
  databaseConfig(env);
}

module.exports = {
  databaseConfig,
  assertRuntimeConfig,
};
