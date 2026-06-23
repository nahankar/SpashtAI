/** @type {import('pm2').StartOptions[]} */
const path = require('path')

const root = path.resolve(__dirname, '../../..')

module.exports = {
  apps: [
    {
      name: 'spashtai-api',
      cwd: path.join(root, 'apps/server'),
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
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
      interpreter: path.join(root, 'apps/agent/.venv312/bin/python'),
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
