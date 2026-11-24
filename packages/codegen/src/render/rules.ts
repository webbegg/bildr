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
  InputMultiline: 'UTextarea',
  /** The control of an Input whose field is a select: a dropdown of its options. */
  InputSelect: 'USelect'
} as const

/** The types that render as the tag they name (`props.tag`). */
export const TAGGED_TYPES: readonly string[] = ['Page', 'Container', 'Row', 'Column', 'Grid', 'List']

/** The tags a node of `TAGGED_TYPES` may render as; the first is the default. */
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

/**
 * A List's `loadMore`: how many records it shows first and adds with each click of its Load more button
 * (a whole number from 1 to `MAX_LOAD_MORE`), the button staying while more follow. It is the same slice
 * of the bound list in the app and on the canvas; the button is the last child of the List, a full row
 * of a grid, its own line in a wrapping row.
 */
export const MAX_LOAD_MORE = 500
export const LOAD_MORE_LABEL = 'Load more'
export const LOAD_MORE_CLASS = 'col-span-full flex w-full basis-full flex-col items-center gap-2 self-stretch'

/** A List's page size, undefined when it has no (valid) `loadMore`. */
export function loadMoreSize(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_LOAD_MORE ? value : undefined
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

/**
 * Whether a node lays its children out in a vertical stack, so their
 * `selfFallback` applies: its type's layout, as its base `display` and
 * `direction` tokens leave it. A breakpoint token leaves the base stack as it
 * is.
 */
export function childrenInStack(type: string, props: Record<string, unknown> = {}, style: Record<string, string> = {}): boolean {
  // A Card's `display` styles the card; its inner stack is always flex.
  const display = type !== 'Card' && (style.display === 'block' || style.display === 'grid' || style.display === 'flex') ? style.display : displayOf(type, props)
  if (display !== 'flex') return false
  const direction = style.direction ?? fallbackStyle(type, props).direction
  return direction === 'col' || direction === 'col-reverse'
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

/** The URL schemes a Link or Button `href` (all three) and a static Image `src` (http(s) only) may use. */
const HREF_SCHEME = /^(?:https?:\/\/|mailto:|tel:)/i
const SRC_SCHEME = /^https?:\/\//i
/** A path on this origin: one `/`, never `//` or `/\` (a browser reads both as another host). */
const LOCAL_PATH = /^\/(?![/\\])/

/**
 * The one URL rule for `href` and a static `src`: http(s), mailto: and tel:
 * (href only), or a path starting with a single `/`. Everything else
 * (`javascript:`, `data:`, `//host`, a bare word…) is refused, and so is a
 * URL with whitespace or control characters a browser would strip. A bound
 * (`$bind`) `src` is a runtime value this rule can't see.
 */
export function isSafeUrl(url: string, kind: 'href' | 'src'): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f]/.test(url)) return false
  return (kind === 'href' ? HREF_SCHEME : SRC_SCHEME).test(url) || LOCAL_PATH.test(url)
}

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
/** An Iconify icon name, like `i-lucide-send`. */
export const ICON_NAME = /^i-[a-z0-9]+(?:-[a-z0-9]+)+$/

export interface PropProblem {
  key: string
  message: string
}

/** The props each node type renders (besides `visible`, which every node takes). Unknown types are left to the generator. */
export const NODE_PROPS: Readonly<Record<string, readonly string[]>> = {
  Page: ['tag', 'when', 'loading', 'empty'],
  Container: ['tag'],
  Row: ['tag', 'wrap'],
  Column: ['tag'],
  Grid: ['tag'],
  Card: [],
  Heading: ['level', 'text'],
  Text: ['text'],
  Image: ['src', 'alt'],
  Link: ['to', 'href', 'text', 'icon'],
  Button: ['type', 'text', 'color', 'variant', 'size', 'icon', 'trailingIcon', 'href', 'disabled'],
  Input: ['field', 'label', 'multiline', 'inputType', 'placeholder', 'rows'],
  Checkbox: ['field', 'value', 'label'],
  Form: ['action', 'fields'],
  List: ['tag', 'as', 'items', 'loading', 'empty', 'hideWhenEmpty', 'layout', 'loadMore'],
  Instance: ['component', 'values', 'variant'],
  SlotFill: ['slot']
}

