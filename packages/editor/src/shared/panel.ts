import { parseStyleKey, styleKey } from '@bildr/codegen/design'
import type { Breakpoint, BreakpointBase } from '@bildr/codegen/design'
import { isFlexType } from '@bildr/codegen/render'
import { spacingSide } from '@bildr/editor-core/spacing'
import type { Side, SpacingBox } from '@bildr/editor-core/spacing'
import { deviceOf, styleProvenance } from '@bildr/editor-core/styleFields'
import type { DeviceId, Provenance } from '@bildr/editor-core/styleFields'
import { isContainerType } from './nodeProps.ts'

/**
 * The right panel in Framer's sections, as a row model (the hosted `shared/editor/panel.ts`,
 * over the module's node types). Each section shows
 * its core rows (where they apply to the node); Fill, Border and Shadows are
 * inline "Add…" slots; the other optional properties sit in the header "+"
 * menu until the node has a value for them (at any breakpoint), and an added
 * one shows a "−" where the edited breakpoint sets it. A section with no row
 * to show collapses to its title and "+" (Framer's rule), so the panel only
 * grows with real content: Layout on a leaf (Padding, Margin, Align self,
 * Overflow, like Framer's frame without a layout, and no Reset layout, since
 * each added row has its own "−"), and Typography on a node without text of
 * its own (a container or an Image) until a text token is set. The page root
 * shows Layout first.
 *
 * Size leads with "In parent" (layout-containers L2): how the parent lays the
 * node out (Stack, Grid or None) and the rows that depend on it, Align self
 * in a stack or grid and the column span in a grid. A stack's Wrap sits
 * beside its Direction, and its Distribute and Align are one alignment
 * matrix (`alignMatrix.ts`).
 */

export const PANEL_SECTIONS = ['Size', 'Layout', 'Styles', 'Typography'] as const

export type PanelSection = typeof PANEL_SECTIONS[number]

const PADDING = ['p', 'px', 'py', 'pt', 'pr', 'pb', 'pl']
const MARGIN = ['m', 'mx', 'my', 'mt', 'mr', 'mb', 'ml']

interface RowDef {
  section: PanelSection
  keys: string[]
  /**
   * `core` rows show wherever they apply; a `slot` shows as "Add…" until set;
   * a `menu` row is offered by the header "+" until it has a value.
   */
  kind: 'core' | 'slot' | 'menu'
  /** What adding it writes (base keys); empty only reveals the control. */
  add?: Record<string, string>
}

