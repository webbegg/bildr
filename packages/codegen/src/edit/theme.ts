import { z } from 'zod'
import { CUSTOM_COLORS_MAX, CustomColorsPatchSchema, DEFAULT_THEME, defaultTheme, THEME_COLORS, ThemePatchSchema, themeOptions } from '../design/theme.ts'
import type { Theme } from '../design/theme.ts'
import { breakpointsOf, isResponsiveToken, STYLE_TOKENS } from '../design/tokens.ts'
import { NODE_PROPS } from '../render/rules.ts'
import { defineEdit, fail } from './core.ts'
import type { Draft } from './core.ts'
import { INTERNAL_TYPES, PALETTE } from './palette.ts'
import { walk } from './tree.ts'

/** The theme file (`theme.json`), its bundled presets, the project file (`bildr.json`) and the catalog. */

export interface ThemePreset {
  id: string
  name: string
  theme: Theme
}

/**
 * The presets `theme_apply` copies into a project. The hosted theme library
 * is a store of each user's own themes, with no built-ins, so this is a small
 * curated set over the same palettes, fonts, radii and spacings (V2: nothing
 * is stored outside `.bildr/`).
 */
export const THEME_PRESETS: readonly ThemePreset[] = [
  { id: 'default', name: 'Default', theme: DEFAULT_THEME },
  {
    id: 'ocean',
    name: 'Ocean',
    theme: { colors: { primary: 'sky', secondary: 'cyan', success: 'emerald', info: 'blue', warning: 'amber', error: 'rose', neutral: 'slate' }, font: 'Inter', radius: '0.5rem', spacing: 'default' }
  },
  {
    id: 'forest',
    name: 'Forest',
    theme: { colors: { primary: 'emerald', secondary: 'lime', success: 'green', info: 'teal', warning: 'amber', error: 'red', neutral: 'stone' }, font: 'DM Sans', radius: '0.375rem', spacing: 'comfortable' }
  },
  {
    id: 'sunset',
    name: 'Sunset',
    theme: { colors: { primary: 'orange', secondary: 'rose', success: 'green', info: 'sky', warning: 'yellow', error: 'red', neutral: 'zinc' }, font: 'Poppins', radius: '0.75rem', spacing: 'default' }
  },
  {
    id: 'mono',
    name: 'Mono',
    theme: { colors: { primary: 'neutral', secondary: 'zinc', success: 'green', info: 'blue', warning: 'yellow', error: 'red', neutral: 'neutral' }, font: 'system', radius: '0', spacing: 'compact' }
  }
]

/** Where style tokens (of nodes and variant overrides) use one of the colours `names`, as `file (nodeId)`. */
const colorUses = (draft: Draft, names: Set<string>): string[] => draft.trees().flatMap((tree) => {
  const found: string[] = []
  walk(tree.root, (node) => {
    if (Object.values(node.style ?? {}).some(value => names.has(value))) found.push(`${tree.file} (${node.id})`)
  })
  if (tree.kind === 'component' && 'variants' in tree.owner) {
    for (const variant of tree.owner.variants) {
      for (const [nodeId, override] of Object.entries(variant.overrides)) {
        if (Object.values(override.style ?? {}).some(value => names.has(value))) found.push(`${tree.file} (${nodeId}, variant ${variant.name})`)
      }
    }
  }
  return found
})

/** Sets the theme's custom colours: a hex adds or changes one, null removes it (refused while a style uses it). */
const patchCustom = (draft: Draft, theme: Theme, patch: Record<string, string | null>) => {
  const next = { ...theme.custom }
  const removed = new Set<string>()
  for (const [name, value] of Object.entries(patch)) {
    if (value === null) {
      if (name in next) removed.add(name)
      Reflect.deleteProperty(next, name)
    } else {
      next[name] = value
    }
  }
  if (Object.keys(next).length > CUSTOM_COLORS_MAX) fail('invalid', `A theme has at most ${CUSTOM_COLORS_MAX} custom colours`)
  const uses = removed.size ? colorUses(draft, removed) : []
  if (uses.length) {
    const list = [...removed].map(name => `"${name}"`).join(', ')
    fail('invalid', `The theme colour${removed.size > 1 ? 's' : ''} ${list} ${removed.size > 1 ? 'are' : 'is'} still used: ${uses.join(', ')}. Change those styles first`)
  }
  if (Object.keys(next).length) theme.custom = next
  else delete theme.custom
}

