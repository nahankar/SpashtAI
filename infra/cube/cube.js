'use strict';

const { contextToGroups, queryRewrite } = require('./lib/security');
const { databaseConfig, assertRuntimeConfig } = require('./lib/database');

/**
 * SpashtAI AI Analytics Explorer — Cube Core 1.8.5.
 *
 * Production locks live in assertRuntimeConfig: dev mode off, SQL API off,
 * memory cache/queue, JWT secret, and a read-only DATABASE_URL.
 * The official image entrypoint is `cubejs server` (not the dev server).
 */

module.exports = {
  contextToGroups,
  queryRewrite,
  scheduledRefreshTimer: false,
  cacheAndQueueDriver: 'memory',

  driverFactory() {
    assertRuntimeConfig();
    // Provided by the cubejs/cube image. Not required to unit-test this file.
    const { PostgresDriver } = require('@cubejs-backend/postgres-driver');
    return new PostgresDriver(databaseConfig());
  },
};
