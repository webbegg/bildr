import { THEME_COLORS } from '../design/theme.ts'
import { parseStyleKey } from '../design/tokens.ts'

/**
 * The render rules (spec V4, RA §6): per node type, what the generator
 * (`generate/ui.ts`) and the editor canvas (`BildrNode.vue`) both need to
 * render a node the same way: its element or Nuxt UI component, the token
 * fallbacks it renders with before its own style (a token of the same key
 * replaces them) and the prop values it accepts. Token → class resolution is
 * `styleClasses` and `styleInline` in `../design/tokens.ts`, already shared.
 *
 * E3 ("the canvas wins"): where the two sides disagreed, the generator took
 * the canvas's rule. `KNOWN_DIVERGENCES` lists what is still left.
 * Pure data and functions: no Vue, no DOM.
 */

/** The element of a node type that renders as one fixed element or Nuxt UI component. */
export const NODE_ELEMENTS = {
  Text: 'p',
  Button: 'UButton',
  Link: 'ULink',
  Image: 'img',
  Checkbox: 'UCheckbox',
  Form: 'form',
  /** The labelled field wrapping an Input's control. */
  Input: 'UFormField',
  InputControl: 'UInput',
  InputMultiline: 'UTextarea'
} as const

/** The tags a Page, Container, Row or List may render as (`props.tag`); the first is the default. */
export const CONTAINER_TAGS = ['div', 'section', 'article', 'aside', 'header', 'nav', 'main', 'footer']

/** The tag of a container: its `tag` prop, the default without one, undefined for a tag outside `CONTAINER_TAGS`. */
export function containerTag(tag: unknown): string | undefined {
  if (tag === undefined || tag === null || tag === '') return CONTAINER_TAGS[0]
  return typeof tag === 'string' && CONTAINER_TAGS.includes(tag) ? tag : undefined
}

/** The class of an Input's control: it fills its field. */
export const INPUT_CONTROL_CLASS = 'w-full'

/** The flex containers that stack their children vertically. */
const STACK_TYPES = ['Page', 'Container', 'Column', 'Form', 'Card']

/** Whether the type lays its children out with flexbox, so `direction`, `items` and `justify` apply. */
export function isFlexType(type: string): boolean {
  return type === 'Row' || STACK_TYPES.includes(type)
}

/**
 * The flex direction of the flex containers. A `direction` token of the node
 * replaces it, and a breakpoint one (`md:direction`) applies above it.
 */
export function structuralStyle(type: string): Record<string, string> {
  if (type === 'Row') return { direction: 'row' }
  return STACK_TYPES.includes(type) ? { direction: 'col' } : {}
}

/** How a List lays out its records: a vertical stack (the default), a grid, or a wrapping row. */
export const LIST_LAYOUTS = ['stack', 'grid', 'row'] as const
export type ListLayout = typeof LIST_LAYOUTS[number]

/** A List's `layout` prop, `stack` when unset or unknown. */
export function listLayout(layout: unknown): ListLayout {
  return (LIST_LAYOUTS as readonly unknown[]).includes(layout) ? layout as ListLayout : 'stack'
}

/** A page fills its frame (the canvas) or its layout slot. */
export const PAGE_FALLBACK_STYLE: Record<string, string> = { minH: 'full' }

/**
 * The tokens a node renders with before its own style: the direction of the
 * flex containers, a Page's minimum height, a Row's `wrap` prop and a List's
 * `layout`. A token of the same key replaces each of them.
 */
export function fallbackStyle(type: string, props: Record<string, unknown> = {}): Record<string, string> {
  if (type === 'List') {
    const layout = listLayout(props.layout)
    return layout === 'stack' ? { direction: 'col' } : layout === 'row' ? { direction: 'row', flexWrap: 'wrap' } : {}
  }
  return {
    ...structuralStyle(type),
    ...(type === 'Page' ? PAGE_FALLBACK_STYLE : {}),
    ...(type === 'Row' && props.wrap === true ? { flexWrap: 'wrap' } : {})
  }
}

/**
 * The display class a type renders with; a base `display` token replaces it
 * (see `displayFallback`). Empty for types that keep their element's display.
 */
export function displayOf(type: string, props: Record<string, unknown> = {}): string {
  if (type === 'List') return listLayout(props.layout) === 'grid' ? 'grid' : 'flex'
  if (isFlexType(type)) return 'flex'
  if (type === 'Grid') return 'grid'
  if (type === 'Image') return 'block'
  return ''
}

