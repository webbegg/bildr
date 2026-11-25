/**
 * The class list an element renders with, tidied for a human reader: Tailwind's own class order (the order
 * `prettier-plugin-tailwindcss` and eslint-plugin-better-tailwindcss enforce), no repeats, and no class that only
 * restates a default. The generated app and the canvas both tidy their static classes with it, so they keep
 * rendering the same classes. Only what bildr emits is ranked; any other class keeps its place, first.
 */

/** CSS properties in Tailwind's sort order (tailwindcss/src/property-order.ts), the subset bildr's classes set. */
const PROPERTY_ORDER = [
  'position', 'inset', 'inset-inline', 'inset-block', 'top', 'right', 'bottom', 'left', 'z-index', 'order',
  'grid-column', 'grid-row',
  'margin', 'margin-inline', 'margin-block', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'display',
  'height', 'max-height', 'min-height', 'width', 'max-width', 'min-width',
  'flex', 'flex-shrink', 'flex-grow', 'flex-basis',
  'grid-template-columns', 'grid-template-rows',
  'flex-direction', 'flex-wrap', 'align-content', 'align-items', 'justify-content', 'gap', 'column-gap', 'row-gap',
  'align-self',
  'overflow', 'overflow-x', 'overflow-y',
  'border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'border-width', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-color',
  'background-color',
  'object-fit',
  'padding', 'padding-inline', 'padding-block', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'text-align',
  'font-size', 'line-height', 'font-weight', 'letter-spacing', 'white-space',
  'color', 'text-transform', 'text-decoration-line', 'text-underline-offset',
  'opacity',
  'box-shadow', '--tw-ring-shadow', '--tw-ring-color',
  'transition-property', 'transition-duration', 'transition-timing-function'
] as const

type Property = typeof PROPERTY_ORDER[number]

const SIDES: Record<string, string> = { t: 'top', r: 'right', b: 'bottom', l: 'left' }
const CORNERS: Record<string, string> = { tl: 'top-left', tr: 'top-right', br: 'bottom-right', bl: 'bottom-left' }
const FONT_SIZES = /^text-(xs|sm|base|lg|[2-9]?xl)$/
const TEXT_ALIGN = /^text-(left|center|right|justify)$/
const FONT_WEIGHTS = /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/
const DIRECTIONS = /^flex-(row|col)(-reverse)?$/

/** The property a bildr utility sets first, or undefined for a class it does not rank. */
const propertyOf = (utility: string): Property | undefined => {
  const exact: Record<string, Property> = {
    'static': 'position', 'relative': 'position', 'absolute': 'position', 'fixed': 'position', 'sticky': 'position',
    'hidden': 'display', 'block': 'display', 'inline': 'display', 'inline-block': 'display', 'flex': 'display', 'inline-flex': 'display', 'grid': 'display',
    'flex-wrap': 'flex-wrap', 'flex-nowrap': 'flex-wrap',
    'uppercase': 'text-transform', 'lowercase': 'text-transform', 'capitalize': 'text-transform', 'normal-case': 'text-transform',
    'underline': 'text-decoration-line', 'no-underline': 'text-decoration-line',
    'ring': '--tw-ring-shadow', 'border': 'border-width', 'rounded': 'border-radius', 'transition': 'transition-property', 'shrink': 'flex-shrink', 'grow': 'flex-grow'
  }
  if (exact[utility]) return exact[utility]
  if (DIRECTIONS.test(utility)) return 'flex-direction'
  if (FONT_SIZES.test(utility)) return 'font-size'
  if (TEXT_ALIGN.test(utility)) return 'text-align'
  if (FONT_WEIGHTS.test(utility)) return 'font-weight'
  // Spacing: `mx-auto`, `-mt-2`, `py-0.5`, `p-[3px]`.
  const spacing = /^-?([mp])([xytrbl]?)-(auto|px|\d+(?:\.\d+)?|\[[^\]]+\])$/.exec(utility)
  if (spacing) {
    const box = spacing[1] === 'm' ? 'margin' : 'padding'
    const side = { '': '', 'x': '-inline', 'y': '-block', 't': '-top', 'r': '-right', 'b': '-bottom', 'l': '-left' }[spacing[2]!]
    return `${box}${side}` as Property
  }
  const border = /^border-(.+)$/.exec(utility)
  if (border) {
    // `border-t`, `border-t-2`, `border-2`: a width; any other `border-*` is a colour.
    const side = /^([trbl])(?:-\d+)?$/.exec(border[1]!)
    if (side) return `border-${SIDES[side[1]!]}-width` as Property
    return /^\d+$/.test(border[1]!) ? 'border-width' : 'border-color'
  }
  const rounded = /^rounded-(tl|tr|br|bl)(?:-|$)/.exec(utility)
  if (rounded) return `border-${CORNERS[rounded[1]!]}-radius` as Property
  if (utility.startsWith('rounded-')) return 'border-radius'
  const prefixes: Record<string, Property> = {
    'inset': 'inset', 'inset-x': 'inset-inline', 'inset-y': 'inset-block', 'top': 'top', 'right': 'right', 'bottom': 'bottom', 'left': 'left', 'z': 'z-index', 'order': 'order',
    'col-span': 'grid-column', 'row-span': 'grid-row', 'grid-rows': 'grid-template-rows', 'content': 'align-content',
    'gap-x': 'column-gap', 'gap-y': 'row-gap', 'overflow-x': 'overflow-x', 'overflow-y': 'overflow-y', 'size': 'height', 'h': 'height', 'max-h': 'max-height', 'min-h': 'min-height', 'w': 'width', 'max-w': 'max-width', 'min-w': 'min-width',
    'shrink': 'flex-shrink', 'grow': 'flex-grow', 'basis': 'flex-basis', 'grid-cols': 'grid-template-columns',
    'items': 'align-items', 'justify': 'justify-content', 'gap': 'gap', 'self': 'align-self', 'overflow': 'overflow',
    'bg': 'background-color', 'object': 'object-fit', 'leading': 'line-height', 'tracking': 'letter-spacing', 'whitespace': 'white-space',
    'text': 'color', 'underline-offset': 'text-underline-offset', 'opacity': 'opacity', 'shadow': 'box-shadow', 'ring': '--tw-ring-color',
    'transition': 'transition-property', 'duration': 'transition-duration', 'ease': 'transition-timing-function'
  }
  // The longest prefix wins: `max-w-xl` is a max-width, not a width.
  for (let end = utility.length; end > 0; end = utility.lastIndexOf('-', end - 1)) {
    const prefix = utility.slice(0, end)
    if (prefixes[prefix] && end < utility.length) return prefixes[prefix]
    if (end <= 0) break
  }
  return undefined
}