export const themeGet = defineEdit({
  input: z.object({}),
  readOnly: true,
  apply: draft => ({ theme: draft.model.theme ?? defaultTheme(), options: themeOptions() })
})

export const themeUpdate = defineEdit({
  input: ThemePatchSchema.extend({ custom: CustomColorsPatchSchema.optional() }),
  apply: (draft, { colors, font, radius, spacing, custom }) => {
    const theme = draft.model.theme ??= defaultTheme()
    if (colors) theme.colors = { ...theme.colors, ...colors }
    if (font !== undefined) theme.font = font
    if (radius !== undefined) theme.radius = radius
    if (spacing !== undefined) theme.spacing = spacing
    if (custom) patchCustom(draft, theme, custom)
    return { theme }
  }
})

export const themePresetsList = defineEdit({
  input: z.object({}),
  readOnly: true,
  apply: () => ({ presets: THEME_PRESETS })
})

export const themeApply = defineEdit({
  input: z.object({ preset: z.string().min(1).describe('A preset id, from theme_presets_list') }),
  apply: (draft, { preset: id }) => {
    const preset = THEME_PRESETS.find(entry => entry.id === id)
      ?? fail('not_found', `No theme preset "${id}" (presets: ${THEME_PRESETS.map(entry => entry.id).join(', ')})`)
    const { custom, ...rest } = structuredClone(preset.theme)
    const current = draft.model.theme
    const theme: Theme = { ...current, ...rest }
    if (custom || current?.custom) theme.custom = { ...current?.custom, ...custom }
    draft.model.theme = theme
    return { theme }
  }
})

export const projectUpdate = defineEdit({
  input: z.object({
    name: z.string().trim().min(1).max(100).optional().describe('The project (and app) name'),
    description: z.string().max(500).nullable().optional().describe('What the app is; null removes it')
  }),
  apply: (draft, { name, description }) => {
    const project = draft.model.project
    if (name !== undefined) project.name = name
    if (description === null || description === '') delete project.description
    else if (description !== undefined) project.description = description
    return {}
  }
})

const INTERNAL_INFO: Record<(typeof INTERNAL_TYPES)[number], { label: string, description: string, insertable: boolean }> = {
  Page: { label: 'Page', description: 'The root of a page.', insertable: false },
  Instance: { label: 'Component instance', description: 'A use of a component: props.component (a component id), variant and values (property id → value). Its children are SlotFills.', insertable: true },
  SlotFill: { label: 'Slot content', description: 'An instance\'s or a page\'s content for one slot (props.slot); made by instance_set_slot and page_set_slot.', insertable: false }
}

const propsOf = (type: string) => [...NODE_PROPS[type] ?? [], 'visible']

export const catalogGet = defineEdit({
  input: z.object({}),
  readOnly: true,
  apply: (draft) => {
    const custom = Object.keys(draft.model.theme?.custom ?? {})
    return {
      nodeTypes: [
        ...PALETTE.map(entry => ({ type: entry.type, label: entry.label, description: entry.description, container: entry.container, insertable: true, props: propsOf(entry.type), defaults: { props: entry.props, style: entry.style } })),
        ...INTERNAL_TYPES.map(type => ({ type, ...INTERNAL_INFO[type], container: true, props: propsOf(type), defaults: { props: {}, style: {} } }))
      ],
      styleTokens: STYLE_TOKENS.map(token => ({ key: token.key, label: token.label, group: token.group, values: token.values, responsive: isResponsiveToken(token), ...(token.kind ? { kind: token.kind } : {}) })),
      breakpoints: { base: draft.base, prefixes: [...breakpointsOf(draft.base)] },
      colors: [...THEME_COLORS, ...custom],
      components: Object.entries(draft.model.modules).flatMap(([module, mod]) => mod.components.map(component => ({ id: component.id, name: component.name, module }))),
      layouts: draft.model.layouts.map(layout => ({ id: layout.id, name: layout.name, slots: layout.slots, variables: (layout.variables ?? []).map(variable => ({ id: variable.id, name: variable.name, kind: variable.kind })) }))
    }
  }
})
