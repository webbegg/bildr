import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

let calls = 0
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return {
    ...fs,
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      if (++calls === 10) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
      return fs.writeFileSync(...args)
    }
  }
})

// The manifest is written last: a run that fails partway never claims files it didn't write.
it('a failure partway leaves no manifest and rethrows', async () => {
  const { createProject } = await import('../src/create')
  const root = mkdtempSync(join(tmpdir(), 'create-bildr-int-'))
  try {
    expect(() => createProject(join(root, 'app'), { name: 'X' })).toThrow('ENOSPC')
    expect(existsSync(join(root, 'app/.bildr/manifest.json'))).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
