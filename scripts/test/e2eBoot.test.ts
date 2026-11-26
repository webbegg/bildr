import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error -- plain .mjs harness, no types
import { app, boot, discardBoot } from '../../e2e/module/lib.mjs'

const LIB = new URL('../../e2e/module/lib.mjs', import.meta.url).href

describe('e2e module boot', () => {
  let parent: string | undefined

  afterEach(() => {
    vi.unstubAllEnvs()
    if (parent) rmSync(parent, { recursive: true, force: true })
  })

  it('deletes its project dir when the project fails to start', async () => {
    parent = mkdtempSync(join(tmpdir(), 'bildr-boot-test-'))
    vi.stubEnv('E2E_TMP', parent)
    vi.stubEnv('E2E_KEEP', '')
    // An invalid Node flag makes the create-bildr child exit at once.
    vi.stubEnv('NODE_OPTIONS', '--no-such-node-flag')

    await expect(boot()).rejects.toThrow(/create-bildr failed/)
    expect(readdirSync(parent)).toEqual([])
  })

  it('lets the process exit right after a failed boot (no timer left behind)', async () => {
    parent = mkdtempSync(join(tmpdir(), 'bildr-boot-test-'))
    // The env is set inside the child, after it started: NODE_OPTIONS only breaks its create-bildr child.
    const script = `process.env.E2E_TMP = ${JSON.stringify(parent)}; process.env.NODE_OPTIONS = '--no-such-node-flag'
const { boot } = await import(${JSON.stringify(LIB)})
await boot().catch(() => {})`
    const startedAt = Date.now()
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, E2E_KEEP: '' } })
    expect(Date.now() - startedAt).toBeLessThan(15_000)
  }, 90_000)

  it('forgets the project of a discarded boot', async () => {
    parent = mkdtempSync(join(tmpdir(), 'bildr-boot-test-'))
    const tmp = join(parent, 'bildr-e2e-module-x')
    mkdirSync(join(tmp, 'app'), { recursive: true })
    Object.assign(app, { base: 'http://127.0.0.1:1', token: 't', root: join(tmp, 'app'), log: join(tmp, 'dev.log') })

    await discardBoot(tmp, { started: [], keep: false })

    expect(app).toEqual({ base: '', token: '', root: '', log: '' })
    expect(readdirSync(parent)).toEqual([])
  })

  it('leaves an attached project alone when it discards its own', async () => {
    parent = mkdtempSync(join(tmpdir(), 'bildr-boot-test-'))
    const tmp = join(parent, 'bildr-e2e-module-x')
    mkdirSync(tmp)
    const attached = { base: 'http://127.0.0.1:2', token: 'u', root: '/elsewhere/app', log: '' }
    Object.assign(app, attached)

    await discardBoot(tmp, { started: [], keep: false })

    expect(app).toEqual(attached)
  })
})
