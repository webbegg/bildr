import type { Value } from '@bildr/codegen/model'
import { PALETTE } from '@bildr/codegen/edit'
import { BUTTON_COLORS, BUTTON_SIZES, BUTTON_VARIANTS, CONTAINER_TAGS, INPUT_TYPES, LIST_LAYOUTS } from '@bildr/codegen/render'
import { nodeIcon } from '../design/icons.ts'

/**
 * The props the inspector edits per node type: the hosted `shared/document/components.ts`
 * (`COMPONENTS`, `PropDef`) over the module's node types. A node type's props are the keys
 * `NODE_PROPS` of `@bildr/codegen/render` allows; each is a `PropDef` with a control kind. A
 * prop the node leaves out is at its `default` (the model has no prop for a default, so a
 * write of the default removes it). Other props of a node (a List's `items`, a Form's
 * `action`) are bindings with their own panels.
 */

/** `page`: the id of a page (a Link's `to: { page }`). The rest are the hosted kinds. */
export type PropKind = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'link' | 'image' | 'icon' | 'page'

export interface PropDef {
  name: string
  label: string
  kind: PropKind
  /** What the node renders with when the prop is absent. */
  default: Value
  options?: string[]
  /** A select whose values are numbers (a heading level). */
  numeric?: boolean
  description?: string
  /** The hint an empty text field shows. */
  placeholder?: string
}

export type PropValue = Value

const ICON_HELP = 'A Lucide icon, e.g. i-lucide-coffee. Empty for none.'

const text = (name: string, label: string, extra: Partial<PropDef> = {}): PropDef => ({ name, label, kind: 'text', default: '', ...extra })
const toggle = (name: string, label: string, fallback = false, extra: Partial<PropDef> = {}): PropDef => ({ name, label, kind: 'boolean', default: fallback, ...extra })
const choice = (name: string, label: string, options: readonly string[], fallback: string, extra: Partial<PropDef> = {}): PropDef => ({ name, label, kind: 'select', default: fallback, options: [...options], ...extra })

const tag = choice('tag', 'Tag', CONTAINER_TAGS, CONTAINER_TAGS[0]!)

export const NODE_PROP_DEFS: Record<string, PropDef[]> = {
  Page: [tag],
  Container: [tag],
  Row: [tag, toggle('wrap', 'Wrap')],
  Heading: [text('text', 'Text'), choice('level', 'Level', ['1', '2', '3', '4', '5', '6'], '2', { numeric: true })],
  Text: [{ name: 'text', label: 'Text', kind: 'textarea', default: '' }],
  Image: [{ name: 'src', label: 'Source URL', kind: 'image', default: '' }, text('alt', 'Alt text')],
  Link: [
    text('text', 'Label'),
    { name: 'to', label: 'Link to', kind: 'page', default: '', description: 'A page of the project; a URL goes in URL.' },
    text('href', 'URL', { description: 'An http(s), mailto: or tel: URL, or a path starting with /.' }),
    { name: 'icon', label: 'Icon', kind: 'icon', default: '', description: ICON_HELP }
  ],
  Button: [
    text('text', 'Label'),
    choice('type', 'Type', ['button', 'submit'], 'button'),
    text('href', 'URL', { description: 'An http(s), mailto: or tel: URL, or a path starting with /.' }),
    { name: 'icon', label: 'Icon', kind: 'icon', default: '', description: ICON_HELP },
    { name: 'trailingIcon', label: 'Trailing icon', kind: 'icon', default: '', description: ICON_HELP },
    choice('color', 'Color', BUTTON_COLORS, 'primary'),
    choice('variant', 'Variant', BUTTON_VARIANTS, 'solid'),
    choice('size', 'Size', BUTTON_SIZES, 'md'),
    toggle('disabled', 'Disabled')
  ],
  Input: [
    text('label', 'Label'),
    text('field', 'Field', { description: 'The field of the enclosing Form this input fills.' }),
    text('placeholder', 'Placeholder'),
    choice('inputType', 'Type', INPUT_TYPES, 'text'),
    toggle('multiline', 'Multiline'),
    { name: 'rows', label: 'Rows', kind: 'number', default: 3 }
  ],
  Checkbox: [text('label', 'Label'), text('field', 'Field', { description: 'The boolean field of the enclosing Form this checkbox fills.' })],
  List: [
    text('as', 'Item name', { description: 'What the List calls each record inside it.' }),
    choice('layout', 'Layout', LIST_LAYOUTS, 'stack', { description: 'grid uses the cols token.' }),
    tag,
    text('empty', 'Empty text'),
    text('loading', 'Loading text'),
    toggle('hideWhenEmpty', 'Hide when empty'),
    { name: 'loadMore', label: 'Load more', kind: 'number', default: 0, description: 'A Load more button reads this many records at a time. 0 for none.' }
  ],
  Form: []
}

/** `visible` is every node's (but an Instance's and a SlotFill's): false hides it in the app and on the canvas. */
export const VISIBLE_DEF: PropDef = toggle('visible', 'Visible', true, { description: 'Off hides it in the app and on the canvas.' })

/** The props the inspector shows for a node type, `visible` last (not for an Instance or a SlotFill). */
export function propDefsOf(type: string): PropDef[] {
  return [...NODE_PROP_DEFS[type] ?? [], ...(type === 'Instance' || type === 'SlotFill' ? [] : [VISIBLE_DEF])]
}

/** The props whose value a binding can give, by node type (`$bind`, or a `$template` with names in it). */
export const BINDABLE: Record<string, string[]> = {
  Heading: ['text'],
  Text: ['text'],
  Button: ['text'],
  Link: ['text'],
  Image: ['src', 'alt']
}

const CONTAINER_TYPES = new Set(['Page', 'Instance', 'SlotFill', ...PALETTE.filter(entry => entry.container).map(entry => entry.type)])

/** Whether a node type holds child nodes (the hosted `isContainerType`). */
export const isContainerType = (type: string): boolean => CONTAINER_TYPES.has(type)

/** The hosted `getComponent(type)`: the label, icon and props of a node type; undefined for an unknown one. */
export function nodeDef(type: string): { type: string, label: string, icon: string, container: boolean, props: PropDef[] } | undefined {
  const entry = PALETTE.find(item => item.type === type)
  if (!entry && !['Page', 'Instance', 'SlotFill'].includes(type)) return undefined
  return { type, label: entry?.label ?? type, icon: nodeIcon(type), container: isContainerType(type), props: propDefsOf(type) }
}
