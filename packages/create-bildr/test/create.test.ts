import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadModel } from '@bildr/codegen/model'
import { detectStarterKit } from '@bildr/codegen/starter'
import { planSync } from '@bildr/codegen/sync'
import { parseArgs } from '../src/cli'
import { createProject, defaultBildrNuxt } from '../src/create'

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
      'layers/main/app/pages/index.vue', 'layers/main/nuxt.config.ts', 'layers/main/server/utils/main.ts', 'layers/main/shared/domain/errors.ts',
      'nuxt.config.ts', 'package.json', 'pnpm-workspace.yaml', 'server/README.md', 'tsconfig.json', 'vitest.config.ts'
    ])
  })

  it('--database none: an API-only project with no database files or dependencies', () => {
    const dir = join(root, 'api')
    const result = createProject(dir, { name: 'Api', database: 'none' })
    const read = (path: string) => existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8') : undefined
    expect(detectStarterKit(read)).toEqual({ ok: true })
    for (const path of ['.bildr/datasources/main.json', 'layers/core/server/utils/db.ts', 'layers/core/server/plugins/migrate.ts', 'drizzle.config.ts', 'server/database/migrations']) {
      expect(existsSync(join(dir, path)), path).toBe(false)
    }
    expect(result.files.filter(path => /(from|import\(|require\()\s*['"](drizzle-orm|drizzle-kit|@libsql)/.test(read(path)!))).toEqual([])
    const pkg = JSON.parse(read('package.json')!) as { dependencies: object, devDependencies: object }
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(name => /drizzle|libsql/.test(name))).toEqual([])
  })

  it('depends on the published @bildr/nuxt of the same version when it runs from the built package', () => {
    const own = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(own.version).toBe('0.1.0')
    // dist/create.js is where the published bin's module lives; package.json is one level up from it, as from src/.
    expect(defaultBildrNuxt(new URL('../dist/create.js', import.meta.url).href)).toBe('^0.1.0')
    // From this checkout's sources: the local package, so tests and e2e install it unpublished.
    expect(defaultBildrNuxt(new URL('../src/create.ts', import.meta.url).href)).toBe(`link:${fileURLToPath(new URL('../../nuxt', import.meta.url)).replace(/\/$/, '')}`)
  })

  it('links the local @bildr/nuxt by default when it runs from this checkout, so the project installs', () => {
    const dir = join(root, 'acme')
    createProject(dir, { name: 'Acme' })
    const spec = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).devDependencies['@bildr/nuxt'] as string
    expect(spec).toBe(`link:${fileURLToPath(new URL('../../nuxt', import.meta.url)).replace(/\/$/, '')}`)
    createProject(join(root, 'given'), { name: 'Given', bildrNuxt: '^9.9.9' })
    expect(JSON.parse(readFileSync(join(root, 'given/package.json'), 'utf8')).devDependencies['@bildr/nuxt']).toBe('^9.9.9')
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

  it('reads --database sqlite|none and refuses anything else', () => {
    expect(parseArgs(['api', '--database', 'none'])).toEqual({ dir: 'api', name: 'Api', module: 'main', database: 'none' })
    expect(parseArgs(['app', '--database=sqlite'])).toEqual({ dir: 'app', name: 'App', module: 'main', database: 'sqlite' })
    expect(() => parseArgs(['app', '--database', 'postgres'])).toThrow('--database: use sqlite or none')
  })

  it('refuses empty option values instead of silently using defaults', () => {
    expect(() => parseArgs(['shop', '--bildr='])).toThrow('--bildr needs a value')
    expect(() => parseArgs(['shop', '--bildr', ''])).toThrow('--bildr needs a value')
    expect(() => parseArgs(['shop', '--module='])).toThrow('--module needs a value')
    expect(() => parseArgs(['shop', '--bildr', '  '])).toThrow('--bildr needs a value')
  })

  it('explains the usage when the directory is missing or an option is unknown', () => {
    expect(() => parseArgs([])).toThrow('Usage: pnpm create bildr <directory> [--name "Project name"] [--module main] [--database sqlite|none] [--bildr <@bildr/nuxt version or link:path>]')
    expect(() => parseArgs(['x', '--force'])).toThrow('Unknown option --force')
  })
})
