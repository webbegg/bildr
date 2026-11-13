import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadModel } from '../../src/model/load'
import { STARTER_CORE_FILES, STARTER_ROOT_FILES, detectStarterKit, starterKit } from '../../src/starter/index'
import { isSafeProjectPath, planSync } from '../../src/sync/plan'
import { fixtureRoot } from '../model/fixture'

const hash = (content: string) => createHash('sha256').update(content).digest('hex')
const fixtureFile = (path: string) => readFileSync(join(fixtureRoot, path), 'utf8')
const fixtureFileOrUndefined = (path: string) => existsSync(join(fixtureRoot, path)) ? fixtureFile(path) : undefined

describe('starterKit', () => {
  const kit = starterKit({ name: 'Acme CRM' })

  it('starts a valid model with one module', () => {
    const result = loadModel(kit.model)
    expect(result.ok ? [] : result.problems).toEqual([])
    if (!result.ok) return
    expect(result.model.project).toMatchObject({ name: 'Acme CRM', schemaVersion: 1, starterKit: '1', defaultModule: 'main', modules: ['main'] })
    expect(Object.keys(result.model.modules)).toEqual(['main'])
    expect(result.model.modules.main!.pages.map(page => page.path)).toEqual(['/'])
    expect(result.model.datasources.map(source => source.name)).toEqual(['main'])
  })

  it('ships the static core layer byte for byte as in the golden fixture', () => {
    for (const path of Object.keys(STARTER_CORE_FILES)) {
      expect(kit.files.find(file => file.path === path)?.content, path).toBe(fixtureFile(path))
    }
    expect(Object.keys(STARTER_CORE_FILES)).toContain('layers/core/server/plugins/migrate.ts')
  })

  it('ships the static root files byte for byte as in the golden fixture', () => {
    for (const path of Object.keys(STARTER_ROOT_FILES)) expect(kit.files.find(file => file.path === path)?.content, path).toBe(fixtureFile(path))
    expect(Object.keys(STARTER_ROOT_FILES).sort()).toEqual(['.gitignore', 'app/README.md', 'drizzle.config.ts', 'eslint.config.mjs', 'nuxt.config.ts', 'pnpm-workspace.yaml', 'server/README.md', 'tsconfig.json'])
  })

  it('names with </script>, \\r or {{ }} never break or run in generated code', () => {
    const LS = String.fromCharCode(0x2028)
    const lineBreaks = new RegExp(`[\r${LS}]`)
    for (const name of ['<script>x</script>', 'a\rb', '{{ 1+1 }}', `a${LS}b`]) {
      const files = starterKit({ name }).files
      const page = files.find(file => file.path === 'layers/main/app/pages/index.vue')!.content
      const config = files.find(file => file.path === 'layers/core/app/app.config.ts')!.content
      expect(page, name).not.toContain('</script>x')
      // The name may appear inside script strings (rendered as escaped text), never as template markup.
      expect(page.slice(page.indexOf('<template>')), name).not.toContain('{{ 1+1 }}')
      expect(config, name).not.toMatch(lineBreaks)
      expect(page, name).not.toMatch(lineBreaks)
    }
  })

  it('has everything a Nuxt app needs, with the right owners', () => {
    const owner = (path: string) => kit.files.find(file => file.path === path)?.owner
    for (const path of ['package.json', 'nuxt.config.ts', 'tsconfig.json', '.gitignore', '.env.example', 'README.md', 'pnpm-workspace.yaml', 'app/README.md', 'server/README.md']) {
      expect(owner(path), path).toBe('scaffold')
    }
    for (const path of ['eslint.config.mjs', 'vitest.config.ts', 'drizzle.config.ts', 'layers/core/nuxt.config.ts', 'layers/core/app/app.config.ts', 'layers/core/app/assets/css/theme.css', 'layers/core/app/layouts/main.vue', 'layers/main/nuxt.config.ts', 'layers/main/app/pages/index.vue', 'layers/main/shared/domain/errors.ts']) {
      expect(owner(path), path).toBe('managed')
    }
    expect(kit.files.every(file => isSafeProjectPath(file.path))).toBe(true)
  })

  it('names the project and its module everywhere', () => {
    const custom = starterKit({ name: 'Acme CRM', module: 'sales' })
    const file = (path: string) => custom.files.find(entry => entry.path === path)?.content ?? ''
    expect(JSON.parse(file('package.json')).name).toBe('acme-crm')
    expect(file('README.md').split('\n')[0]).toBe('# Acme CRM')
    expect(file('layers/core/app/app.config.ts')).toContain('name: \'Acme CRM\'')
    expect(file('layers/sales/nuxt.config.ts')).toContain('\'#sales/domain\'')
    expect(file('vitest.config.ts')).toContain('\'#sales/domain\': here(\'./layers/sales/shared/domain\')')
    expect(custom.model['.bildr/modules/sales/module.json']).toContain('"name": "sales"')
    // Quotes in names never break the generated TS.
    expect(starterKit({ name: 'Bob\'s "Shop"' }).files.find(entry => entry.path === 'layers/core/app/app.config.ts')!.content).toContain('name: \'Bob\\\'s "Shop"\'')
  })

  it('ships the dev-only bildr module, from npm by default or from a given spec', () => {
    const pkg = (options: Parameters<typeof starterKit>[0]) => JSON.parse(starterKit(options).files.find(file => file.path === 'package.json')!.content)
    expect(pkg({ name: 'X' }).devDependencies['@bildr/nuxt']).toBe('^0.1.0')
    expect(pkg({ name: 'X', bildrNuxt: 'link:/src/bildr/packages/nuxt' }).devDependencies['@bildr/nuxt']).toBe('link:/src/bildr/packages/nuxt')
    expect(kit.files.find(file => file.path === 'nuxt.config.ts')!.content).toContain('\'@bildr/nuxt\'')
  })

  it('ships the golden fixture\'s dependencies, so a created project installs what the fixture is proven with', () => {
    const pkg = JSON.parse(kit.files.find(file => file.path === 'package.json')!.content)
    const golden = JSON.parse(fixtureFile('package.json'))
    expect(pkg.dependencies).toEqual(golden.dependencies)
    const { '@bildr/nuxt': _kit, ...devDependencies } = pkg.devDependencies
    const { '@bildr/nuxt': _golden, ...goldenDevDependencies } = golden.devDependencies
    expect(devDependencies).toEqual(goldenDevDependencies)
  })

  it('serves Nuxt UI\'s icons from the app itself, never from the Iconify API at runtime', () => {
    const pkg = JSON.parse(kit.files.find(file => file.path === 'package.json')!.content)
    // An installed collection puts the icons Nuxt UI uses (app.config `ui.icons`) in the client bundle.
    expect(pkg.devDependencies['@iconify-json/lucide']).toBe('^1.2.147')
    // Icons named in the app's own files are bundled too.
    expect(kit.files.find(file => file.path === 'nuxt.config.ts')!.content).toContain('icon: { clientBundle: { scan: true } }')
  })

  it('refuses reserved or invalid module names and empty project names', () => {
    expect(() => starterKit({ name: 'X', module: 'app' })).toThrow('"app" is reserved')
    expect(() => starterKit({ name: 'X', module: 'Bad Name' })).toThrow('kebab-case')
    expect(() => starterKit({ name: '  ' })).toThrow('Give the project a name')
  })

  it('plans a first sync that writes every file and records a manifest', () => {
    const plan = planSync({ generated: kit.files, manifest: {}, disk: {}, hash })
    expect(plan.writes).toHaveLength(kit.files.length)
    expect(Object.values(plan.manifest).every(entry => entry.owner === 'managed' || entry.owner === 'scaffold')).toBe(true)
  })
})

