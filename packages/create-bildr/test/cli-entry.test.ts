import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'create-bildr-bin-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

// Package managers install a bin as a symlink; the CLI must run through it.
it('runs when invoked through a bin symlink', () => {
  const link = join(root, 'create-bildr')
  symlinkSync(cli, link)
  const run = spawnSync(process.execPath, [link, 'app'], { cwd: root, encoding: 'utf8' })
  expect(run.status, run.stderr).toBe(0)
  expect(existsSync(join(root, 'app/.bildr/manifest.json'))).toBe(true)
  const usage = spawnSync(process.execPath, [link], { cwd: root, encoding: 'utf8' })
  expect(usage.status).toBe(1)
  expect(usage.stderr).toContain('Usage: pnpm create bildr <directory>')
})

// `import.meta.main` is true only for the entry module (it is how the Bun binary starts), never for an imported one.
it('does not run main when the module is only imported', () => {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(cli).href)})`], { cwd: root, encoding: 'utf8' })
  expect(run.status, run.stderr).toBe(0)
  expect(run.stderr).toBe('')
  expect(run.stdout).toBe('')
})

it('explains a target that is an existing file', () => {
  writeFileSync(join(root, 'taken'), 'x')
  const run = spawnSync(process.execPath, [cli, 'taken'], { cwd: root, encoding: 'utf8' })
  expect(run.status).toBe(1)
  expect(run.stderr).toContain(`${join(root, 'taken')} exists and is not a directory`)
})
