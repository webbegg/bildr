import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, themeCss } from '../../src/design/theme'
import { generateProject } from '../../src/generate/project'
import { loadModel } from '../../src/model/load'
import type { Model } from '../../src/model/load'
import { fixtureModelFiles, fixtureRoot } from '../model/fixture'

const fixtureModel = (): Model => {
  const result = loadModel(fixtureModelFiles())
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  return result.model
}

/** The project-level files (T7b, T7d): theme, app config, core Nuxt config, the root vitest config. */
const PROJECT_FILES = [
  'layers/core/app/app.config.ts',
  'layers/core/app/assets/css/theme.css',
  'layers/core/nuxt.config.ts',
  'vitest.config.ts'
]

const content = (model: Model, path: string) => generateProject(model).find(file => file.path === path)!.content

describe('generateProject on the golden fixture', () => {
  const files = generateProject(fixtureModel())
  const manifest = JSON.parse(readFileSync(join(fixtureRoot, '.bildr/manifest.json'), 'utf8')).files as Record<string, { source?: string }>

  it('emits exactly the project files', () => {
    expect(files.map(file => file.path)).toEqual(PROJECT_FILES)
  })

  it.each(PROJECT_FILES)('%s matches the fixture byte for byte', (path) => {
    expect(files.find(file => file.path === path)?.content).toBe(readFileSync(join(fixtureRoot, path), 'utf8'))
  })

  it('records each file as managed with the model file it comes from', () => {
    for (const file of files) {
      expect(file.owner, file.path).toBe('managed')
      expect(file.source, file.path).toBe(manifest[file.path]!.source)
    }
  })
})

describe('generateProject rules', () => {
  it('uses the default theme when the model has none', () => {
    const model = fixtureModel()
    delete model.theme
    expect(content(model, 'layers/core/app/assets/css/theme.css')).toContain(themeCss(DEFAULT_THEME))
    expect(content(model, 'layers/core/app/app.config.ts')).toContain(`primary: '${DEFAULT_THEME.colors.primary}'`)
  })

  it('keeps hex and env colours in the stylesheet and gives Nuxt UI the default palette', () => {
    const model = fixtureModel()
    model.theme!.colors.primary = '#ff0066'
    model.theme!.colors.secondary = '{{ env.BRAND }}'
    expect(content(model, 'layers/core/app/assets/css/theme.css')).toContain('--ui-color-primary-500: #ff0066;')
    const config = content(model, 'layers/core/app/app.config.ts')
    expect(config).toContain(`primary: '${DEFAULT_THEME.colors.primary}'`)
    expect(config).toContain(`secondary: '${DEFAULT_THEME.colors.secondary}'`)
    expect(config).not.toContain('env.BRAND')
  })

  it('escapes the project name and description', () => {
    const model = fixtureModel()
    model.project.name = 'It\'s </script>'
    model.project.description = 'Line\nbreak'
    const config = content(model, 'layers/core/app/app.config.ts')
    expect(config).toContain('name: \'It\\\'s <\\/script>\'')
    expect(config).toContain('description: \'Line\\nbreak\'')
  })

  it('falls back to a description built from the name', () => {
    const model = fixtureModel()
    delete model.project.description
    expect(content(model, 'layers/core/app/app.config.ts')).toContain('description: \'Blog, built with bildr.\'')
  })

  it('writes an empty datasources block without REST sources', () => {
    const model = fixtureModel()
    model.datasources = model.datasources.filter(source => source.kind === 'sqlite')
    expect(content(model, 'layers/core/nuxt.config.ts')).toContain('    datasources: {}\n')
  })

  it('mirrors every module\'s domain alias in vitest.config.ts', () => {
    const model = fixtureModel()
    model.modules.shop = { ...model.modules.blog! }
    expect(content(model, 'vitest.config.ts')).toContain('      \'#blog/domain\': here(\'./layers/blog/shared/domain\'),\n      \'#shop/domain\': here(\'./layers/shop/shared/domain\')\n')
  })

  it('refuses a second sqlite data source and a missing one', () => {
    const model = fixtureModel()
    model.datasources.push({ ...model.datasources.find(source => source.kind === 'sqlite')!, id: 'ds_other', name: 'other' })
    expect(() => generateProject(model)).toThrow(/one sqlite data source/)
    model.datasources = model.datasources.filter(source => source.kind !== 'sqlite')
    expect(() => generateProject(model)).toThrow(/one sqlite data source/)
  })
})