// V7 (E2): the database is optional. An API-only project has no sqlite data source and no database code or dependencies.
describe('starterKit without a database', () => {
  const kit = starterKit({ name: 'Acme API', database: 'none' })
  const paths = kit.files.map(file => file.path)
  const pkg = JSON.parse(kit.files.find(file => file.path === 'package.json')!.content)

  it('starts a valid model with no data source', () => {
    const result = loadModel(kit.model)
    expect(result.ok ? [] : result.problems).toEqual([])
    if (!result.ok) return
    expect(result.model.datasources).toEqual([])
    expect(Object.keys(kit.model)).not.toContain('.bildr/datasources/main.json')
  })

  it('ships no database client, migrate plugin, drizzle config or migrations', () => {
    for (const path of ['layers/core/server/utils/db.ts', 'layers/core/server/plugins/migrate.ts', 'drizzle.config.ts']) expect(paths, path).not.toContain(path)
    expect(paths.filter(path => path.includes('server/database') || path.includes('infrastructure/db'))).toEqual([])
    // No code imports them (the eslint boundary rules still name them, and the README says how to add a database).
    for (const file of kit.files) expect(file.content, file.path).not.toMatch(/(from|import\(|require\()\s*['"](drizzle-orm|drizzle-kit|@libsql)/)
    expect(kit.files.find(file => file.path === 'layers/core/nuxt.config.ts')!.content).not.toContain('db:')
  })

  it('depends on neither drizzle nor libsql', () => {
    const names = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)]
    expect(names.filter(name => /drizzle|libsql/.test(name))).toEqual([])
    expect(Object.keys(pkg.scripts)).not.toContain('db:generate')
    expect(names).toEqual(expect.arrayContaining(['nuxt', 'zod', '@tanstack/vue-db', '@tanstack/query-db-collection', '@bildr/nuxt']))
  })

  it('is a starter-kit project the module and the CLI accept', () => {
    const files = { ...kit.model, ...Object.fromEntries(kit.files.map(file => [file.path, file.content])) }
    expect(detectStarterKit(path => files[path])).toEqual({ ok: true })
  })

  it('refuses an unknown database kind', () => {
    expect(() => starterKit({ name: 'X', database: 'postgres' as never })).toThrow('Database "postgres": use sqlite or none')
  })
})

describe('detectStarterKit', () => {
  const fromFiles = (files: Record<string, string>) => (path: string) => files[path]
  const kitFiles = () => {
    const kit = starterKit({ name: 'Acme' })
    return { ...kit.model, ...Object.fromEntries(kit.files.map(file => [file.path, file.content])) }
  }

  it('accepts the golden fixture and a fresh starter kit', () => {
    expect(detectStarterKit(fixtureFileOrUndefined)).toEqual({ ok: true })
    expect(detectStarterKit(fromFiles(kitFiles()))).toEqual({ ok: true })
  })

  it('refuses a plain Nuxt project and explains how to start one', () => {
    const plain = fromFiles({ 'package.json': JSON.stringify({ dependencies: { nuxt: '^4.6.3' } }), 'nuxt.config.ts': 'export default defineNuxtConfig({})' })
    const result = detectStarterKit(plain)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons).toEqual([
      'No .bildr/bildr.json: this is not a bildr project',
      'No layers/core: the starter kit\'s core layer is missing',
      'Missing dependencies: zod, @tanstack/vue-db, @tanstack/query-db-collection, @bildr/nuxt'
    ])
    expect(result.hint).toBe('bildr only runs on projects created from its starter kit. Create one with: pnpm create bildr <name>')
  })

  it('refuses an invalid or non-starter bildr.json', () => {
    const files = kitFiles()
    files['.bildr/bildr.json'] = '{ broken'
    expect(detectStarterKit(fromFiles(files))).toMatchObject({ ok: false, reasons: ['.bildr/bildr.json is not valid JSON'] })
    files['.bildr/bildr.json'] = JSON.stringify({ name: 'x' })
    expect(detectStarterKit(fromFiles(files))).toMatchObject({ ok: false, reasons: ['.bildr/bildr.json was not created by the bildr starter kit'] })
  })
})