/** Variants in the order Tailwind emits them: children, group and peer states, own states, then media (breakpoints small to large). */
const VARIANT_ORDER = [/^\*$/, /^group-/, /^peer-/, /^hover$/, /^focus/, /^active$/, /^motion-/, /^max-lg$/, /^max-md$/, /^max-sm$/, /^sm$/, /^md$/, /^lg$/, /^xl$/]

const variantRank = (variant: string) => {
  const index = VARIANT_ORDER.findIndex(pattern => pattern.test(variant))
  return index === -1 ? VARIANT_ORDER.length : index
}

interface Ranked { name: string, index: number, variants: number[], property: number }

const rank = (name: string, index: number): Ranked => {
  // `md:group-hover/card:p-4`: the variants, then the utility (arbitrary values may hold a colon only inside brackets).
  const parts = name.split(/:(?![^[]*\])/)
  const utility = parts.pop()!
  // An arbitrary property (`[--col-min:…]`) sorts after every other utility.
  if (/^\[[^\]]*:/.test(utility)) return { name, index, variants: parts.map(variantRank), property: PROPERTY_ORDER.length }
  const property = propertyOf(utility)
  return { name, index, variants: parts.map(variantRank), property: property === undefined ? -1 : PROPERTY_ORDER.indexOf(property) }
}

const compare = (a: Ranked, b: Ranked): number => {
  if (a.variants.length !== b.variants.length && (a.variants.length === 0 || b.variants.length === 0)) return a.variants.length - b.variants.length
  for (let i = 0; i < Math.max(a.variants.length, b.variants.length); i++) {
    const diff = (a.variants[i] ?? -1) - (b.variants[i] ?? -1)
    if (diff) return diff
  }
  // An unranked class has no CSS of bildr's: it keeps its place, before the utilities.
  if (a.property === -1 || b.property === -1) return a.property === b.property ? a.index - b.index : a.property - b.property
  // Two values of one property (conflicting classes): by name, as Tailwind does.
  return a.property - b.property || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}

const DISPLAYS = new Set(['hidden', 'block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid'])

/**
 * Classes with no effect: a stack's row direction (the initial value), and a direction on an element that is a
 * grid at every width (a grid has no direction).
 */
const noEffect = (names: string[]) => {
  const alwaysGrid = names.includes('grid') && !names.some(name => name.includes(':') && DISPLAYS.has(name.slice(name.lastIndexOf(':') + 1)))
  return (name: string) => name === 'flex-row' || (alwaysGrid && DIRECTIONS.test(name))
}

/** `parts` (each a class or a space-separated list) as one tidy class attribute. */
export const tidyClasses = (parts: string[]): string => {
  const all = [...new Set(parts.flatMap(part => part.split(/\s+/)).filter(Boolean))]
  const names = all.filter(name => !noEffect(all)(name))
  return names.map(rank).sort(compare).map(entry => entry.name).join(' ')
}
