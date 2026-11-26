import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error -- plain .mjs harness, no types
import { boot } from '../../e2e/module/lib.mjs'

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
})