/** Whether a node type renders `key`; unknown types say yes (the generator refuses them anyway). */
export function takesProp(type: string, key: string): boolean {
  const props = NODE_PROPS[type]
  return !props || key === 'visible' || props.includes(key)
}

/** The values a node prop takes when it is one of a fixed set (a Button's color, variant and size). */
export function propValues(type: string, key: string): readonly string[] | undefined {
  if (type !== 'Button') return undefined
  return key === 'color' ? BUTTON_COLORS : key === 'variant' ? BUTTON_VARIANTS : key === 'size' ? BUTTON_SIZES : undefined
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
    // The generator writes `href` as a static `to`: no bindings.
    if (typeof value !== 'string') problems.push({ key: 'href', message: 'href must be a URL' })
    else if (!isSafeUrl(value, 'href')) problems.push({ key: 'href', message: 'href must be an http(s), mailto: or tel: URL, or a path starting with /' })
    else if (props.to !== undefined) problems.push({ key: 'href', message: 'A link has either `href` (external) or `to` (a page), not both' })
  }
  if (TAGGED_TYPES.includes(type) && props.tag !== undefined && containerTag(props.tag) === undefined) {
    problems.push({ key: 'tag', message: `tag must be one of ${CONTAINER_TAGS.join(', ')}` })
  }
  if (type === 'Image') {
    const src = props.src
    if (src === undefined || src === null || src === '') problems.push({ key: 'src', message: 'an Image needs `src`, a URL or a binding' })
    else if (typeof src === 'string' && !isSafeUrl(src, 'src')) problems.push({ key: 'src', message: 'src must be an http(s) URL or a path starting with /' })
    else if (typeof src !== 'string' && (typeof src !== 'object' || Array.isArray(src))) problems.push({ key: 'src', message: 'an Image needs `src`, a URL or a binding' })
  }
  if (type === 'Input' && props.multiline === true && props.inputType !== undefined) problems.push({ key: 'inputType', message: 'a multiline input has no inputType' })
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
  if (type === 'List' && props.loadMore !== undefined && loadMoreSize(props.loadMore) === undefined) problems.push({ key: 'loadMore', message: `loadMore must be a whole number from 1 to ${MAX_LOAD_MORE}` })
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

// ── Variants ──────────────────────────────────────────────────────────────────

/**
 * Node props that shape the generated markup (its element, route, form or
 * list): fixed at generation, so neither a variant nor a property drives them.
 */
export const STRUCTURAL_PROPS: readonly string[] = ['level', 'tag', 'to', 'href', 'field', 'fields', 'action', 'items', 'as', 'component', 'values', 'multiline', 'inputType', 'type', 'rows', 'slot', 'when', 'layout']

export interface TransitionSpec {
  type: 'instant' | 'ease' | 'spring'
  duration?: number
  easing?: 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'linear'
  stiffness?: number
  damping?: number
}

/** Used when neither the variant nor the component sets a transition (the canvas's `DEFAULT_TRANSITION`). */
export const DEFAULT_TRANSITION: TransitionSpec = { type: 'ease', duration: 0.3, easing: 'ease' }

const sides = (prefix: string, suffix = '') => ({ t: [`${prefix}-top${suffix}`], r: [`${prefix}-right${suffix}`], b: [`${prefix}-bottom${suffix}`], l: [`${prefix}-left${suffix}`] })
const margin = sides('margin')
const padding = sides('padding')
const border = sides('border', '-width')

