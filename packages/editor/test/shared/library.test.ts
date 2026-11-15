import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME } from '../../../codegen/src/design/index.ts'
import { THEME_PRESETS } from '../../../codegen/src/edit/theme.ts'
import { matchesPreset, themeSummary } from '../../src/shared/library.ts'

/** Ported from the hosted `library.test.ts` (`themeSummary`); the library's name rules went with its save, update, duplicate and delete. */

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

describe('matchesPreset', () => {
  const ocean = THEME_PRESETS.find(preset => preset.id === 'ocean')!

  it('is true for a theme a preset left, whatever its custom colours', () => {
    expect(matchesPreset({ ...ocean.theme, custom: { ink: '#112233' } }, ocean)).toBe(true)
  })

  it('is false once a colour, the font, the radius or the spacing differs', () => {
    expect(matchesPreset({ ...ocean.theme, colors: { ...ocean.theme.colors, primary: 'rose' } }, ocean)).toBe(false)
    expect(matchesPreset({ ...ocean.theme, font: 'Poppins' }, ocean)).toBe(false)
    expect(matchesPreset({ ...ocean.theme, radius: '1rem' }, ocean)).toBe(false)
    expect(matchesPreset({ ...ocean.theme, spacing: 'compact' }, ocean)).toBe(false)
    expect(matchesPreset(DEFAULT_THEME, ocean)).toBe(false)
  })
})
