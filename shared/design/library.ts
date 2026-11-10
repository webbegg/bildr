import { z } from 'zod'
import { IdSchema } from '../document/schema'
import { ThemeSchema, themeColorValue } from './theme'
import type { Theme, ThemeColorName } from './theme'

/**
 * The theme library: named copies of project themes, shared by every
 * project. Applying one copies it into a project; nothing stays linked.
 */

export const THEME_LIBRARY_MAX = 100
export const THEME_NAME_MAX = 64

export const ThemeNameSchema = z.string().trim().min(1).max(THEME_NAME_MAX).describe(`The theme's name, 1–${THEME_NAME_MAX} characters, unique in the library ignoring case`)

export const LibraryThemeSchema = z.object({
  id: IdSchema,
  name: ThemeNameSchema,
  theme: ThemeSchema,
  createdAt: z.string(),
  updatedAt: z.string()
})

export type LibraryTheme = z.infer<typeof LibraryThemeSchema>

type Named = Pick<LibraryTheme, 'id' | 'name'>

const key = (name: string) => name.trim().toLowerCase()

/** Why `name` cannot name a library theme (empty, too long, or taken by a theme other than `selfId`), or null. */
export function libraryNameProblem(name: string, themes: readonly Named[], selfId?: string): string | null {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > THEME_NAME_MAX) return `A theme name needs 1–${THEME_NAME_MAX} characters`
  const taken = themes.find(t => t.id !== selfId && key(t.name) === key(trimmed))
  return taken ? `A theme named "${taken.name}" already exists` : null
}

/** A free name for a copy of `name`: "<name> copy", then "<name> copy 2", 3…, cut to fit 64 characters. */
export function copyName(name: string, themes: readonly Named[]): string {
  const taken = new Set(themes.map(t => key(t.name)))
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' copy' : ` copy ${n}`
    const candidate = `${name.trim().slice(0, THEME_NAME_MAX - suffix.length)}${suffix}`
    if (!taken.has(key(candidate))) return candidate
  }
}

const SWATCHES: ThemeColorName[] = ['primary', 'secondary', 'neutral']

/** What a library row shows: the primary, secondary and neutral 500 colours, and the font's name. */
export function themeSummary(theme: Theme): { swatches: { name: ThemeColorName, color: string }[], font: string } {
  return {
    swatches: SWATCHES.map(name => ({ name, color: themeColorValue(theme, name, '500') })),
    font: theme.font === 'system' ? 'System UI' : theme.font
  }
}
