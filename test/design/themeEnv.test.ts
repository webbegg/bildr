import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, resolveThemeColors, themeColorValue, themeCss, ThemePatchSchema, ThemeSchema } from '#shared/design/theme'

const withColors = (colors: Partial<typeof DEFAULT_THEME.colors>) => ({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, ...colors } })

describe('theme colours from env variables', () => {
  it('accepts {{ env.NAME }} as a colour, and nothing else that looks like a ref', () => {
    expect(ThemeSchema.safeParse(withColors({ primary: '{{ env.BRAND }}' })).success).toBe(true)
    expect(ThemeSchema.safeParse(withColors({ primary: '{{env.BRAND_2}}' })).success).toBe(true)
    expect(ThemeSchema.safeParse(withColors({ primary: '{{ env.brand }}' })).success).toBe(false)
    expect(ThemeSchema.safeParse(withColors({ primary: '{{ item.colour }}' })).success).toBe(false)
    expect(ThemeSchema.safeParse(withColors({ primary: 'x {{ env.BRAND }}' })).success).toBe(false)
    expect(ThemePatchSchema.safeParse({ colors: { primary: '{{ env.BRAND }}' } }).success).toBe(true)
  })

  it('resolves a ref to the variable hex colour', () => {
    const theme = resolveThemeColors(withColors({ primary: '{{ env.BRAND }}', secondary: 'indigo' }), { BRAND: '#e11d48' })
    expect(theme.colors).toMatchObject({ primary: '#e11d48', secondary: 'indigo' })
    expect(themeCss(theme)).toContain('--ui-color-primary-500: #e11d48;')
  })

  it('falls back to the default colour when the variable is missing or not a hex colour', () => {
    const theme = resolveThemeColors(withColors({ primary: '{{ env.BRAND }}', error: '{{ env.ALERT }}' }), { ALERT: 'red' })
    expect(theme.colors.primary).toBe('green')
    expect(theme.colors.error).toBe('red')
    expect(resolveThemeColors(withColors({ info: '{{ env.X }}' }), { X: ' #12345' }).colors.info).toBe('blue')
  })

  it('renders an unresolved theme with the default colours instead of failing', () => {
    const theme = withColors({ primary: '{{ env.BRAND }}' })
    expect(themeColorValue(theme, 'primary', '500')).toBe(themeColorValue(DEFAULT_THEME, 'primary', '500'))
    expect(themeCss(theme)).toBe(themeCss(DEFAULT_THEME))
  })
})