/** The CSS properties a style token key sets that can animate (the canvas's `animatedProperties`); layout switches cannot. */
export const ANIMATED_PROPERTIES: Record<string, string[]> = {
  m: ['margin'], mx: [...margin.l, ...margin.r], my: [...margin.t, ...margin.b], mt: margin.t, mr: margin.r, mb: margin.b, ml: margin.l,
  p: ['padding'], px: [...padding.l, ...padding.r], py: [...padding.t, ...padding.b], pt: padding.t, pr: padding.r, pb: padding.b, pl: padding.l,
  gap: ['gap'],
  w: ['width'], h: ['height'], minW: ['min-width'], maxW: ['max-width'], minH: ['min-height'], maxH: ['max-height'],
  bg: ['background-color'], color: ['color'], borderColor: ['border-color'],
  text: ['font-size', 'line-height'], font: ['font-weight'], tracking: ['letter-spacing'], leading: ['line-height'],
  border: ['border-width'], borderT: border.t, borderR: border.r, borderB: border.b, borderL: border.l,
  rounded: ['border-radius'], roundedTl: ['border-top-left-radius'], roundedTr: ['border-top-right-radius'], roundedBr: ['border-bottom-right-radius'], roundedBl: ['border-bottom-left-radius'],
  shadow: ['box-shadow'], opacity: ['opacity']
}

/** The animatable CSS properties of style keys, in key order, each once. */
export function animatedProperties(keys: readonly string[]): string[] {
  return [...new Set(keys.flatMap(key => ANIMATED_PROPERTIES[parseStyleKey(key)?.token.key ?? ''] ?? []))]
}

const round = (value: number) => Math.round(value * 1000) / 1000

/** A damped spring from 0 to 1 (mass 1): its settle time in seconds and its largest overshoot (the canvas's `springCurve`). */
export function springSettle(stiffness: number, damping: number): { duration: number, overshoot: number } {
  const w0 = Math.sqrt(Math.max(stiffness, 1))
  const zeta = Math.max(damping, 0) / (2 * w0)
  const at = (t: number): number => {
    if (Math.abs(zeta - 1) < 1e-6) return 1 - Math.exp(-w0 * t) * (1 + w0 * t)
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta)
      return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t))
    }
    const root = Math.sqrt(zeta * zeta - 1)
    const r1 = -w0 * (zeta - root)
    const r2 = -w0 * (zeta + root)
    return 1 + (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r1 - r2)
  }
  let duration = 0.05
  let peak = 1
  for (let t = 0; t <= 5; t += 0.001) {
    const value = at(t)
    if (Math.abs(value - 1) > 0.001) duration = t
    peak = Math.max(peak, value)
  }
  return { duration: round(duration), overshoot: round(peak - 1) }
}

/** Under `prefers-reduced-motion: reduce` a timed transition is instant: a Tailwind variant, so the generated app needs no runtime for it. */
const REDUCED_MOTION_CLASS = 'motion-reduce:duration-0'

/**
 * The Tailwind timing classes of a transition (`duration-300 ease-[ease]
 * motion-reduce:duration-0`), empty for an instant one. Easings are the CSS keywords (arbitrary values:
 * Tailwind's own `ease-in`… are other curves); a spring is its settle time
 * with the cubic-bezier the canvas falls back to without `linear()`.
 */
export function transitionTimingClasses(transition: TransitionSpec): string {
  if (transition.type === 'instant') return ''
  if (transition.type === 'spring') {
    const { duration, overshoot } = springSettle(transition.stiffness ?? 300, transition.damping ?? 30)
    const bezier = overshoot > 0.001 ? `cubic-bezier(0.3,${round(1 + Math.min(overshoot * 2.6, 1.5))},0.6,1)` : 'cubic-bezier(0.25,0.1,0.25,1)'
    return `duration-${Math.round(duration * 1000)} ease-[${bezier}] ${REDUCED_MOTION_CLASS}`
  }
  const easing = transition.easing ?? 'ease'
  return `duration-${Math.round((transition.duration ?? 0.3) * 1000)} ${easing === 'linear' ? 'ease-linear' : `ease-[${easing}]`} ${REDUCED_MOTION_CLASS}`
}

/**
 * Where the generator and the canvas still render a node differently. P2a
 * resolved the other P1 entries (E3); this one waits for paged queries (P5).
 */
export const KNOWN_DIVERGENCES: readonly RenderDivergence[] = []
