import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadModel } from '../../src/model/load'
import { STARTER_CORE_FILES, detectStarterKit, starterKit } from '../../src/starter/index'
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
      'Missing dependencies: zod, drizzle-orm, @libsql/client, @tanstack/vue-db, @tanstack/query-db-collection'
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
