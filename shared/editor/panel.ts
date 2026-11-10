import { parseStyleKey, styleKey } from '../design/tokens'
import { isContainerType, isFlexType } from '../document/components'
import { spacingSide } from './spacing'
import type { Side, SpacingBox } from './spacing'
import { DEVICES, styleProvenance } from './styleFields'
import type { Breakpoint } from '../design/tokens'
import type { DeviceId, Provenance } from './styleFields'

/**
 * The right panel in Framer's sections, as a row model: each section lists
 * label-column rows, and an optional prop shows as an "Add…" row until it is
 * added (Framer's Border and Shadows), which writes a default token. A section
 * none of whose tokens applies collapses to its title and a "+".
 */

export const PANEL_SECTIONS = ['Size', 'Layout', 'Styles', 'Typography'] as const

export type PanelSection = typeof PANEL_SECTIONS[number]

const PADDING = ['p', 'px', 'py', 'pt', 'pr', 'pb', 'pl']
const MARGIN = ['m', 'mx', 'my', 'mt', 'mr', 'mb', 'ml']

interface RowDef {
  section: PanelSection
  keys: string[]
  /** What its "Add…" writes; rows without it are always shown. */
  add?: Record<string, string>
}

const ROWS = {
  width: { section: 'Size', keys: ['w'] },
  height: { section: 'Size', keys: ['minH'] },
  minMax: { section: 'Size', keys: ['maxW'], add: { maxW: 'full' } },
  // Type writes `display`, which Styles owns; it shows the Grid or Stack rows.
  type: { section: 'Layout', keys: [] },
  direction: { section: 'Layout', keys: ['direction'] },
  distribute: { section: 'Layout', keys: ['justify'] },
  align: { section: 'Layout', keys: ['items'] },
  wrap: { section: 'Layout', keys: ['flexWrap'] },
  columns: { section: 'Layout', keys: ['cols'] },
  gap: { section: 'Layout', keys: ['gap'] },
  padding: { section: 'Layout', keys: PADDING, add: { p: '2' } },
  span: { section: 'Layout', keys: ['colSpan'] },
  margin: { section: 'Layout', keys: MARGIN, add: { m: '4' } },
  self: { section: 'Layout', keys: ['self'], add: { self: 'center' } },
  visible: { section: 'Styles', keys: ['display'] },
  opacity: { section: 'Styles', keys: ['opacity'], add: { opacity: '100' } },
  fill: { section: 'Styles', keys: ['bg'], add: { bg: 'neutral-100' } },
  border: { section: 'Styles', keys: ['border', 'borderT', 'borderR', 'borderB', 'borderL', 'borderColor'], add: { border: '1', borderColor: 'default' } },
  shadows: { section: 'Styles', keys: ['shadow'], add: { shadow: 'md' } },
  radius: { section: 'Styles', keys: ['rounded', 'roundedTl', 'roundedTr', 'roundedBr', 'roundedBl'] },
  overflow: { section: 'Styles', keys: ['overflow'], add: { overflow: 'hidden' } },
  // Display only reveals its control: Visible and Type manage the usual values.
  display: { section: 'Styles', keys: ['display'], add: {} },
  fontSize: { section: 'Typography', keys: ['text'] },
  fontWeight: { section: 'Typography', keys: ['font'] },
  textAlign: { section: 'Typography', keys: ['align'] },
  textColor: { section: 'Typography', keys: ['color'] }
} satisfies Record<string, RowDef>

export type RowId = keyof typeof ROWS

const ROW_IDS = Object.keys(ROWS) as RowId[]
const def = (row: RowId): RowDef => ROWS[row]

export const rowKeys = (row: RowId): string[] => def(row).keys

export const sectionKeys = (section: PanelSection): string[] =>
  [...new Set(ROW_IDS.filter(row => def(row).section === section).flatMap(rowKeys))]

const baseKey = (key: string) => parseStyleKey(key)?.token.key

