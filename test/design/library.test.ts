import { describe, expect, it } from 'vitest'
import { copyName, libraryNameProblem, themeSummary } from '#shared/design/library'
import { DEFAULT_THEME } from '#shared/design/theme'

const themes = (...names: string[]) => names.map((name, i) => ({ id: `t${i}`, name }))

describe('libraryNameProblem', () => {
  it('accepts a free name of 1–64 characters, trimmed', () => {
    expect(libraryNameProblem('  Brand A  ', themes('Brand B'))).toBeNull()
    expect(libraryNameProblem('x'.repeat(64), [])).toBeNull()
  })

  it('refuses an empty or too long name', () => {
    expect(libraryNameProblem('   ', [])).toBe('A theme name needs 1–64 characters')
    expect(libraryNameProblem('x'.repeat(65), [])).toBe('A theme name needs 1–64 characters')
  })

  it('refuses a name taken in any case, except by the theme itself', () => {
    expect(libraryNameProblem('brand a', themes('Brand A'))).toBe('A theme named "Brand A" already exists')
    expect(libraryNameProblem(' BRAND A', themes('Brand A'), 't0')).toBeNull()
  })
})

describe('copyName', () => {
  it('adds "copy", then a number, until the name is free in any case', () => {
    expect(copyName('Brand A', themes('Brand A'))).toBe('Brand A copy')
    expect(copyName('Brand A', themes('Brand A', 'brand a COPY'))).toBe('Brand A copy 2')
    expect(copyName('Brand A', themes('Brand A', 'Brand A copy', 'Brand A copy 2'))).toBe('Brand A copy 3')
  })

  it('shortens a long name so the copy fits in 64 characters', () => {
    const name = copyName('x'.repeat(64), themes('x'.repeat(64)))
    expect(name).toBe(`${'x'.repeat(59)} copy`)
  })
})

describe('themeSummary', () => {
  it('gives the primary, secondary and neutral 500 swatches and the font', () => {
    const summary = themeSummary({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: '#e11d48' }, font: 'Inter' })
    expect(summary.font).toBe('Inter')
    expect(summary.swatches.map(s => s.name)).toEqual(['primary', 'secondary', 'neutral'])
    expect(summary.swatches[0]!.color).toBe('#e11d48')
    expect(summary.swatches[1]!.color).toContain('--color-blue-500')
  })

  it('calls the system font System UI', () => {
    expect(themeSummary({ ...DEFAULT_THEME, font: 'system' }).font).toBe('System UI')
  })
})
