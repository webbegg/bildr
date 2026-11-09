/**
 * Built-in component registry. Each definition drives the palette, the
 * properties panel (one control per prop), validation, and the runtime
 * renderer. The page root uses the internal `Page` type, which is not in
 * the palette.
 */

export type PropValue = string | number | boolean

export type PropKind = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'link' | 'image'

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

export const COMPONENTS: ComponentDef[] = [
  {
    type: 'Container',
    label: 'Container',
    icon: 'i-lucide-square-dashed',
    description: 'A block that stacks its children vertically.',
    container: true,
    props: [],
    defaultStyle: { p: '4', gap: '3' }
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
    defaultStyle: { gap: '3' }
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
    defaultStyle: { color: 'toned' }
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
    description: 'A button, optionally linking to a page or URL.',
    container: false,
    props: [
      { name: 'label', label: 'Label', kind: 'text', default: 'Button' },
      { name: 'to', label: 'Link to', kind: 'link', default: '', description: 'A page slug or an absolute URL.' },
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
      { name: 'to', label: 'Link to', kind: 'link', default: '', description: 'A page slug or an absolute URL.' }
    ],
    defaultStyle: { color: 'primary' }
  },
  {
    type: 'Input',
    label: 'Input',
    icon: 'i-lucide-text-cursor-input',
    description: 'A labelled text field.',
    container: false,
    props: [
      { name: 'label', label: 'Label', kind: 'text', default: 'Label' },
      { name: 'placeholder', label: 'Placeholder', kind: 'text', default: '' },
      { name: 'inputType', label: 'Type', kind: 'select', default: 'text', options: ['text', 'email', 'number', 'password'] }
    ],
    defaultStyle: {}
  },
  {
    type: 'Card',
    label: 'Card',
    icon: 'i-lucide-square',
    description: 'A bordered surface holding other components.',
    container: true,
    props: [],
    defaultStyle: { gap: '3' }
  }
]

const BY_TYPE = new Map(COMPONENTS.map(c => [c.type, c]))

export function getComponent(type: string): ComponentDef | undefined {
  return BY_TYPE.get(type)
}

export function isContainerType(type: string): boolean {
  return type === PAGE_ROOT_TYPE || getComponent(type)?.container === true
}