/** The section of a token key, breakpoint-prefixed or not; undefined for unknown keys. */
export function panelSection(key: string): PanelSection | undefined {
  const base = baseKey(key)
  return base ? PANEL_SECTIONS.find(s => sectionKeys(s).includes(base)) : undefined
}

const sectionStates = (style: Record<string, string>, section: PanelSection, device: DeviceId) =>
  sectionKeys(section).map(key => styleProvenance(style, key, device).state)

/** A section's dot, Framer's override highlight: `set` if the device sets one of its tokens; inheriting gets no dot. */
export function panelSectionMark(style: Record<string, string>, section: PanelSection, device: DeviceId): 'set' | undefined {
  return sectionStates(style, section, device).includes('set') ? 'set' : undefined
}

const breakpointOf = (device: DeviceId) => DEVICES.find(d => d.id === device)!.breakpoint

export type LayoutType = 'stack' | 'grid'

/** Whether a type has the Type row: the flex stacks and the Grid (a Card lays out an inner stack, a List follows its layout prop). */
const typed = (type: string) => type === 'Grid' || (isFlexType(type) && type !== 'Card')

/** Stack or Grid at the device: the `display` token that applies (grid or flex), else the type's own layout. */
export function layoutType(type: string, style: Record<string, string>, device: DeviceId): LayoutType | undefined {
  if (!typed(type)) return undefined
  const display = styleProvenance(style, 'display', device)
  const value = display.state === 'unset' ? undefined : display.value
  return value === 'grid' ? 'grid' : value === 'flex' ? 'stack' : type === 'Grid' ? 'grid' : 'stack'
}

/**
 * The patch of the Type row at the device: Grid is `display: grid` (with two
 * columns unless some apply), Stack is `display: flex`; an override that the
 * breakpoint below already gives is dropped instead.
 */
export function layoutTypeWrite(type: string, style: Record<string, string>, device: DeviceId, next: LayoutType): Record<string, string | null> {
  if (layoutType(type, style, device) === next) return {}
  const breakpoint = breakpointOf(device)
  const key = styleKey('display', breakpoint)
  const below = Object.fromEntries(Object.entries(style).filter(([other]) => other !== key))
  const patch: Record<string, string | null> = { [key]: layoutType(type, below, device) === next ? null : next === 'grid' ? 'grid' : 'flex' }
  if (next === 'grid' && type !== 'Grid' && styleProvenance(style, 'cols', device).state === 'unset') patch[styleKey('cols', breakpoint)] = '2'
  return patch
}

export interface PanelNode {
  type: string
  /** The parent's type; a Grid or List child gets a column span. */
  parentType?: string
  root?: boolean
  style: Record<string, string>
  /** The display the node renders with when no token applies (see `naturalDisplay`). */
  natural?: string
}

export interface PanelRow {
  id: RowId
  /** Shown as an "Add…" placeholder until added. */
  add: boolean
}

export interface PanelSectionRows {
  section: PanelSection
  rows: PanelRow[]
  /** Whether one of the section's tokens applies at the device (or differs across the selection); else it shows its title and "+". */
  present: boolean
}

export interface PanelView {
  device: DeviceId
  /** Rows the user added this session, before or without a token. */
  added?: readonly RowId[]
  /** Base keys whose values differ across the selected nodes. */
  mixed?: readonly string[]
}

const GRID_TYPES = ['Grid', 'List']

