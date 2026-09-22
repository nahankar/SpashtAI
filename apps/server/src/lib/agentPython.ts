import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const agentDir = join(dirname(fileURLToPath(import.meta.url)), '../../../agent')

/**
 * Interpreter that has the agent's audio dependencies (numpy, parselmouth).
 * `.venv` is what infra/ec2/deploy.sh builds on EC2; `.venv312` is the local
 * dev venv. Bare `python3` is a last resort and usually lacks these packages.
 */
export function resolveAgentPython(): string {
  const candidates = [
    process.env.AGENT_PYTHON,
    join(agentDir, '.venv/bin/python'),
    join(agentDir, '.venv312/bin/python'),
  ].filter((candidate): candidate is string => Boolean(candidate))

  return candidates.find((candidate) => existsSync(candidate)) ?? 'python3'
}
