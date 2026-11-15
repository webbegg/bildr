import { THEME_COLORS, themeColorValue } from '@bildr/codegen/design'
import type { Theme, ThemeColorName } from '@bildr/codegen/design'

/**
 * The Design library's rows (the hosted `shared/design/library.ts`): the module has bundled
 * theme presets (`theme_presets_list`, applied with `theme_apply`) in place of the hosted
 * per-user library, so only the row summary is kept: the library's save, update, duplicate,
 * delete and name rules have nothing to act on.
 */

const SWATCHES: ThemeColorName[] = ['primary', 'secondary', 'neutral']

/** What a library row shows: the primary, secondary and neutral 500 colours, and the font's name. */
export function themeSummary(theme: Theme): { swatches: { name: ThemeColorName, color: string }[], font: string } {
  return {
    swatches: SWATCHES.map(name => ({ name, color: themeColorValue(theme, name, '500') })),
    font: theme.font === 'system' ? 'System UI' : theme.font
  }
}

/** A preset `theme_presets_list` returns. */
export interface ThemePreset {
  id: string
  name: string
  theme: Theme
}

/** Whether `theme` is what applying `preset` leaves: its colours, font, radius and spacing (the project's custom colours stay, so they are not compared). */
export function matchesPreset(theme: Theme, preset: Pick<ThemePreset, 'theme'>): boolean {
  const other = preset.theme
  return theme.font === other.font && theme.radius === other.radius && theme.spacing === other.spacing && THEME_COLORS.every(name => theme.colors[name] === other.colors[name])
}