/** The rows of each section for a node, in Framer's order, with "Add…" for the optional rows it does not set. */
export function panelRows(node: PanelNode, view: PanelView): PanelSectionRows[] {
  const { device, added = [], mixed = [] } = view
  const sets = (...keys: string[]) => Object.keys(node.style).some(key => keys.includes(baseKey(key) ?? ''))
  const container = isContainerType(node.type)
  const layout = layoutType(node.type, node.style, device)
  const stack = layout ? layout === 'stack' : isFlexType(node.type)
  const grid = layout ? layout === 'grid' : GRID_TYPES.includes(node.type)
  // Visible and Type manage hiding, the natural display and (for typed stacks) grid or flex.
  const managed = ['hidden', node.natural, ...(typed(node.type) ? ['grid', 'flex'] : [])]
  const setsDisplay = Object.entries(node.style).some(([key, value]) => baseKey(key) === 'display' && !managed.includes(value))

  const shown: Record<RowId, boolean> = {
    width: true,
    height: true,
    minMax: true,
    type: !!layout,
    direction: stack || sets('direction'),
    distribute: stack || sets('justify'),
    align: stack || sets('items'),
    wrap: stack || sets('flexWrap'),
    columns: grid || (sets('cols') && !stack),
    gap: container || sets('gap'),
    padding: true,
    span: GRID_TYPES.includes(node.parentType ?? '') || sets('colSpan'),
    margin: !node.root,
    self: !node.root,
    visible: !node.root,
    opacity: true,
    fill: true,
    border: true,
    shadows: true,
    radius: true,
    overflow: true,
    display: !node.root,
    fontSize: true,
    fontWeight: true,
    textAlign: true,
    textColor: true
  }
  const optional = (row: RowId) => !!def(row).add && !(row === 'padding' && container)
  const has = (row: RowId) => added.includes(row) || rowKeys(row).some(key => mixed.includes(key))
    || (row === 'display' ? setsDisplay : sets(...rowKeys(row)))

  return PANEL_SECTIONS.map(section => ({
    section,
    rows: ROW_IDS.filter(row => def(row).section === section && shown[row]).map(id => ({ id, add: optional(id) && !has(id) })),
    present: sectionStates(node.style, section, device).some(state => state !== 'unset') || sectionKeys(section).some(key => mixed.includes(key))
  }))
}

/** What an "Add…" row writes (base keys; the panel puts responsive ones at the device). */
export function rowAdd(row: RowId): Record<string, string> {
  return { ...def(row).add }
}

/** The patch that resets a row on a device: its keys set at exactly that breakpoint. */
export function rowReset(style: Record<string, string>, row: RowId, breakpoint: Breakpoint | undefined): Record<string, null> {
  const keys = rowKeys(row)
  return Object.fromEntries(Object.keys(style).filter((key) => {
    const parsed = parseStyleKey(key)
    return !!parsed && keys.includes(parsed.token.key) && parsed.breakpoint === breakpoint
  }).map(key => [key, null]))
}

/** A row's provenance on a device: set if any of its keys is set there, else inherited if one applies. */
export function rowProvenance(style: Record<string, string>, row: RowId, device: DeviceId): Provenance {
  const all = rowKeys(row).map(key => styleProvenance(style, key, device))
  return all.find(p => p.state === 'set') ?? all.find(p => p.state === 'inherited') ?? { state: 'unset' }
}

/** The patch a section's "−" sends: every key of the section, at every breakpoint. */
export function sectionRemove(style: Record<string, string>, section: PanelSection): Record<string, null> {
  return Object.fromEntries(Object.keys(style).filter(key => panelSection(key) === section).map(key => [key, null]))
}

/** The patch that clears a token at every breakpoint. */
export function tokenRemove(style: Record<string, string>, base: string): Record<string, null> {
  return Object.fromEntries(Object.keys(style).filter(key => baseKey(key) === base).map(key => [key, null]))
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

/** Where a side's spacing comes from at a breakpoint; a set value's `key` is what a reset clears. */
export function spacingProvenance(style: Record<string, string>, box: SpacingBox, side: Side, breakpoint: Breakpoint | undefined): Provenance {
  const resolved = spacingSide(style, box, side, breakpoint)
  if (!resolved) return { state: 'unset' }
  if (resolved.state === 'set') return { state: 'set', key: resolved.key, value: resolved.value }
  return { state: 'inherited', value: resolved.value, from: parseStyleKey(resolved.key)?.breakpoint }
}
