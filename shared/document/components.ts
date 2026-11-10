/**
 * Built-in component registry. Each definition drives the palette, the
 * properties panel (one control per prop), validation, and the runtime
 * renderer. The page root uses the internal `Page` type, which is not in
 * the palette.
 */

export type PropValue = string | number | boolean

/**
 * `collection`: the slug of one of the project's collections ('' for none).
 * `field`: a field key of the enclosing Form's collection ('' for none).
 */
export type PropKind = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'link' | 'image' | 'icon' | 'collection' | 'field'

export interface PropDef {
  name: string
  label: string
  kind: PropKind
  default: PropValue
  options?: string[]
  description?: string
}

export interface ComponentDef {
  type: string
  label: string
  icon: string
  description: string
  container: boolean
  props: PropDef[]
  /** Design tokens, see `shared/design/tokens`. */
  defaultStyle: Record<string, string>
}

export const PAGE_ROOT_TYPE = 'Page'

const COLORS = ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral']

const ICON_HELP = 'A Lucide icon, e.g. i-lucide-coffee. Empty for none.'

export const COMPONENTS: ComponentDef[] = [
  {
    type: 'Container',
    label: 'Container',
    icon: 'i-lucide-square-dashed',
    description: 'A block that stacks its children vertically.',
    container: true,
    props: [],
    defaultStyle: { p: '4', gap: '3', items: 'start' }
  },
  {
    type: 'Row',
    label: 'Row',
    icon: 'i-lucide-columns-3',
    description: 'Lays out its children horizontally.',
    container: true,
    props: [
      { name: 'wrap', label: 'Wrap', kind: 'boolean', default: true }
    ],
    defaultStyle: { gap: '3', items: 'center' }
  },
  {
    type: 'Column',
    label: 'Column',
    icon: 'i-lucide-rows-3',
    description: 'Lays out its children vertically.',
    container: true,
    props: [],
    defaultStyle: { gap: '3', items: 'start' }
  },
  {
    type: 'Grid',
    label: 'Grid',
    icon: 'i-lucide-layout-grid',
    description: 'Lays out its children in equal columns; a child can span several with colSpan.',
    container: true,
    props: [],
    defaultStyle: { cols: '3', gap: '6' }
  },
  {
    type: 'Heading',
    label: 'Heading',
    icon: 'i-lucide-heading',
    description: 'A title (h1 to h4).',
    container: false,
    props: [
      { name: 'text', label: 'Text', kind: 'text', default: 'Heading' },
      { name: 'level', label: 'Level', kind: 'select', default: '2', options: ['1', '2', '3', '4'] }
    ],
    defaultStyle: {}
  },
  {
    type: 'Text',
    label: 'Text',
    icon: 'i-lucide-type',
    description: 'A paragraph of text.',
    container: false,
    props: [
      { name: 'text', label: 'Text', kind: 'textarea', default: 'Some text' }
    ],
    defaultStyle: {}
  },
  {
    type: 'Image',
    label: 'Image',
    icon: 'i-lucide-image',
    description: 'An image from a URL.',
    container: false,
    props: [
      { name: 'src', label: 'Source URL', kind: 'image', default: 'https://placehold.co/600x400' },
      { name: 'alt', label: 'Alt text', kind: 'text', default: '' }
    ],
    defaultStyle: { w: 'full' }
  },
  {
    type: 'Button',
    label: 'Button',
    icon: 'i-lucide-mouse-pointer-click',
    description: 'A button. Its action links to a page or URL (link, uses to), submits the enclosing Form (submit), or shows a toast with its message (toast).',
    container: false,
    props: [
      { name: 'label', label: 'Label', kind: 'text', default: 'Button' },
      { name: 'action', label: 'Action', kind: 'select', default: 'link', options: ['link', 'submit', 'toast'], description: 'link opens "Link to"; submit sends the enclosing Form; toast shows the message.' },
      { name: 'to', label: 'Link to', kind: 'link', default: '', description: 'A page slug or an absolute URL.' },
      { name: 'message', label: 'Toast message', kind: 'text', default: '', description: 'Shown by the toast action.' },
      { name: 'icon', label: 'Icon', kind: 'icon', default: '', description: ICON_HELP },
      { name: 'trailingIcon', label: 'Trailing icon', kind: 'icon', default: '', description: ICON_HELP },
      { name: 'color', label: 'Color', kind: 'select', default: 'primary', options: COLORS },
      { name: 'variant', label: 'Variant', kind: 'select', default: 'solid', options: ['solid', 'outline', 'soft', 'subtle', 'ghost', 'link'] },
      { name: 'size', label: 'Size', kind: 'select', default: 'md', options: ['xs', 'sm', 'md', 'lg', 'xl'] }
    ],
    defaultStyle: {}
  },
  {
    type: 'Link',
    label: 'Link',
    icon: 'i-lucide-link',
    description: 'A text link to a page or URL.',
    container: false,
    props: [
      { name: 'label', label: 'Label', kind: 'text', default: 'Link' },
      { name: 'to', label: 'Link to', kind: 'link', default: '', description: 'A page slug or an absolute URL.' },
      { name: 'icon', label: 'Icon', kind: 'icon', default: '', description: ICON_HELP }
    ],
    defaultStyle: { color: 'primary' }
  },
  {
    type: 'Input',
    label: 'Input',
    icon: 'i-lucide-text-cursor-input',
    description: 'A labelled text field. Inside a Form, field names the collection field its value is saved to.',
    container: false,
    props: [
      { name: 'label', label: 'Label', kind: 'text', default: 'Label' },
      { name: 'field', label: 'Field', kind: 'field', default: '', description: 'The field of the Form\'s collection this input fills.' },
      { name: 'placeholder', label: 'Placeholder', kind: 'text', default: '' },
      { name: 'inputType', label: 'Type', kind: 'select', default: 'text', options: ['text', 'email', 'number', 'password'] }
    ],
    defaultStyle: {}
  },
  {
    type: 'List',
    label: 'List',
    icon: 'i-lucide-list',
    description: 'Repeats its children once per record of a collection. Inside them, text, labels, image sources and links can use {{ item.<field> }} (and {{ item.id }}). Wrap several children in a Row or Card to keep each record together.',
    container: true,
    props: [
      { name: 'collection', label: 'Collection', kind: 'collection', default: '', description: 'The collection slug whose records are listed.' },
      { name: 'limit', label: 'Limit', kind: 'number', default: 10, description: 'At most this many records (1–100).' },
      { name: 'sortField', label: 'Sort by', kind: 'text', default: '', description: 'A field key, createdAt or updatedAt. Empty keeps creation order.' },
      { name: 'sortDir', label: 'Sort direction', kind: 'select', default: 'asc', options: ['asc', 'desc'] },
      { name: 'filterField', label: 'Filter field', kind: 'text', default: '', description: 'Only records whose field equals the filter value.' },
      { name: 'filterValue', label: 'Filter value', kind: 'text', default: '' },
      { name: 'layout', label: 'Layout', kind: 'select', default: 'stack', options: ['stack', 'grid', 'row'], description: 'grid uses the cols token.' }
    ],
    defaultStyle: { gap: '3', items: 'start' }
  },
  {
    type: 'Form',
    label: 'Form',
    icon: 'i-lucide-send',
    description: 'A form that adds a record to a collection on submit: an internal one, or a connection collection with a create endpoint (the record is sent to the remote API). Put Inputs inside (each with field set to a collection field) and a Button with action submit. In the published app the collection must be publicCreate; anyone, including other websites, can then post records to it.',
    container: true,
    props: [
      { name: 'collection', label: 'Collection', kind: 'collection', default: '', description: 'The collection that receives the records: internal, or a connection collection with a create endpoint.' },
      { name: 'successMessage', label: 'Success message', kind: 'text', default: 'Thanks!', description: 'Toast shown after a successful submit.' },
      { name: 'redirectTo', label: 'Then go to', kind: 'link', default: '', description: 'Optional page slug or URL to open after a successful submit.' },
      { name: 'resetOnSuccess', label: 'Reset on success', kind: 'boolean', default: true }
    ],
    defaultStyle: { gap: '3', items: 'start' }
  },
  {
    type: 'Card',
    label: 'Card',
    icon: 'i-lucide-square',
    description: 'A bordered surface holding other components.',
    container: true,
    props: [],
    defaultStyle: { gap: '3', items: 'start' }
  }
]

const BY_TYPE = new Map(COMPONENTS.map(c => [c.type, c]))

export function getComponent(type: string): ComponentDef | undefined {
  return BY_TYPE.get(type)
}

export function isContainerType(type: string): boolean {
  return type === PAGE_ROOT_TYPE || getComponent(type)?.container === true
}

const STACK_TYPES = [PAGE_ROOT_TYPE, 'Container', 'Column', 'Form', 'Card']

/** Whether the type lays its children out with flexbox, so `direction`, `items` and `justify` apply. */
export function isFlexType(type: string): boolean {
  return type === 'Row' || STACK_TYPES.includes(type)
}

/**
 * The tokens a type renders with before its own style: the flex direction of
 * the flex containers. A `direction` token of the node replaces it, and a
 * breakpoint one (`md:direction`) applies above it.
 */
export function structuralStyle(type: string): Record<string, string> {
  if (type === 'Row') return { direction: 'row' }
  return STACK_TYPES.includes(type) ? { direction: 'col' } : {}
}
