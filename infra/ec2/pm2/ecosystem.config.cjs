/** @type {import('pm2').StartOptions[]} */
const path = require('path')

const root = path.resolve(__dirname, '../../..')
// Explicitly refresh runtime tenancy settings from the protected file on every deploy.
// Never load the separate deployment/migration credential file into an API process.
const fs = require('fs')
const serverEnv = require('dotenv').parse(fs.readFileSync(path.join(root, 'apps/server/.env')))
const workspaceRuntimeEnv = Object.fromEntries(['DATABASE_URL', 'WORKSPACES_ENABLED', 'WORKSPACE_SESSION_ARCHIVE_ENABLED']
  .filter(key => Object.hasOwn(serverEnv, key)).map(key => [key, serverEnv[key]]))

module.exports = {
  apps: [
    {
      name: 'spashtai-api',
      cwd: path.join(root, 'apps/server'),
      // tsc output omits .js extensions; tsx runs TypeScript directly in production
      script: path.join(root, 'node_modules/.bin/tsx'),
      args: 'src/index.ts',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        ...workspaceRuntimeEnv,
      },
      max_memory_restart: '512M',
      error_file: path.join(root, 'logs/spashtai-api-error.log'),
      out_file: path.join(root, 'logs/spashtai-api-out.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: 'spashtai-agent',
      cwd: path.join(root, 'apps/agent'),
      script: 'main.py',
      args: 'start',
      interpreter: path.join(root, 'apps/agent/.venv/bin/python'),
      instances: 1,
      exec_mode: 'fork',
      env: {
        PYTHONUNBUFFERED: '1',
      },
      max_memory_restart: '1G',
      error_file: path.join(root, 'logs/spashtai-agent-error.log'),
      out_file: path.join(root, 'logs/spashtai-agent-out.log'),
      merge_logs: true,
      time: true,
    },
  ],
}
