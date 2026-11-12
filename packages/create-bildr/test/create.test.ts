import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadModel } from '@bildr/codegen/model'
import { detectStarterKit } from '@bildr/codegen/starter'
import { planSync } from '@bildr/codegen/sync'
import { parseArgs } from '../src/cli'
import { createProject } from '../src/create'

const hash = (content: string) => createHash('sha256').update(content).digest('hex')

describe('createProject', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'create-bildr-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('writes the starter kit, the model and the manifest last', () => {
    const dir = join(root, 'acme')
    const result = createProject(dir, { name: 'Acme' })
    const read = (path: string) => existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8') : undefined

    expect(detectStarterKit(read)).toEqual({ ok: true })
    expect(result.files).toContain('layers/core/server/utils/db.ts')
    expect(result.files.at(-1)).toBe('.bildr/manifest.json')

    const model = loadModel(Object.fromEntries(result.files.filter(path => path.startsWith('.bildr/')).map(path => [path, read(path)!])))
    expect(model.ok ? [] : model.problems).toEqual([])
    if (!model.ok) return
    const manifest = model.model.manifest!.files
    // Every written file is recorded with its real hash, so a later sync of the same kit is a no-op.
    for (const [path, entry] of Object.entries(manifest)) expect(entry.sha256, path).toBe(hash(read(path)!))
    expect(Object.keys(manifest)).not.toContain('.bildr/bildr.json')
  })

  it('writes exactly the golden starter tree', () => {
    const dir = join(root, 'acme')
    createProject(dir, { name: 'Acme' })
    const list = (base: string, prefix = ''): string[] => readdirSync(join(base, prefix), { withFileTypes: true })
      .flatMap(entry => entry.isDirectory() ? list(base, join(prefix, entry.name)) : [join(prefix, entry.name)])
    expect(list(dir).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)).toEqual([
      '.bildr/bildr.json', '.bildr/datasources/main.json', '.bildr/layouts/main.json', '.bildr/manifest.json',
      '.bildr/modules/main/module.json', '.bildr/modules/main/pages/index.json', '.bildr/theme.json',
      '.env.example', '.gitignore', 'README.md', 'app/README.md', 'drizzle.config.ts', 'eslint.config.mjs',
      'layers/core/app/app.config.ts', 'layers/core/app/app.vue', 'layers/core/app/assets/css/theme.css',
      'layers/core/app/data/query-client.ts', 'layers/core/app/error.vue', 'layers/core/app/layouts/main.vue',
      'layers/core/app/utils/errorMessage.ts', 'layers/core/nuxt.config.ts', 'layers/core/server/plugins/migrate.ts',
      'layers/core/server/utils/db.ts', 'layers/core/server/utils/http-error.ts', 'layers/core/server/utils/remote.ts',
      'layers/core/shared/kernel/ids.ts', 'layers/core/shared/kernel/page.ts', 'layers/core/shared/kernel/result.ts',
      'layers/main/app/pages/index.vue', 'layers/main/nuxt.config.ts', 'layers/main/shared/domain/errors.ts',
      'nuxt.config.ts', 'package.json', 'pnpm-workspace.yaml', 'server/README.md', 'tsconfig.json', 'vitest.config.ts'
    ])
  })

  it('creates into an empty existing directory, refuses a non-empty one', () => {
    const empty = join(root, 'empty')
    mkdirSync(empty)
    expect(() => createProject(empty, { name: 'X' })).not.toThrow()
    const busy = join(root, 'busy')
    mkdirSync(busy)
    writeFileSync(join(busy, 'keep.txt'), 'mine')
    expect(() => createProject(busy, { name: 'X' })).toThrow(`${busy} is not empty: bildr creates new projects only`)
    expect(readFileSync(join(busy, 'keep.txt'), 'utf8')).toBe('mine')
  })

  it('re-syncing the created kit changes nothing', () => {
    const dir = join(root, 'acme')
    createProject(dir, { name: 'Acme', module: 'sales' })
    const manifest = JSON.parse(readFileSync(join(dir, '.bildr/manifest.json'), 'utf8')).files
    const files = Object.keys(manifest)
    const plan = planSync({
      generated: files.map(path => ({ path, content: readFileSync(join(dir, path), 'utf8'), owner: manifest[path].owner })),
      manifest,
      disk: Object.fromEntries(files.map(path => [path, hash(readFileSync(join(dir, path), 'utf8'))])),
      hash
    })
    expect(plan.writes).toEqual([])
    expect(plan.deletes).toEqual([])
  })
})

describe('parseArgs', () => {
  it('reads the directory, --name and --module', () => {
    expect(parseArgs(['my-app'])).toEqual({ dir: 'my-app', name: 'My App', module: 'main' })
    expect(parseArgs(['crm', '--name', 'Acme CRM', '--module', 'sales'])).toEqual({ dir: 'crm', name: 'Acme CRM', module: 'sales' })
    expect(parseArgs(['--name=Shop', 'shop'])).toEqual({ dir: 'shop', name: 'Shop', module: 'main' })
    // --bildr: where to install @bildr/nuxt from (a local link until it is published).
    expect(parseArgs(['shop', '--bildr', 'link:/src/bildr/packages/nuxt'])).toEqual({ dir: 'shop', name: 'Shop', module: 'main', bildr: 'link:/src/bildr/packages/nuxt' })
  })

  it('explains the usage when the directory is missing or an option is unknown', () => {
    expect(() => parseArgs([])).toThrow('Usage: pnpm create bildr <directory> [--name "Project name"] [--module main] [--bildr <@bildr/nuxt version or link:path>]')
    expect(() => parseArgs(['x', '--force'])).toThrow('Unknown option --force')
  })
})
