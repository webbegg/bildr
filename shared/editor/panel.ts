import { BREAKPOINTS, parseStyleKey } from '../design/tokens'
import type { Breakpoint } from '../design/tokens'
import { isContainerType, isFlexType } from '../document/components'
import { SIDES, sideKey, spacingSide } from './spacing'
import type { Side, SpacingBox } from './spacing'
import { styleProvenance } from './styleFields'
import type { DeviceId, Provenance } from './styleFields'

/**
 * The right panel in Figma UI3's sections: what each section holds, which
 * fields a node gets, the defaults the Fill, Stroke and Effects "+" add, and
 * how the padding fields read and write the spacing tokens. Figma has no
 * margins, so they keep the box model in a Spacing section.
 */

export const PANEL_SECTIONS = ['Auto layout', 'Layout', 'Spacing', 'Appearance', 'Typography', 'Fill', 'Stroke', 'Effects'] as const

export type PanelSection = typeof PANEL_SECTIONS[number]

const PADDING = ['p', 'px', 'py', 'pt', 'pr', 'pb', 'pl']
const SECTION_KEYS: Record<PanelSection, string[]> = {
  'Auto layout': ['direction', 'items', 'justify', 'gap', 'cols', 'colSpan', ...PADDING],
  'Layout': ['w', 'minH', 'maxW', 'self'],
  'Spacing': ['m', 'mx', 'my', 'mt', 'mr', 'mb', 'ml'],
  'Appearance': ['display', 'opacity', 'overflow', 'rounded', 'roundedTl', 'roundedTr', 'roundedBr', 'roundedBl'],
  'Typography': ['text', 'font', 'align', 'color'],
  'Fill': ['bg'],
  'Stroke': ['border', 'borderT', 'borderR', 'borderB', 'borderL', 'borderColor'],
  'Effects': ['shadow']
}

export const sectionKeys = (section: PanelSection): string[] => SECTION_KEYS[section]

const baseKey = (key: string) => parseStyleKey(key)?.token.key

/** The section of a token key, breakpoint-prefixed or not; undefined for unknown keys. */
export function panelSection(key: string): PanelSection | undefined {
  const base = baseKey(key)
  return base ? PANEL_SECTIONS.find(s => SECTION_KEYS[s].includes(base)) : undefined
}

const sectionStates = (style: Record<string, string>, section: PanelSection, device: DeviceId) =>
  SECTION_KEYS[section].map(key => styleProvenance(style, key, device).state)

/** A section's dot, Framer's override highlight: `set` if the device sets one of its tokens; inheriting gets no dot. */
export function panelSectionMark(style: Record<string, string>, section: PanelSection, device: DeviceId): 'set' | undefined {
  return sectionStates(style, section, device).includes('set') ? 'set' : undefined
}

export interface PanelNode {
  type: string
  /** The parent's type; a Grid or List child gets a column span. */
  parentType?: string
  root?: boolean
  style: Record<string, string>
}

export interface PanelFields {
  sections: PanelSection[]
  direction: boolean
  align: boolean
  gap: boolean
  cols: boolean
  colSpan: boolean
  self: boolean
  /** Hide/show; the page root always shows. */
  display: boolean
}

const GRID_TYPES = ['Grid', 'List']

/** The sections and rows a node gets: those of its type, plus any whose tokens it sets. */
export function panelFields(node: PanelNode): PanelFields {
  const sets = (...keys: string[]) => Object.keys(node.style).some(key => keys.includes(baseKey(key) ?? ''))
  const flex = isFlexType(node.type)
  const gridChild = GRID_TYPES.includes(node.parentType ?? '')
  const autoLayout = isContainerType(node.type) || gridChild || sets(...SECTION_KEYS['Auto layout'])
  return {
    sections: PANEL_SECTIONS.filter(s => s !== 'Auto layout' || autoLayout),
    direction: flex || sets('direction'),
    align: flex || sets('items', 'justify'),
    gap: isContainerType(node.type) || sets('gap'),
    cols: GRID_TYPES.includes(node.type) || sets('cols'),
    colSpan: gridChild || sets('colSpan'),
    self: !node.root || sets('self'),
    display: !node.root || sets('display')
  }
}

const SECTION_DEFAULTS: Partial<Record<PanelSection, Record<string, string>>> = {
  Fill: { bg: 'neutral-100' },
  Stroke: { border: '1', borderColor: 'default' },
  Effects: { shadow: 'md' }
}

/** What a section header's "+" adds; undefined for the sections without one. */
export function sectionAdd(section: PanelSection): Record<string, string> | undefined {
  const patch = SECTION_DEFAULTS[section]
  return patch && { ...patch }
}

/** Whether one of the section's tokens applies at the device. */
export function sectionPresent(style: Record<string, string>, section: PanelSection, device: DeviceId): boolean {
  return sectionStates(style, section, device).some(state => state !== 'unset')
}

