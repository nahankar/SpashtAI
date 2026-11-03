import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { redact } from '../redact.js'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const file = join(dir, name)
    return statSync(file).isDirectory() ? walk(file) : [file]
  })
}

/**
 * Playwright traces record request/response headers and bodies (auth tokens, LiveKit tokens). Every text
 * entry in the archive is redacted and the archive is rebuilt. Returns the number of entries changed.
 */
export function redactTraceArchive(zipPath: string, secrets: string[]): number {
  const dir = mkdtempSync(join(tmpdir(), 'vtc-trace-'))
  try {
    execFileSync('unzip', ['-q', zipPath, '-d', dir])
    let changed = 0
    for (const file of walk(dir)) {
      const data = readFileSync(file)
      if (data.subarray(0, 2048).includes(0)) continue
      const text = data.toString('utf8')
      const clean = redact(text, secrets)
      if (clean !== text) { writeFileSync(file, clean); changed++ }
    }
    rmSync(zipPath)
    execFileSync('zip', ['-qr', zipPath, '.'], { cwd: dir })
    return changed
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