const ROWS = {
  // In parent: first in Size, where the parent's layout uses them.
  self: { section: 'Size', kind: 'core', keys: ['self'], add: { self: 'center' } },
  span: { section: 'Size', kind: 'core', keys: ['colSpan'] },
  width: { section: 'Size', kind: 'core', keys: ['w'] },
  height: { section: 'Size', kind: 'core', keys: ['h'] },
  maxWidth: { section: 'Size', kind: 'menu', keys: ['maxW'], add: { maxW: 'full' } },
  minWidth: { section: 'Size', kind: 'menu', keys: ['minW'], add: { minW: '0' } },
  maxHeight: { section: 'Size', kind: 'menu', keys: ['maxH'], add: { maxH: 'full' } },
  minHeight: { section: 'Size', kind: 'menu', keys: ['minH'], add: { minH: '0' } },
  // Type writes `display`, which Styles owns; it shows the Stack, Grid or None rows.
  type: { section: 'Layout', kind: 'core', keys: [] },
  direction: { section: 'Layout', kind: 'core', keys: ['direction'] },
  distribute: { section: 'Layout', kind: 'core', keys: ['justify'] },
  align: { section: 'Layout', kind: 'core', keys: ['items'] },
  wrap: { section: 'Layout', kind: 'core', keys: ['flexWrap'] },
  columns: { section: 'Layout', kind: 'core', keys: ['cols'] },
  gap: { section: 'Layout', kind: 'core', keys: ['gap'] },
  // Core on a container, a menu item on a leaf.
  padding: { section: 'Layout', kind: 'core', keys: PADDING, add: { p: '2' } },
  margin: { section: 'Layout', kind: 'menu', keys: MARGIN, add: { m: '0' } },
  // Offered here rather than in Styles: it clips the layout's children.
  overflow: { section: 'Layout', kind: 'menu', keys: ['overflow'], add: { overflow: 'hidden' } },
  visible: { section: 'Styles', kind: 'core', keys: ['display'] },
  opacity: { section: 'Styles', kind: 'core', keys: ['opacity'] },
  fill: { section: 'Styles', kind: 'slot', keys: ['bg'], add: { bg: 'neutral-100' } },
  border: { section: 'Styles', kind: 'slot', keys: ['border', 'borderT', 'borderR', 'borderB', 'borderL', 'borderColor'], add: { border: '1', borderColor: 'default' } },
  shadows: { section: 'Styles', kind: 'slot', keys: ['shadow'], add: { shadow: 'md' } },
  radius: { section: 'Styles', kind: 'core', keys: ['rounded'] },
  // Individual corners only reveal their fields, which show the radius until set.
  corners: { section: 'Styles', kind: 'menu', keys: ['roundedTl', 'roundedTr', 'roundedBr', 'roundedBl'], add: {} },
  // Display only reveals its control: Visible and Type manage the usual values.
  display: { section: 'Styles', kind: 'menu', keys: ['display'], add: {} },
  fontSize: { section: 'Typography', kind: 'core', keys: ['text'] },
  fontWeight: { section: 'Typography', kind: 'core', keys: ['font'] },
  textAlign: { section: 'Typography', kind: 'core', keys: ['align'] },
  textColor: { section: 'Typography', kind: 'core', keys: ['color'] },
  letterSpacing: { section: 'Typography', kind: 'menu', keys: ['tracking'], add: { tracking: 'normal' } },
  lineHeight: { section: 'Typography', kind: 'menu', keys: ['leading'], add: { leading: 'normal' } },
  transform: { section: 'Typography', kind: 'menu', keys: ['textTransform'], add: { textTransform: 'uppercase' } }
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

const breakpointOf = (device: DeviceId, base: BreakpointBase) => deviceOf(device, base).breakpoint

/** The Type row's modes: a flex Stack, a Grid, or None (block flow). */
export type LayoutType = 'stack' | 'grid' | 'none'

const MODE_DISPLAY: Record<LayoutType, string> = { stack: 'flex', grid: 'grid', none: 'block' }

/** Whether a type has the Type row: the flex stacks and the Grid (a Card lays out an inner stack, a List follows its layout prop). */
const typed = (type: string) => type === 'Grid' || (isFlexType(type) && type !== 'Card')

/** Stack, Grid or None at the device (of a `base` project): the `display` token that applies (flex, grid or block), else the type's own layout. */
export function layoutType(type: string, style: Record<string, string>, device: DeviceId, base: BreakpointBase = 'mobile'): LayoutType | undefined {
  if (!typed(type)) return undefined
  const display = styleProvenance(style, 'display', device, base)
  const value = display.state === 'unset' ? undefined : display.value
  const mode = (Object.keys(MODE_DISPLAY) as LayoutType[]).find(m => MODE_DISPLAY[m] === value)
  return mode ?? (type === 'Grid' ? 'grid' : 'stack')
}

/**
 * The patch of the Type row at the device: Grid is `display: grid` (with two
 * columns unless some apply), Stack is `display: flex`, None `display:
 * block`; an override that the breakpoint below already gives is dropped
 * instead.
 */
export function layoutTypeWrite(type: string, style: Record<string, string>, device: DeviceId, next: LayoutType, base: BreakpointBase = 'mobile'): Record<string, string | null> {
  if (layoutType(type, style, device, base) === next) return {}
  const breakpoint = breakpointOf(device, base)
  const key = styleKey('display', breakpoint)
  const below = Object.fromEntries(Object.entries(style).filter(([other]) => other !== key))
  const patch: Record<string, string | null> = { [key]: layoutType(type, below, device, base) === next ? null : MODE_DISPLAY[next] }
  if (next === 'grid' && type !== 'Grid' && styleProvenance(style, 'cols', device, base).state === 'unset') patch[styleKey('cols', breakpoint)] = '2'
  return patch
}

export interface PanelNode {
  type: string
  /** The parent's type; a Grid or List child, or one of a parent laid out as a grid, gets a column span. */
  parentType?: string
  /** The parent's style: a Container with `display: grid` at the device is a grid parent. */
  parentStyle?: Record<string, string>
  root?: boolean
  style: Record<string, string>
  /** The display the node renders with when no token applies (see `naturalDisplay`). */
  natural?: string
}

export interface PanelRow {
  id: RowId
  /** An unset Fill, Border or Shadows: an "Add…" placeholder. */
  slot: boolean
  /** An optional row the edited breakpoint sets (or just added): it shows a "−" ("×" on a slot). */
  removable: boolean
}

export interface PanelMenuItem {
  id: RowId
}

export interface PanelSectionRows {
  section: PanelSection
  /** On Size, for a node with a parent: how the parent lays it out, the "In parent" heading over its rows. */
  inParent?: LayoutType
  rows: PanelRow[]
  /** No row to show: the section is its title and "+" only. */
  collapsed: boolean
  /** The header "+" menu: the optional rows that apply and are not shown. */
  menu: PanelMenuItem[]
  /** The header "−", Reset layout: on the Layout section of a container. */
  reset: boolean
}

export interface PanelView {
  device: DeviceId
  /** The project's breakpoint base, which maps the device to its level; mobile-first when absent. */
  base?: BreakpointBase
  /** Rows the user added this session, before or without a token. */
  added?: readonly RowId[]
  /** Base keys whose values differ across the selected nodes. */
  mixed?: readonly string[]
}

const GRID_TYPES = ['Grid', 'List']

/** Whether the node's parent lays it out in a grid at the device: a Grid or a List, or a parent whose Type is Grid there. */
const inGrid = (node: PanelNode, device: DeviceId, base: BreakpointBase): boolean =>
  !!node.parentType && (GRID_TYPES.includes(node.parentType) || layoutType(node.parentType, node.parentStyle ?? {}, device, base) === 'grid')

/** How the node's parent lays it out at the device; undefined without a parent (the page root). */
const parentLayout = (node: PanelNode, device: DeviceId, base: BreakpointBase): LayoutType | undefined => {
  if (node.root || !node.parentType) return undefined
  if (inGrid(node, device, base)) return 'grid'
  return layoutType(node.parentType, node.parentStyle ?? {}, device, base) ?? (isFlexType(node.parentType) ? 'stack' : 'none')
}

/** Whether a node shows text of its own (or is the page root, whose type styles the page): its typography rows are core. */
// A Link holds children in the model but shows its own `text` too, so its typography is core (the hosted Link is no container).
const textual = (node: PanelNode) => !!node.root || ((!isContainerType(node.type) || node.type === 'Link') && node.type !== 'Image')

/** The section order: the page root leads with Layout, as Framer's breakpoint frame does. */
const sectionOrder = (node: PanelNode): readonly PanelSection[] => (node.root ? ['Layout', 'Size', 'Styles', 'Typography'] : PANEL_SECTIONS)

/** The rendered sections for a node, their rows in Framer's order, and their "+" menus. */
export function panelRows(node: PanelNode, view: PanelView): PanelSectionRows[] {
  const { device, base = 'mobile', added = [], mixed = [] } = view
  const sets = (...keys: string[]) => Object.keys(node.style).some(key => keys.includes(baseKey(key) ?? ''))
  const container = isContainerType(node.type)
  const layout = layoutType(node.type, node.style, device, base)
  const stack = layout ? layout === 'stack' : isFlexType(node.type)
  const grid = layout ? layout === 'grid' : GRID_TYPES.includes(node.type)
  const parent = parentLayout(node, device, base)
  // Visible and Type manage hiding, the natural display and (for typed stacks) flex, grid or block.
  const managed = ['hidden', node.natural, ...(typed(node.type) ? Object.values(MODE_DISPLAY) : [])]
  const setsDisplay = Object.entries(node.style).some(([key, value]) => baseKey(key) === 'display' && !managed.includes(value))

  // Whether a row applies to the node; an optional one is then shown or offered.
  const applies: Record<RowId, boolean> = {
    width: true,
    height: true,
    maxWidth: true,
    minWidth: true,
    maxHeight: true,
    minHeight: true,
    type: !!layout,
    direction: stack || sets('direction'),
    distribute: stack || sets('justify'),
    align: stack || sets('items'),
    // A stack's Wrap is beside its Direction; a row of its own only where something else sets it.
    wrap: !stack && sets('flexWrap'),
    columns: grid || (sets('cols') && !stack),
    gap: (container && layout !== 'none') || sets('gap'),
    padding: true,
    span: parent === 'grid' || sets('colSpan'),
    margin: !node.root,
    self: parent === 'stack' || parent === 'grid' || (!node.root && sets('self')),
    overflow: true,
    visible: !node.root,
    opacity: true,
    fill: true,
    border: true,
    shadows: true,
    radius: true,
    corners: true,
    display: !node.root,
    fontSize: true,
    fontWeight: true,
    textAlign: true,
    textColor: true,
    letterSpacing: true,
    lineHeight: true,
    transform: true
  }
  const kind = (row: RowId) => {
    if (row === 'padding' && !container) return 'menu'
    if (def(row).section === 'Typography' && !textual(node)) return 'menu'
    return def(row).kind
  }
  const valued = (row: RowId) => (row === 'display' ? setsDisplay : sets(...rowKeys(row)))
  const has = (row: RowId) => added.includes(row) || rowKeys(row).some(key => mixed.includes(key)) || valued(row)
  const shown = (row: RowId) => applies[row] && (kind(row) !== 'menu' || has(row))
  const removable = (row: RowId) => kind(row) !== 'core' && (rowProvenance(node.style, row, device, base).state === 'set' || (added.includes(row) && !valued(row)))
  const inSection = (section: PanelSection) => ROW_IDS.filter(row => def(row).section === section)

  return sectionOrder(node).map((section) => {
    const rows = inSection(section).filter(shown).map(id => ({ id, slot: kind(id) === 'slot' && !has(id), removable: removable(id) }))
    return {
      section,
      ...(section === 'Size' && parent ? { inParent: parent } : {}),
      rows,
      collapsed: rows.length === 0,
      menu: inSection(section).filter(row => applies[row] && kind(row) === 'menu' && !shown(row)).map(id => ({ id })),
      reset: section === 'Layout' && (container || !!layout)
    }
  })
}

/** What adding an optional row writes (base keys; the panel puts responsive ones at the device). */
export function rowAdd(row: RowId): Record<string, string> {
  return { ...(def(row) as RowDef).add }
}

/** The patch that resets a row on a device (Reset override, or its "−"): its keys set at exactly that breakpoint. */
export function rowReset(style: Record<string, string>, row: RowId, breakpoint: Breakpoint | undefined): Record<string, null> {
  const keys = rowKeys(row)
  return Object.fromEntries(Object.keys(style).filter((key) => {
    const parsed = parseStyleKey(key)
    return !!parsed && keys.includes(parsed.token.key) && parsed.breakpoint === breakpoint
  }).map(key => [key, null]))
}

/** A row's provenance on a device: set if any of its keys is set there, else inherited if one applies. */
export function rowProvenance(style: Record<string, string>, row: RowId, device: DeviceId, base: BreakpointBase = 'mobile'): Provenance {
  const all = rowKeys(row).map(key => styleProvenance(style, key, device, base))
  return all.find(p => p.state === 'set') ?? all.find(p => p.state === 'inherited') ?? { state: 'unset' }
}

/**
 * The Layout header's "−", Reset layout: the Layout section's tokens set at
 * the device's breakpoint, and the Type row's flex, grid or block display
 * there (hiding stays the Visible row's).
 */
export function layoutReset(style: Record<string, string>, device: DeviceId, base: BreakpointBase = 'mobile'): Record<string, null> {
  const set = [...sectionKeys('Layout'), 'display'].flatMap((key) => {
    const p = styleProvenance(style, key, device, base)
    return p.state === 'set' && (key !== 'display' || Object.values(MODE_DISPLAY).includes(p.value)) ? [p.key] : []
  })
  return Object.fromEntries(set.map(key => [key, null]))
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
