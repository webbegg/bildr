import { BUTTON_COLORS, BUTTON_SIZES, BUTTON_VARIANTS, CONTAINER_TAGS, INPUT_TYPES, LIST_LAYOUTS } from '@bildr/codegen/render'

/**
 * The props the inspector edits per node type (the keys `NODE_PROPS` of
 * `@bildr/codegen/render` allows, here with a control). Other props of a node
 * (a List's `items`, a Form's `action`: bindings) show read-only.
 */

export type PropControl = 'text' | 'textarea' | 'number' | 'switch' | 'select' | 'page'

export interface PropSpec {
  key: string
  label: string
  control: PropControl
  options?: readonly string[]
  /** A select whose values are numbers (a heading level). */
  numeric?: boolean
  /** The value a switch has when the prop is absent. */
  fallback?: boolean
}

const tag: PropSpec = { key: 'tag', label: 'Tag', control: 'select', options: CONTAINER_TAGS }
const text = (key: string, label: string): PropSpec => ({ key, label, control: 'text' })
const toggle = (key: string, label: string, fallback = false): PropSpec => ({ key, label, control: 'switch', fallback })
const choice = (key: string, label: string, options: readonly string[]): PropSpec => ({ key, label, control: 'select', options })

export const PROP_SPECS: Record<string, PropSpec[]> = {
  Page: [tag],
  Container: [tag],
  Row: [tag, toggle('wrap', 'Wrap')],
  Heading: [{ key: 'text', label: 'Text', control: 'text' }, { key: 'level', label: 'Level', control: 'select', options: ['1', '2', '3', '4', '5', '6'], numeric: true }],
  Text: [{ key: 'text', label: 'Text', control: 'textarea' }],
  Image: [text('src', 'Source'), text('alt', 'Alt text')],
  Link: [text('text', 'Text'), text('href', 'URL'), { key: 'to', label: 'Page', control: 'page' }, text('icon', 'Icon')],
  Button: [
    text('text', 'Text'), choice('type', 'Type', ['button', 'submit']), choice('color', 'Color', BUTTON_COLORS), choice('variant', 'Variant', BUTTON_VARIANTS),
    choice('size', 'Size', BUTTON_SIZES), text('icon', 'Icon'), text('trailingIcon', 'Trailing icon'), text('href', 'URL'), toggle('disabled', 'Disabled')
  ],
  Input: [text('label', 'Label'), text('placeholder', 'Placeholder'), text('field', 'Field'), choice('inputType', 'Type', INPUT_TYPES), toggle('multiline', 'Multiline'), { key: 'rows', label: 'Rows', control: 'number' }],
  Checkbox: [text('label', 'Label'), text('field', 'Field')],
  List: [text('as', 'Item name'), choice('layout', 'Layout', LIST_LAYOUTS), tag, text('empty', 'Empty text'), text('loading', 'Loading text'), toggle('hideWhenEmpty', 'Hide when empty'), { key: 'loadMore', label: 'Load more (page size)', control: 'number' }],
  Form: []
}

/** `visible` is every node's: false hides it (in the app and on the canvas). */
export const VISIBLE_SPEC: PropSpec = toggle('visible', 'Visible', true)

/** The props whose value a binding can give, by node type (`$bind`, or a `$template` with names in it). */
export const BINDABLE: Record<string, string[]> = {
  Heading: ['text'],
  Text: ['text'],
  Button: ['text'],
  Link: ['text'],
  Image: ['src', 'alt']
}
