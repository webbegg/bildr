// P3a: the theme (update, bundled presets), the project file and the catalog the palette and agents read.
import { describe, expect, it } from 'vitest'
import { applyEdit, THEME_PRESETS } from '../../src/edit/index'
import { ThemeSchema } from '../../src/design/theme'
import { fixtureModelFiles } from '../model/fixture'
import { project } from './helpers'
import type { Json } from './helpers'

const THEME = '.bildr/theme.json'

describe('theme', () => {
  it('theme_get returns the theme and the options each field takes', () => {
    const p = project()
    const got = p.edit('theme_get', {})
    expect(got.theme).toEqual(p.model().theme)
    expect(got.options.fonts).toContain('Inter')
    expect(got.changes).toEqual([])
  })

  it('theme_update patches colours and scalars, and adds or removes custom colours', () => {
    const p = project()
    p.edit('theme_update', { colors: { primary: 'rose' }, radius: '0.5rem', custom: { brand: '#ff6600' } })
    expect(p.json(THEME)).toMatchObject({ colors: { primary: 'rose', secondary: 'blue' }, radius: '0.5rem', custom: { brand: '#ff6600' }, font: 'Inter' })
    p.edit('node_update_style', { file: 'pg_index', nodeId: 'n_h1', style: { color: 'brand' } })
    expect(p.refuse('theme_update', { custom: { brand: null } }, 'invalid').message).toBe('The theme colour "brand" is still used: pg_index (n_h1). Change those styles first')
    p.edit('node_update_style', { file: 'pg_index', nodeId: 'n_h1', style: { color: null } })
    p.edit('theme_update', { custom: { brand: null } })
    expect(p.json(THEME).custom).toBeUndefined()
    expect(p.refuse('theme_update', { colors: { primary: 'plaid' } }, 'invalid_input')).toBeDefined()
  })

  it('ships valid bundled presets; theme_apply copies one, keeping the project\'s custom colours', () => {
    for (const preset of THEME_PRESETS) expect(ThemeSchema.safeParse(preset.theme).success, preset.id).toBe(true)
    const p = project()
    expect(p.edit('theme_presets_list', {}).presets.map((preset: Json) => preset.id)).toEqual(THEME_PRESETS.map(preset => preset.id))
    p.edit('theme_update', { custom: { brand: '#ff6600' } })
    const ocean = THEME_PRESETS.find(preset => preset.id === 'ocean')!
    p.edit('theme_apply', { preset: 'ocean' })
    expect(p.json(THEME)).toMatchObject({ ...ocean.theme, custom: { brand: '#ff6600' } })
    expect(p.refuse('theme_apply', { preset: 'nope' }, 'not_found').message).toBe('No theme preset "nope" (presets: default, ocean, forest, sunset, mono)')
  })
})

describe('project_update', () => {
  it('renames the project and sets or removes its description', () => {
    const p = project()
    p.edit('project_update', { name: 'My blog', description: null })
    expect(p.json('.bildr/bildr.json')).toMatchObject({ name: 'My blog', defaultModule: 'blog' })
    expect(p.json('.bildr/bildr.json').description).toBeUndefined()
    p.edit('project_update', { description: 'Notes.' })
    expect(p.json('.bildr/bildr.json').description).toBe('Notes.')
  })

  // T6: the owner says they read MIGRATING.md: the project takes this generator's version, so bildr regenerates it again.
  it('upgradeGenerator gives an older project this generator\'s version, and answers the one it had', () => {
    const p = project({ ...fixtureModelFiles(), '.bildr/bildr.json': JSON.stringify({ ...JSON.parse(fixtureModelFiles()['.bildr/bildr.json']!), generatorVersion: '0.1.0' }) })
    expect(p.edit('project_update', { upgradeGenerator: true })).toMatchObject({ generatorVersion: { from: '0.1.0', to: '0.2.0' } })
    expect(p.json('.bildr/bildr.json').generatorVersion).toBe('0.2.0')
    expect(p.refuse('project_update', { upgradeGenerator: true }, 'invalid').message).toBe('The project is already on generator 0.2.0')
  })

  it('upgradeGenerator never moves a newer project down: this generator would write older code over it', () => {
    const p = project({ ...fixtureModelFiles(), '.bildr/bildr.json': JSON.stringify({ ...JSON.parse(fixtureModelFiles()['.bildr/bildr.json']!), generatorVersion: '0.3.0' }) })
    expect(p.refuse('project_update', { upgradeGenerator: true }, 'invalid').message).toBe('The project is on generator 0.3.0, newer than this bildr\'s (0.2.0): update bildr instead')
    expect(p.json('.bildr/bildr.json').generatorVersion).toBe('0.3.0')
  })
})

describe('catalog_get', () => {
  it('lists the node types with their props and defaults, the style tokens and the project\'s breakpoints', () => {
    const outcome = applyEdit(fixtureModelFiles(), 'catalog_get', {})
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.changes).toEqual([])
    const catalog = outcome.result as Json
    const button = catalog.nodeTypes.find((entry: Json) => entry.type === 'Button')
    expect(button).toMatchObject({ container: false, defaults: { props: { text: 'Button' }, style: {} }, insertable: true })
    expect(button.props).toEqual(['type', 'text', 'color', 'variant', 'size', 'icon', 'trailingIcon', 'href', 'disabled', 'visible'])
    expect(catalog.nodeTypes.find((entry: Json) => entry.type === 'Instance')).toMatchObject({ insertable: true, props: ['component', 'values', 'variant', 'visible'] })
    expect(catalog.nodeTypes.find((entry: Json) => entry.type === 'Page')).toMatchObject({ insertable: false })
    expect(catalog.styleTokens.find((token: Json) => token.key === 'mt')).toMatchObject({ group: 'Spacing', responsive: true })
    expect(catalog.styleTokens.find((token: Json) => token.key === 'bg')).toMatchObject({ kind: 'color', responsive: false })
    expect(catalog.breakpoints).toEqual({ base: 'mobile', prefixes: ['sm', 'md', 'lg'] })
    expect(catalog.colors).toEqual(['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral'])
    expect(catalog.components).toEqual([{ id: 'cmp_post_card', name: 'PostCard', module: 'blog' }, { id: 'cmp_tip', name: 'Tip', module: 'blog' }])
  })
})