/** The patch that clears a token at every breakpoint. */
export function tokenRemove(style: Record<string, string>, base: string): Record<string, null> {
  return Object.fromEntries(Object.keys(style).filter(key => baseKey(key) === base).map(key => [key, null]))
}

/** Appearance rows that stay hidden until the section's "+" adds them (Framer's advanced properties). */
export const OPTIONAL_ROWS = ['opacity', 'overflow', 'display'] as const

export type OptionalRow = typeof OPTIONAL_ROWS[number]

/**
 * The optional rows a node shows: those `added` from the "+", plus any whose
 * token the node sets at some breakpoint; `addable` are what the "+" offers.
 * The Visible row manages `display: hidden` and the node's `natural` display
 * (see `visibilityToggle`), so only another display value shows Display.
 */
export function optionalRows(style: Record<string, string>, added: readonly string[], natural?: string): { shown: OptionalRow[], addable: OptionalRow[] } {
  const sets = new Set(Object.entries(style)
    .filter(([key, value]) => baseKey(key) !== 'display' || (value !== 'hidden' && value !== natural))
    .map(([key]) => baseKey(key)))
  const shown = OPTIONAL_ROWS.filter(row => added.includes(row) || sets.has(row))
  return { shown, addable: OPTIONAL_ROWS.filter(row => !shown.includes(row)) }
}

/** The per-corner radius and per-side border width tokens, clockwise from the top (left). */
export const SPLIT_KEYS = {
  rounded: ['roundedTl', 'roundedTr', 'roundedBr', 'roundedBl'],
  border: ['borderT', 'borderR', 'borderB', 'borderL']
} as const

export type SplitToken = keyof typeof SPLIT_KEYS

/** Framer's all-sides vs split toggle: split once a corner or side token is set. */
export function splitMode(style: Record<string, string>, token: SplitToken): 'all' | 'split' {
  return SPLIT_KEYS[token].some(key => style[key] !== undefined) ? 'split' : 'all'
}

/** Leaving split mode: the first set corner or side becomes the all-sides value, and the others are cleared. */
export function joinSplit(style: Record<string, string>, token: SplitToken): Record<string, string | null> {
  const set = SPLIT_KEYS[token].filter(key => style[key] !== undefined)
  if (!set.length) return {}
  return { [token]: style[set[0]!]!, ...Object.fromEntries(set.map(key => [key, null])) }
}

/** The patch a row's "−" sends: every key of the section, at every breakpoint. */
export function sectionRemove(style: Record<string, string>, section: PanelSection): Record<string, null> {
  return Object.fromEntries(Object.keys(style).filter(key => panelSection(key) === section).map(key => [key, null]))
}

/**
 * What the panel shows for several selected nodes: the tokens they all share,
 * and the base keys of the tokens that differ (set on some nodes and unset on
 * others counts), which the fields show as "Mixed".
 */
export function sharedStyle(styles: Record<string, string>[]): { style: Record<string, string>, mixed: string[] } {
  const keys = new Set(styles.flatMap(style => Object.keys(style)))
  const style: Record<string, string> = {}
  const mixed = new Set<string>()
  for (const key of keys) {
    const value = styles[0]![key]
    if (value !== undefined && styles.every(other => other[key] === value)) style[key] = value
    else mixed.add(baseKey(key) ?? key)
  }
  return { style, mixed: [...mixed].sort() }
}

const rank = (breakpoint: Breakpoint | undefined) => (breakpoint ? BREAKPOINTS.indexOf(breakpoint) + 1 : 0)
const SIDE_KEYS = SIDES.map(side => sideKey('p', side))

/**
 * Figma's padding fields: horizontal and vertical, or one per side ("individual
 * padding") once a side token applies at the breakpoint.
 */
export function paddingMode(style: Record<string, string>, breakpoint: Breakpoint | undefined): 'axes' | 'sides' {
  const sides = Object.keys(style).some((key) => {
    const parsed = parseStyleKey(key)
    return !!parsed && SIDE_KEYS.includes(parsed.token.key) && rank(parsed.breakpoint) <= rank(breakpoint)
  })
  return sides ? 'sides' : 'axes'
}

/** Where a side's spacing comes from at a breakpoint; a set value's `key` is what a reset clears. */
export function spacingProvenance(style: Record<string, string>, box: SpacingBox, side: Side, breakpoint: Breakpoint | undefined): Provenance {
  const resolved = spacingSide(style, box, side, breakpoint)
  if (!resolved) return { state: 'unset' }
  if (resolved.state === 'set') return { state: 'set', key: resolved.key, value: resolved.value }
  return { state: 'inherited', value: resolved.value, from: parseStyleKey(resolved.key)?.breakpoint }
}
