import { describe, expect, it } from 'vitest'
import { CUSTOM_COLORS_MAX, customColorNames, CustomColorsPatchSchema, defaultTheme, ThemeSchema, themeCss } from '#shared/design/theme'
import { createNode, createProject } from '#shared/document/factory'
import { ProjectSchema } from '#shared/document/schema'

describe('theme custom colours (S4c)', () => {
  it('accepts named hex colours next to the 7 semantic ones', () => {
    const theme = { ...defaultTheme(), custom: { 'brand': '#ff6600', 'ink-2': '#111', 'glass': '#ffffff80' } }
    expect(ThemeSchema.parse(theme)).toEqual(theme)
    expect(customColorNames(theme)).toEqual(['brand', 'ink-2', 'glass'])
  })

  it('leaves themes without custom colours unchanged', () => {
    const parsed = ThemeSchema.parse(defaultTheme())
    expect(parsed).toEqual(defaultTheme())
    expect('custom' in parsed).toBe(false)
    expect(customColorNames(parsed)).toEqual([])
    expect(themeCss(parsed)).not.toContain('bildr-color')
  })

  it('still requires the 7 semantic colours', () => {
    const { primary: _primary, ...colors } = defaultTheme().colors
    expect(ThemeSchema.safeParse({ ...defaultTheme(), colors }).success).toBe(false)
  })

  it('refuses names a colour token already takes, badly shaped names and values, and too many', () => {
    for (const name of ['primary', 'muted', 'primary-500', 'default']) {
      const result = ThemeSchema.safeParse({ ...defaultTheme(), custom: { [name]: '#fff' } })
      expect(result.success, name).toBe(false)
      expect(result.error?.issues[0]?.message).toBe(`"${name}" is already a colour token; pick another name`)
    }
    for (const name of ['Brand', '1x', 'a_b', 'a--b', 'x'.repeat(33)]) expect(ThemeSchema.safeParse({ ...defaultTheme(), custom: { [name]: '#fff' } }).success, name).toBe(false)
    for (const value of ['red', '#ff', 'ff0000']) expect(ThemeSchema.safeParse({ ...defaultTheme(), custom: { brand: value } }).success, value).toBe(false)
    const many = Object.fromEntries(Array.from({ length: CUSTOM_COLORS_MAX + 1 }, (_, i) => [`c${i}`, '#fff']))
    expect(ThemeSchema.safeParse({ ...defaultTheme(), custom: many }).success).toBe(false)
  })

  it('declares each custom colour as a CSS variable', () => {
    const css = themeCss({ ...defaultTheme(), custom: { brand: '#ff6600' } })
    expect(css).toContain('--bildr-color-brand: #ff6600;')
    expect(css.replace('  --bildr-color-brand: #ff6600;\n', '')).toBe(themeCss(defaultTheme()))
  })

  it('patches custom colours by name, null removing one', () => {
    expect(CustomColorsPatchSchema.parse({ brand: '#ff6600', old: null })).toEqual({ brand: '#ff6600', old: null })
    expect(CustomColorsPatchSchema.safeParse({ primary: '#fff' }).success).toBe(false)
  })

  it('makes theme colours valid style values for colour keys in that project only', () => {
    const project = createProject('P')
    project.pages[0]!.root.children.push({ ...createNode('Text'), style: { color: 'brand' } })
    const issues = ProjectSchema.safeParse(project).error?.issues.map(i => i.message)
    expect(issues).toContain('"brand" is not a value of style token "color" (use a colour token, a #rgb, #rrggbb or #rrggbbaa hex, or a theme colour)')
    project.theme = { ...project.theme, custom: { brand: '#ff6600' } }
    expect(ProjectSchema.safeParse(project).success).toBe(true)
    project.pages[0]!.root.children[0]!.style = { mt: 'brand' }
    expect(ProjectSchema.safeParse(project).success).toBe(false)
  })
})
