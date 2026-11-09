import { STYLE_TOKEN_GROUPS, STYLE_TOKENS } from '../design/tokens'
import type { StyleToken, StyleTokenGroup } from '../design/tokens'

/** How the style panel presents the design tokens: one select per token, grouped. */

/** The select value for "no token" (select items cannot use an empty value). */
export const STYLE_DEFAULT = '__default'

export interface StyleFieldGroup {
  group: StyleTokenGroup
  fields: StyleToken[]
}

export function styleFieldGroups(): StyleFieldGroup[] {
  return STYLE_TOKEN_GROUPS.map(group => ({ group, fields: STYLE_TOKENS.filter(t => t.group === group) }))
}

export function styleFieldItems(token: StyleToken): { label: string, value: string }[] {
  return [{ label: 'Default', value: STYLE_DEFAULT }, ...token.values.map(value => ({ label: value, value }))]
}

export function styleFieldUpdate(key: string, selected: string): Record<string, string | null> {
  return { [key]: selected === STYLE_DEFAULT ? null : selected }
}
