/**
 * The render rules (spec V4, RA §6): per node type, what the generator
 * (`generate/ui.ts`) and the editor canvas (`BildrNode.vue`) both need to
 * render a node the same way: its element or Nuxt UI component, and the
 * token fallbacks it renders with before its own style (a token of the same
 * key replaces them). Token → class resolution is `styleClasses` and
 * `styleInline` in `../design/tokens.ts`, already shared.
 *
 * Where the two sides disagree today, the rule here is what one side does
 * and `KNOWN_DIVERGENCES` names the disagreement, so P2 decides it once.
 * Pure data and functions: no Vue, no DOM.
 */

/** The element of a node type that renders as one fixed element or Nuxt UI component. */
export const NODE_ELEMENTS = {
  Text: 'p',
  Button: 'UButton',
  Link: 'NuxtLink',
  Checkbox: 'UCheckbox',
  Form: 'form',
  /** The labelled field wrapping an Input's control. */
  Input: 'UFormField',
  InputControl: 'UInput',
  InputMultiline: 'UTextarea'
} as const

/** The tags a Page, Container, Row or List may render as (`props.tag`); the first is the default. */
export const CONTAINER_TAGS = ['div', 'section', 'article', 'aside', 'header', 'nav', 'main', 'footer']

/** The class of an Input's control: it fills its field. */
export const INPUT_CONTROL_CLASS = 'w-full'

/** The flex containers that stack their children vertically. */
const STACK_TYPES = ['Page', 'Container', 'Column', 'Form', 'Card']

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

/**
 * The display class a type renders with; a base `display` token replaces it
 * (see `displayFallback`). Empty for types that keep their element's display.
 */
export function displayOf(type: string): string {
  if (isFlexType(type)) return 'flex'
  if (type === 'Grid') return 'grid'
  if (type === 'Image') return 'block'
  return ''
}

/** The level of a Heading without one. */
export const DEFAULT_HEADING_LEVEL = 2

/** `h1`…`h6`. */
export function headingTag(level: number | string): string {
  return `h${level}`
}

/** The typography a Heading renders with by level, before its own tokens. */
export const HEADING_TOKENS: Record<string, Record<string, string>> = {
  1: { text: '4xl', font: 'bold', tracking: 'tight' },
  2: { text: '3xl', font: 'bold', tracking: 'tight' },
  3: { text: '2xl', font: 'semibold' },
  4: { text: 'xl', font: 'semibold' }
}

/** A Text keeps the line breaks of its text. */
export const TEXT_CLASS = 'whitespace-pre-line'

/** An Image never overflows its parent (with `displayOf('Image')`). */
export const IMAGE_FALLBACK_STYLE: Record<string, string> = { maxW: 'full' }

/** A Card's padding, a token so a `p` token replaces it instead of adding to it. */
export const CARD_DEFAULT_STYLE: Record<string, string> = { p: '6' }

/** The tokens that lay out a Card's inner stack; every other token styles the card itself. */
export const CARD_STACK_KEYS = ['direction', 'flexWrap', 'gap', 'items', 'justify']

export interface RenderDivergence {
  /** A stable name, for P2's decisions and the log. */
  id: string
  /** The node types it affects. */
  types: string[]
  /** What `generate/ui.ts` emits. */
  generator: string
  /** What the canvas (`BildrNode.vue`) renders. */
  canvas: string
}

/**
 * Where the generator and the canvas render a node differently today. P1
 * changes neither output (the golden fixtures stay byte-identical); P2
 * decides each entry and removes it once both sides follow one rule here.
 */
export const KNOWN_DIVERGENCES: readonly RenderDivergence[] = [
  {
    id: 'container-direction',
    types: ['Page', 'Container', 'Form'],
    generator: 'a plain block element: no display class, no direction',
    canvas: '`displayOf` (flex) plus `structuralStyle` (flex-col), so `gap`, `items` and `justify` apply'
  },
  {
    id: 'row-direction-wrap',
    types: ['Row'],
    generator: '`flex` only; the `wrap` prop is ignored',
    canvas: '`flex` plus `structuralStyle` (flex-row), and `wrap: true` adds a `flexWrap: wrap` fallback'
  },
  {
    id: 'container-tag',
    types: ['Page', 'Container', 'Row', 'List'],
    generator: '`props.tag`, one of `CONTAINER_TAGS` (default div)',
    canvas: 'always a div'
  },
  {
    id: 'page-min-height',
    types: ['Page'],
    generator: 'no height',
    canvas: '`min-h-full`, so the page fills its frame'
  },
  {
    id: 'stack-self-stretch',
    types: ['Container', 'Row', 'Column', 'Grid', 'List', 'Form', 'Card', 'Input', 'Heading', 'Text'],
    generator: 'no fallback: a child follows its stack\'s `items`',
    canvas: 'a `self: stretch` fallback for block types in a vertical stack (Heading and Text only when they set `align`)'
  },
  {
    id: 'heading-tokens',
    types: ['Heading'],
    generator: 'only the node\'s own tokens',
    canvas: '`HEADING_TOKENS` by level before the node\'s tokens'
  },
  {
    id: 'heading-levels',
    types: ['Heading'],
    generator: 'levels 1–6; any other level is an error',
    canvas: 'levels 1–4 (the keys of `HEADING_TOKENS`); any other renders as `DEFAULT_HEADING_LEVEL`'
  },
  {
    id: 'text-line-breaks',
    types: ['Text'],
    generator: 'no `TEXT_CLASS`: line breaks collapse',
    canvas: '`TEXT_CLASS` (whitespace-pre-line)'
  },
  {
    id: 'link-element',
    types: ['Link'],
    generator: '`NuxtLink` to a page route (`to: { page, params }`), text or children',
    canvas: '`ULink` with `underline-offset-4 hover:underline`, an optional `icon` (inline-flex) and external URLs in a new tab'
  },
  {
    id: 'button-props',
    types: ['Button'],
    generator: '`label`, `type="submit"` and `disabled`; interactions as events',
    canvas: '`label`, `color`, `variant`, `size`, `icon`, `trailingIcon`, and the `action` prop (link, submit, toast)'
  },
  {
    id: 'input-props',
    types: ['Input'],
    generator: 'from the form field: `v-model`, `name`, `required`, `type="number"`, `maxlength`, `pattern`; `UTextarea` when multiline',
    canvas: '`name`, `placeholder` and `type` from props (`inputType`); always `UInput`'
  },
  {
    id: 'list-layout',
    types: ['List'],
    generator: 'the List\'s tag and tokens, a `v-for` over the bound items, `text-muted` loading and empty paragraphs',
    canvas: 'the `layout` prop (stack: flex-col, grid, row: flex-row flex-wrap) with its display, a placeholder copy and a Load more button'
  },
  {
    id: 'generator-missing-types',
    types: ['Column', 'Grid', 'Image', 'Card', 'SlotFill'],
    generator: 'an error: "node type … can\'t be generated yet"',
    canvas: 'Column and Card as stacks (Card: `CARD_DEFAULT_STYLE`, `CARD_STACK_KEYS`), Grid as `grid`, Image with `IMAGE_FALLBACK_STYLE`, SlotFill through its Instance'
  },
  {
    id: 'canvas-missing-checkbox',
    types: ['Checkbox'],
    generator: '`UCheckbox` bound to a boolean field or a value',
    canvas: 'an "Unknown component" hint'
  }
]
