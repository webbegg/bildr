import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME } from '../../src/design/index.ts'
import { ThemeFileSchema } from '../../src/model/schemas.ts'

// D11: `.bildr/theme.json` is the editor's `Theme` (palette colours, font, radius, spacing).
describe('.bildr/theme.json', () => {
  it('takes the editor Theme, with an optional $schema', () => {
    expect(ThemeFileSchema.parse({ $schema: 'https://bildr.dev/schema/theme.v1.json', ...DEFAULT_THEME })).toEqual({ $schema: 'https://bildr.dev/schema/theme.v1.json', ...DEFAULT_THEME })
    expect(ThemeFileSchema.safeParse(DEFAULT_THEME).success).toBe(true)
  })

  it('accepts hex, env colours and custom colours', () => {
    const theme = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: '#4f46e5', secondary: '{{ env.BRAND }}' }, custom: { brand: '#ff0066' } }
    expect(ThemeFileSchema.safeParse(theme).success).toBe(true)
  })

  it('refuses the old free-form colours and fonts', () => {
    expect(ThemeFileSchema.safeParse({ colors: { primary: 'oklch(0.55 0.2 264)' }, fonts: { sans: 'Inter' } }).success).toBe(false)
  })

  it('refuses an unknown palette and unknown keys', () => {
    expect(ThemeFileSchema.safeParse({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: 'nope' } }).success).toBe(false)
    expect(ThemeFileSchema.safeParse({ ...DEFAULT_THEME, extra: 1 }).success).toBe(false)
  })
})