/** Whether a type lays its children out in a vertical stack, so their `selfFallback` applies. */
export function childrenInStack(type: string, props: Record<string, unknown> = {}): boolean {
  if (type === 'List') return listLayout(props.layout) === 'stack'
  return type !== 'Row' && STACK_TYPES.includes(type)
}

/** The types that fill the width of a vertical stack whatever its `items`. */
const BLOCK_TYPES = ['Container', 'Row', 'Column', 'Grid', 'List', 'Form', 'Card', 'Input']

/**
 * In a vertical stack, block types fill the width whatever the stack's
 * `items`, so sections and fields keep spanning their parent; a Heading or a
 * Text only does when it sets an alignment. Buttons, links and short text
 * follow the stack's `items`. A base `self` token of the node replaces it.
 */
export function selfFallback(type: string, style: Record<string, string> = {}, inStack = false): Record<string, string> {
  if (!inStack || style.self !== undefined) return {}
  const aligned = Object.keys(style).some(key => parseStyleKey(key)?.token.key === 'align')
  return BLOCK_TYPES.includes(type) || (['Heading', 'Text'].includes(type) && aligned) ? { self: 'stretch' } : {}
}

/** The level of a Heading without one. */
export const DEFAULT_HEADING_LEVEL = 2

/** `h1`…`h6`. */
export function headingTag(level: number | string): string {
  return `h${level}`
}

/**
 * The typography a Heading renders with by level, before its own tokens.
 * Levels 5 and 6 continue the scale down to body size, so every HTML heading
 * level has its own step.
 */
export const HEADING_TOKENS: Record<string, Record<string, string>> = {
  1: { text: '4xl', font: 'bold', tracking: 'tight' },
  2: { text: '3xl', font: 'bold', tracking: 'tight' },
  3: { text: '2xl', font: 'semibold' },
  4: { text: 'xl', font: 'semibold' },
  5: { text: 'lg', font: 'semibold' },
  6: { text: 'base', font: 'semibold' }
}

/** A Heading's level (a number or its text, as the canvas holds it), undefined outside 1–6. */
export function headingLevel(level: unknown): number | undefined {
  const value = typeof level === 'string' && /^\d$/.test(level) ? Number(level) : level
  return typeof value === 'number' && String(value) in HEADING_TOKENS ? value : undefined
}

/** A Text keeps the line breaks of its text. */
export const TEXT_CLASS = 'whitespace-pre-line'

/** A Link's underline on hover. */
export const LINK_CLASS = 'underline-offset-4 hover:underline'
/** A Link with an icon lays the icon and its text out in a line (with `LINK_ICON_DISPLAY`, a `display` token replaces it). */
export const LINK_ICON_CLASS = 'items-center gap-1'
export const LINK_ICON_DISPLAY = 'inline-flex'
/** An icon inside a Link scales with its text. */
export const ICON_CLASS = 'size-[1em] shrink-0'

/** The URLs a Link or Button may point to with `href`. */
const EXTERNAL_URL = /^(?:https?:\/\/|mailto:|tel:)/i

/** External URLs open in a new tab (NuxtLink adds `rel="noopener noreferrer"` to them). */
export function linkTarget(url: string | undefined): '_blank' | undefined {
  return url && /^https?:\/\//i.test(url) ? '_blank' : undefined
}

/** An Image never overflows its parent (with `displayOf('Image')`). */
export const IMAGE_FALLBACK_STYLE: Record<string, string> = { maxW: 'full' }

/** A Card's padding, a token so a `p` token replaces it instead of adding to it. */
export const CARD_DEFAULT_STYLE: Record<string, string> = { p: '6' }

/**
 * The surface the canvas's `UCard` paints (its outline variant) as tokens a
 * generated Card's div renders with, so a `rounded` or `bg` token replaces it,
 * plus its ring, which no token sets.
 */
export const CARD_SURFACE_STYLE: Record<string, string> = { rounded: 'lg', bg: 'default', overflow: 'hidden' }
export const CARD_SURFACE_CLASS = 'ring ring-default'

/** The tokens that lay out a Card's inner stack; every other token styles the card itself. */
export const CARD_STACK_KEYS = ['direction', 'flexWrap', 'gap', 'items', 'justify']

/** A Card's style split between the card (`root`) and its inner stack (`stack`); breakpoint variants follow their base key. */
export function splitCardStyle(style: Record<string, string> = {}): { root: Record<string, string>, stack: Record<string, string> } {
  const root: Record<string, string> = {}
  const stack: Record<string, string> = {}
  for (const [key, value] of Object.entries(style)) {
    if (CARD_STACK_KEYS.includes(parseStyleKey(key)?.token.key ?? '')) stack[key] = value
    else root[key] = value
  }
  return { root, stack }
}

