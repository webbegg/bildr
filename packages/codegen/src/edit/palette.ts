import { NODE_PROPS } from '../render/rules.ts'
import type { Value } from '../model/schemas.ts'

/**
 * The node types the editor inserts, with the defaults a new node gets: the
 * hosted palette (`shared/document/components.ts`) in `.bildr` props
 * (P2a/P2b shapes). Renamed props: the hosted `label` of a Button or Link is
 * `text`, a Heading `level` is a number. Defaults the generator gives anyway
 * (a Button's primary/solid/md, empty strings) are left out; the hosted List
 * and Form `collection` settings become Queries and Actions (P5), so a new
 * List or Form still needs its `items` or `action`.
 */

export interface PaletteEntry {
  /** The stored node type. */
  type: string
  /**
   * A layout preset of a Container (layout-containers): what `node_insert`
   * and `node_wrap` take as `preset`, and the name of the node's id. Every
   * preset's node is a plain Container with the preset's tokens.
   */
  preset?: string
  /** The layer name a preset's node gets, when its layout alone wouldn't name it (a Card). */
  name?: string
  label: string
  description: string
  /** Holds child nodes. */
  container: boolean
  props: Record<string, Value>
  style: Record<string, string>
}

export const PALETTE: readonly PaletteEntry[] = [
  { type: 'Container', preset: 'Stack', label: 'Stack', description: 'A Container that stacks its children vertically, with padding. Every layout preset is a Container: its display, direction, wrap, gap, alignment and columns are style tokens.', container: true, props: {}, style: { p: '4', gap: '3', items: 'start' } },
  { type: 'Container', preset: 'Row', label: 'Row', description: 'A Container that lays out its children horizontally and wraps them (direction: row, flexWrap: wrap).', container: true, props: {}, style: { direction: 'row', flexWrap: 'wrap', gap: '3', items: 'center' } },
  { type: 'Container', preset: 'Column', label: 'Column', description: 'A Container that lays out its children vertically, without padding (direction: col).', container: true, props: {}, style: { direction: 'col', gap: '3', items: 'start' } },
  { type: 'Container', preset: 'Grid', label: 'Grid', description: 'A Container that lays out its children in equal columns (display: grid, cols); a child can span several with colSpan.', container: true, props: {}, style: { display: 'grid', cols: '3', gap: '6' } },
  { type: 'Container', preset: 'Card', name: 'Card', label: 'Card', description: 'A Container on a bordered, rounded surface (p, rounded, bg, border, borderColor, overflow tokens) that stacks its children.', container: true, props: {}, style: { p: '6', gap: '3', items: 'start', rounded: 'lg', bg: 'default', border: '1', borderColor: 'default', overflow: 'hidden' } },
  { type: 'Heading', label: 'Heading', description: 'A title (h1 to h6).', container: false, props: { text: 'Heading', level: 2 }, style: {} },
  { type: 'Text', label: 'Text', description: 'A paragraph of text.', container: false, props: { text: 'Some text' }, style: {} },
  { type: 'Image', label: 'Image', description: 'An image from a URL (or /uploads/…).', container: false, props: { src: 'https://placehold.co/600x400', alt: '' }, style: { w: 'full' } },
  { type: 'Button', label: 'Button', description: 'A button: its interactions run actions, navigate or show a toast; `href` links to a URL.', container: false, props: { text: 'Button' }, style: {} },
  { type: 'Link', label: 'Link', description: 'A link to a page (`to: { page }`) or a URL (`href`).', container: true, props: { text: 'Link', href: '/' }, style: { color: 'primary' } },
  { type: 'Input', label: 'Input', description: 'A labelled field of the enclosing Form (`field`).', container: false, props: { label: 'Label' }, style: {} },
  { type: 'Checkbox', label: 'Checkbox', description: 'A checkbox of a boolean Form field (`field`) or bound to a value.', container: false, props: { label: 'Checkbox' }, style: {} },
  { type: 'List', label: 'List', description: 'Repeats its children once per item of a Query (`items: { $bind }`), each named `as`.', container: true, props: { as: 'item' }, style: { gap: '3', items: 'start' } },
  { type: 'Form', label: 'Form', description: 'Submits its fields to an Action (`action`, `fields`).', container: true, props: {}, style: { gap: '3', items: 'start' } }
]

/**
 * The layout types before the one-container model: still stored, rendered
 * and accepted as `type`, but no longer offered; their presets replace them.
 */
export const LEGACY_LAYOUT_TYPES: readonly PaletteEntry[] = [
  { type: 'Row', label: 'Row', description: 'Legacy: lays out its children horizontally. Insert the preset "Row" instead.', container: true, props: { wrap: true }, style: { gap: '3', items: 'center' } },
  { type: 'Column', label: 'Column', description: 'Legacy: lays out its children vertically. Insert the preset "Column" instead.', container: true, props: {}, style: { gap: '3', items: 'start' } },
  { type: 'Grid', label: 'Grid', description: 'Legacy: lays out its children in equal columns. Insert the preset "Grid" instead.', container: true, props: {}, style: { cols: '3', gap: '6' } },
  { type: 'Card', label: 'Card', description: 'Legacy: a bordered surface holding other nodes. Insert the preset "Card" instead.', container: true, props: {}, style: { gap: '3', items: 'start' } }
]

/** Types a tree holds that the palette doesn't offer: the root of a page, uses of components and slot content. */
export const INTERNAL_TYPES = ['Page', 'Instance', 'SlotFill'] as const

/** The defaults a node of `type` is inserted with (a Container's are the Stack preset's). */
export const paletteEntry = (type: string): PaletteEntry | undefined =>
  PALETTE.find(entry => entry.type === type) ?? LEGACY_LAYOUT_TYPES.find(entry => entry.type === type)

/** The layout presets, in palette order. */
export const PRESETS: readonly PaletteEntry[] = PALETTE.filter(entry => entry.preset !== undefined)

export const presetEntry = (preset: string): PaletteEntry | undefined => PRESETS.find(entry => entry.preset === preset)

/** Whether `type` is a node type the model knows. */
export const isNodeType = (type: string): boolean => type in NODE_PROPS

/** Whether a node of `type` holds children (an Instance holds only SlotFills). */
export const isContainerType = (type: string): boolean =>
  type === 'Page' || type === 'SlotFill' || type === 'Instance' || paletteEntry(type)?.container === true

/** The props a link default gives up when the node is given the other link prop. */
export const LINK_PROPS = ['to', 'href']
