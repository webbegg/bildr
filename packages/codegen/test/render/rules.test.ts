import { describe, expect, it } from 'vitest'
import {
  CARD_DEFAULT_STYLE,
  CARD_STACK_KEYS,
  CONTAINER_TAGS,
  DEFAULT_HEADING_LEVEL,
  displayOf,
  HEADING_TOKENS,
  headingTag,
  childrenInStack,
  containerTag,
  fallbackStyle,
  headingLevel,
  IMAGE_FALLBACK_STYLE,
  INPUT_CONTROL_CLASS,
  isFlexType,
  KNOWN_DIVERGENCES,
  LINK_CLASS,
  linkTarget,
  NODE_ELEMENTS,
  nodePropProblems,
  selfFallback,
  splitCardStyle,
  structuralStyle,
  TEXT_CLASS
} from '../../src/render/index.ts'

// The render rules (spec V4, S10): what the generator and the canvas both need per node type.
describe('render rules', () => {
  it('lays flex containers out in their direction', () => {
    expect(structuralStyle('Row')).toEqual({ direction: 'row' })
    for (const type of ['Page', 'Container', 'Column', 'Form', 'Card']) expect(structuralStyle(type)).toEqual({ direction: 'col' })
    expect(structuralStyle('Grid')).toEqual({})
    expect(structuralStyle('Text')).toEqual({})
    expect(['Row', 'Page', 'Card'].every(isFlexType)).toBe(true)
    expect(isFlexType('Grid')).toBe(false)
  })

  it('gives each layout type its display fallback', () => {
    expect(displayOf('Row')).toBe('flex')
    expect(displayOf('Container')).toBe('flex')
    expect(displayOf('Grid')).toBe('grid')
    expect(displayOf('Image')).toBe('block')
    expect(displayOf('Text')).toBe('')
    // A List's display follows its `layout` prop (stack by default).
    expect(displayOf('List')).toBe('flex')
    expect(displayOf('List', { layout: 'grid' })).toBe('grid')
    expect(displayOf('List', { layout: 'row' })).toBe('flex')
  })

  it('gives each type the token fallbacks it renders with before its own style', () => {
    expect(fallbackStyle('Container', {})).toEqual({ direction: 'col' })
    expect(fallbackStyle('Page', {})).toEqual({ direction: 'col', minH: 'full' })
    expect(fallbackStyle('Row', {})).toEqual({ direction: 'row' })
    expect(fallbackStyle('Row', { wrap: true })).toEqual({ direction: 'row', flexWrap: 'wrap' })
    expect(fallbackStyle('List', {})).toEqual({ direction: 'col' })
    expect(fallbackStyle('List', { layout: 'row' })).toEqual({ direction: 'row', flexWrap: 'wrap' })
    expect(fallbackStyle('List', { layout: 'grid' })).toEqual({})
    expect(fallbackStyle('Text', {})).toEqual({})
  })

  it('stretches block types across a vertical stack unless they set `self`', () => {
    expect(selfFallback('Container', {}, true)).toEqual({ self: 'stretch' })
    expect(selfFallback('Container', {}, false)).toEqual({})
    expect(selfFallback('Container', { self: 'start' }, true)).toEqual({})
    expect(selfFallback('Text', {}, true)).toEqual({})
    expect(selfFallback('Text', { 'md:align': 'center' }, true)).toEqual({ self: 'stretch' })
    expect(selfFallback('Button', {}, true)).toEqual({})
    expect(childrenInStack('Page', {})).toBe(true)
    expect(childrenInStack('Card', {})).toBe(true)
    expect(childrenInStack('Form', {})).toBe(true)
    expect(childrenInStack('Row', {})).toBe(false)
    expect(childrenInStack('Grid', {})).toBe(false)
    expect(childrenInStack('List', {})).toBe(true)
    expect(childrenInStack('List', { layout: 'grid' })).toBe(false)
  })

  it('renders the container tag the node names, or none for another', () => {
    expect(containerTag(undefined)).toBe('div')
    expect(containerTag('section')).toBe('section')
    expect(containerTag('script')).toBeUndefined()
  })

  it('renders heading levels 1–6 with their typography', () => {
    expect(headingLevel(5)).toBe(5)
    expect(headingLevel('3')).toBe(3)
    expect(headingLevel(7)).toBeUndefined()
    expect(HEADING_TOKENS[5]).toEqual({ text: 'lg', font: 'semibold' })
    expect(HEADING_TOKENS[6]).toEqual({ text: 'base', font: 'semibold' })
  })

  it('opens external links in a new tab', () => {
    expect(LINK_CLASS).toBe('underline-offset-4 hover:underline')
    expect(linkTarget('https://nuxt.com')).toBe('_blank')
    expect(linkTarget('/about')).toBeUndefined()
  })

  it('splits a card\'s style between the card and its inner stack', () => {
    expect(splitCardStyle({ 'gap': '2', 'md:gap': '4', 'p': '3', 'rounded': 'xl' })).toEqual({ root: { p: '3', rounded: 'xl' }, stack: { 'gap': '2', 'md:gap': '4' } })
  })

  it('names the props a node type does not accept', () => {
    expect(nodePropProblems('Button', { color: 'primary', variant: 'ghost', size: 'lg', icon: 'i-lucide-send' })).toEqual([])
    expect(nodePropProblems('Button', { color: 'pink' })).toEqual([{ key: 'color', message: 'Button color must be one of primary, secondary, success, info, warning, error, neutral' }])
    expect(nodePropProblems('Button', { variant: 'fancy' })[0]?.key).toBe('variant')
    expect(nodePropProblems('Button', { size: 'huge' })[0]?.key).toBe('size')
    expect(nodePropProblems('Link', { icon: 'send' })).toEqual([{ key: 'icon', message: 'An icon is a name like "i-lucide-send"' }])
    expect(nodePropProblems('Link', { href: 'javascript:alert(1)' })).toEqual([{ key: 'href', message: 'href must be an http(s), mailto: or tel: URL' }])
    expect(nodePropProblems('Link', { href: 'https://nuxt.com', to: { page: 'pg_x' } })).toEqual([{ key: 'href', message: 'A link has either `href` (external) or `to` (a page), not both' }])
    expect(nodePropProblems('Input', { inputType: 'email' })).toEqual([])
    expect(nodePropProblems('Input', { inputType: 'date' })).toEqual([{ key: 'inputType', message: 'inputType must be one of text, email, password, url, tel, number' }])
    expect(nodePropProblems('List', { layout: 'masonry' })).toEqual([{ key: 'layout', message: 'layout must be one of stack, grid, row' }])
    expect(nodePropProblems('Heading', { level: 7 })).toEqual([{ key: 'level', message: 'heading level must be 1–6' }])
    // Expressions are checked where they are evaluated, not here.
    expect(nodePropProblems('Button', { color: { $bind: 'x' } })).toEqual([])
  })

  it('names the element of each type', () => {
    expect(headingTag(DEFAULT_HEADING_LEVEL)).toBe('h2')
    expect(headingTag(5)).toBe('h5')
    expect(NODE_ELEMENTS).toMatchObject({ Text: 'p', Button: 'UButton', Checkbox: 'UCheckbox', Form: 'form', Link: 'ULink', Image: 'img', Input: 'UFormField', InputControl: 'UInput', InputMultiline: 'UTextarea' })
    expect(CONTAINER_TAGS[0]).toBe('div')
    expect(INPUT_CONTROL_CLASS).toBe('w-full')
  })

  it('holds the token fallbacks of headings, text, cards and images', () => {
    expect(HEADING_TOKENS[1]).toEqual({ text: '4xl', font: 'bold', tracking: 'tight' })
    expect(HEADING_TOKENS[4]).toEqual({ text: 'xl', font: 'semibold' })
    expect(TEXT_CLASS).toBe('whitespace-pre-line')
    expect(CARD_DEFAULT_STYLE).toEqual({ p: '6' })
    expect(CARD_STACK_KEYS).toEqual(['direction', 'flexWrap', 'gap', 'items', 'justify'])
    expect(IMAGE_FALLBACK_STYLE).toEqual({ maxW: 'full' })
  })

  // P2a (E3, "the canvas wins"): every divergence is resolved but a List's Load more, which needs
  // paged queries (P5). A new entry is a regression: resolve it instead of listing it.
  it('leaves only the List Load more divergence', () => {
    expect(KNOWN_DIVERGENCES.map(entry => entry.id)).toEqual(['list-load-more'])
  })
})