/** Nuxt UI's `UButton` options (the theme registers no other colours with Nuxt UI). */
export const BUTTON_COLORS: readonly string[] = THEME_COLORS
export const BUTTON_VARIANTS = ['solid', 'outline', 'soft', 'subtle', 'ghost', 'link'] as const
export const BUTTON_SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const

/** The `type` of an Input's control (`inputType`). A number field always uses `number`. */
export const INPUT_TYPES = ['text', 'email', 'password', 'url', 'tel', 'number'] as const

/** An Iconify name, as Nuxt UI takes it. */
const ICON_NAME = /^i-[a-z0-9]+(?:-[a-z0-9]+)+$/

export interface PropProblem {
  key: string
  message: string
}

/**
 * The static prop values a node type doesn't accept. Expressions (`$bind`…)
 * are left to where they are evaluated. The loader reports these as model
 * problems and the generator refuses them.
 */
export function nodePropProblems(type: string, props: Record<string, unknown> = {}): PropProblem[] {
  const problems: PropProblem[] = []
  const oneOf = (key: string, values: readonly string[], label = key) => {
    const value = props[key]
    if (typeof value === 'string' && !values.includes(value)) problems.push({ key, message: `${label} must be one of ${values.join(', ')}` })
  }
  const icon = (key: string) => {
    const value = props[key]
    if (typeof value === 'string' && !ICON_NAME.test(value)) problems.push({ key, message: 'An icon is a name like "i-lucide-send"' })
  }
  const href = () => {
    const value = props.href
    if (value === undefined) return
    if (typeof value === 'string' && !EXTERNAL_URL.test(value)) problems.push({ key: 'href', message: 'href must be an http(s), mailto: or tel: URL' })
    else if (props.to !== undefined) problems.push({ key: 'href', message: 'A link has either `href` (external) or `to` (a page), not both' })
  }
  if (type === 'Button') {
    oneOf('color', BUTTON_COLORS, 'Button color')
    oneOf('variant', BUTTON_VARIANTS, 'Button variant')
    oneOf('size', BUTTON_SIZES, 'Button size')
    icon('icon')
    icon('trailingIcon')
    href()
  }
  if (type === 'Link') {
    icon('icon')
    href()
  }
  if (type === 'Input') oneOf('inputType', INPUT_TYPES, 'inputType')
  if (type === 'List') oneOf('layout', LIST_LAYOUTS)
  if (type === 'Heading' && props.level !== undefined && headingLevel(props.level) === undefined) problems.push({ key: 'level', message: 'heading level must be 1–6' })
  return problems
}

/**
 * The problems of a UI step the render rules know: a `toast` step (Nuxt UI's
 * `useToast`) needs a `title`; its `color` is one of the theme colours and its
 * `icon` an Iconify name. `description` is optional.
 */
export function uiStepProblems(step: Record<string, unknown>): PropProblem[] {
  if (step.kind !== 'toast') return []
  const problems: PropProblem[] = []
  if (step.title === undefined || step.title === '') problems.push({ key: 'title', message: 'A "toast" step needs a title' })
  if (typeof step.color === 'string' && !BUTTON_COLORS.includes(step.color)) problems.push({ key: 'color', message: `A toast color must be one of ${BUTTON_COLORS.join(', ')}` })
  if (typeof step.icon === 'string' && !ICON_NAME.test(step.icon)) problems.push({ key: 'icon', message: 'An icon is a name like "i-lucide-send"' })
  return problems
}

export interface RenderDivergence {
  /** A stable name, for decisions and the log. */
  id: string
  /** The node types it affects. */
  types: string[]
  /** What `generate/ui.ts` emits. */
  generator: string
  /** What the canvas (`BildrNode.vue`) renders. */
  canvas: string
}

/**
 * Where the generator and the canvas still render a node differently. P2a
 * resolved the other P1 entries (E3); this one waits for paged queries (P5).
 */
export const KNOWN_DIVERGENCES: readonly RenderDivergence[] = [
  {
    id: 'list-load-more',
    types: ['List'],
    generator: 'every record of the bound query; no Load more button',
    canvas: 'with `loadMore`, published apps and the preview show a Load more button under the records while more follow (P5: a paging param on the query)'
  }
]
