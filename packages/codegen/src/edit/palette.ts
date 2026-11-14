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
  type: string
  label: string
  description: string
  /** Holds child nodes. */
  container: boolean
  props: Record<string, Value>
  style: Record<string, string>
}

export const PALETTE: readonly PaletteEntry[] = [
  { type: 'Container', label: 'Container', description: 'A block that stacks its children vertically.', container: true, props: {}, style: { p: '4', gap: '3', items: 'start' } },
  { type: 'Row', label: 'Row', description: 'Lays out its children horizontally.', container: true, props: { wrap: true }, style: { gap: '3', items: 'center' } },
  { type: 'Column', label: 'Column', description: 'Lays out its children vertically.', container: true, props: {}, style: { gap: '3', items: 'start' } },
  { type: 'Grid', label: 'Grid', description: 'Lays out its children in equal columns; a child can span several with colSpan.', container: true, props: {}, style: { cols: '3', gap: '6' } },
  { type: 'Card', label: 'Card', description: 'A bordered surface holding other nodes.', container: true, props: {}, style: { gap: '3', items: 'start' } },
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

/** Types a tree holds that the palette doesn't offer: the root of a page, uses of components and slot content. */
export const INTERNAL_TYPES = ['Page', 'Instance', 'SlotFill'] as const

export const paletteEntry = (type: string): PaletteEntry | undefined => PALETTE.find(entry => entry.type === type)

/** Whether `type` is a node type the model knows. */
export const isNodeType = (type: string): boolean => type in NODE_PROPS

/** Whether a node of `type` holds children (an Instance holds only SlotFills). */
export const isContainerType = (type: string): boolean =>
  type === 'Page' || type === 'SlotFill' || type === 'Instance' || paletteEntry(type)?.container === true

/** The props a link default gives up when the node is given the other link prop. */
export const LINK_PROPS = ['to', 'href']
