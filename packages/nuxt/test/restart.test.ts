import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../../create-bildr/src/create'
import { regenerate } from '../src/node/regenerate'
import { createRestarter, needsRestart } from '../src/node/restart'
import type { RestartRequest } from '../src/node/restart'

const none = { written: [], removed: [] }

// L9: Nuxt reads nuxt.config files (the project's and each layer's) only when it starts.
describe('needsRestart', () => {
  it('is not needed when nothing Nuxt reads at startup changed', () => {
    expect(needsRestart(none, ['core', 'blog'])).toBeUndefined()
    expect(needsRestart({ written: ['layers/blog/app/pages/index.vue', 'layers/core/app/app.config.ts', 'layers/blog/server/api/blog/posts/index.get.ts', '.env.example'], removed: ['layers/blog/app/components/Old.vue'] }, ['core', 'blog'])).toBeUndefined()
  })

  it('restarts in place when a loaded layer rewrites its nuxt.config', () => {
    expect(needsRestart({ written: ['layers/core/nuxt.config.ts', 'layers/core/server/utils/http-error.ts'], removed: [] }, ['core', 'blog']))
      .toEqual({ hard: false, files: ['layers/core/nuxt.config.ts'] })
  })

  it('restarts when the project config files change', () => {
    expect(needsRestart({ written: ['nuxt.config.ts'], removed: [] }, ['core'])).toEqual({ hard: false, files: ['nuxt.config.ts'] })
    expect(needsRestart({ written: ['.nuxtrc'], removed: ['.nuxtignore'] }, ['core'])).toEqual({ hard: false, files: ['.nuxtrc', '.nuxtignore'] })
    expect(needsRestart({ written: ['layers/core/nuxt.config.mjs'], removed: [] }, ['core'])).toEqual({ hard: false, files: ['layers/core/nuxt.config.mjs'] })
  })

  it('restarts the process when the set of layers changes', () => {
    // A layer Nuxt didn't load (created by this regenerate).
    expect(needsRestart({ written: ['layers/shop/app/pages/index.vue', 'layers/shop/nuxt.config.ts'], removed: [] }, ['core']))
      .toEqual({ hard: true, files: ['layers/shop/nuxt.config.ts'] })
    expect(needsRestart({ written: ['layers/shop/app/pages/index.vue'], removed: [] }, ['core']))
      .toEqual({ hard: true, files: ['layers/shop/app/pages/index.vue'] })
    // A layer that goes.
    expect(needsRestart({ written: [], removed: ['layers/blog/nuxt.config.ts', 'layers/blog/app/pages/index.vue'] }, ['core', 'blog']))
      .toEqual({ hard: true, files: ['layers/blog/nuxt.config.ts'] })
  })

  it('ignores lookalikes that Nuxt reads on the fly', () => {
    expect(needsRestart({ written: ['layers/core/app/nuxt.config.ts', 'layers/core/nuxt.config.ts.bak', 'app/nuxt.config.json'], removed: [] }, ['core'])).toBeUndefined()
  })
})

/** A stand-in for the `restart` hook and the logger. */
const harness = () => {
  const restarts: Array<{ hard: boolean }> = []
  const logs: string[] = []
  const restarter = createRestarter({ restart: (options) => {
    restarts.push(options)
  }, log: message => logs.push(message) })
  return { restarts, logs, restarter }
}

describe('createRestarter', () => {
  const config: RestartRequest = { hard: false, files: ['layers/core/nuxt.config.ts'] }

  it('waits for the first build before restarting (nuxi hooks `restart` only once Nuxt is ready)', () => {
    const { restarts, logs, restarter } = harness()
    restarter.request(config)
    expect(restarts).toEqual([])
    restarter.built()
    expect(restarts).toEqual([{ hard: false }])
    expect(logs).toEqual(['bildr: config changed, restarting Nuxt\n  - layers/core/nuxt.config.ts'])
  })

  it('restarts at once after the first build, and only once per Nuxt instance', () => {
    const { restarts, logs, restarter } = harness()
    restarter.built()
    restarter.request(undefined)
    expect(restarts).toEqual([])
    restarter.request(config)
    restarter.request({ hard: true, files: ['layers/shop/nuxt.config.ts'] })
    restarter.built()
    expect(restarts).toEqual([{ hard: false }])
    expect(logs).toHaveLength(1)
  })

  it('merges requests made before the first build: one restart, hard when any of them is', () => {
    const { restarts, logs, restarter } = harness()
    restarter.request(config)
    restarter.request({ hard: true, files: ['layers/shop/nuxt.config.ts'] })
    restarter.built()
    expect(restarts).toEqual([{ hard: true }])
    expect(logs).toEqual(['bildr: config changed, restarting Nuxt\n  - layers/core/nuxt.config.ts\n  - layers/shop/nuxt.config.ts'])
  })
})

// The restart re-runs the module setup, which regenerates again: that one must change nothing, or Nuxt would loop.
describe('a regenerate that changes a layer config', { timeout: 60_000 }, () => {
  let root: string
  let dir: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bildr-restart-'))
    dir = join(root, 'app')
    createProject(dir, { name: 'App' })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('asks for one restart, and the regenerate after it asks for none', async () => {
    writeFileSync(join(dir, '.bildr/datasources/quotes.json'), JSON.stringify({
      $schema: 'https://bildr.dev/schema/datasource.v1.json',
      id: 'ds_quotes',
      name: 'quotes',
      kind: 'rest',
      env: { baseUrl: 'NUXT_DATASOURCES_QUOTES_BASE_URL', apiKey: 'NUXT_DATASOURCES_QUOTES_API_KEY' },
      defaults: { baseUrl: 'https://dummyjson.com' },
      auth: { type: 'bearer', secret: 'apiKey' }
    }, null, 2))
    const first = await regenerate(dir)
    if (!first.ok) throw new Error(JSON.stringify(first))
    expect(needsRestart(first.report, ['core', 'main'])).toEqual({ hard: false, files: ['layers/core/nuxt.config.ts'] })

    const second = await regenerate(dir)
    if (!second.ok) throw new Error(JSON.stringify(second))
    expect(second.report.written).toEqual([])
    expect(needsRestart(second.report, ['core', 'main'])).toBeUndefined()
  })
})
