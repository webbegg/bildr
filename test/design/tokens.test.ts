import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { allTokenClasses, BREAKPOINTS, displayFallback, getStyleToken, isResponsiveToken, isStyleTokenKey, parseStyleKey, STYLE_TOKENS, styleClasses, styleKey, styleTokenProblem, tokenSafelistCss } from '#shared/design/tokens'

const TOKENS_CSS = new URL('../../app/assets/css/tokens.css', import.meta.url)

/** Expands `{a,b}` groups the way Tailwind's `@source inline` does, for the coverage check. */
function expand(pattern: string): string[] {
  const match = /\{([^{}]*)\}/.exec(pattern)
  if (!match) return [pattern]
  return match[1]!.split(',').flatMap(part => expand(pattern.slice(0, match.index) + part + pattern.slice(match.index + match[0].length)))
}

describe('style token registry', () => {
  it('covers the S9 properties', () => {
    expect(STYLE_TOKENS.map(t => t.key)).toEqual([
      'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml', 'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'gap',
      'w', 'maxW', 'minH', 'bg', 'color', 'borderColor', 'text', 'font', 'align',
      'border', 'borderT', 'borderR', 'borderB', 'borderL', 'rounded', 'roundedTl', 'roundedTr', 'roundedBr', 'roundedBl',
      'shadow', 'opacity', 'direction', 'items', 'justify', 'self', 'cols', 'colSpan', 'display', 'overflow'
    ])
    expect(getStyleToken('direction')).toMatchObject({ prefix: 'flex', group: 'Layout', values: ['row', 'col', 'row-reverse', 'col-reverse'] })
    expect(isResponsiveToken(getStyleToken('direction')!)).toBe(true)
    expect(getStyleToken('self')).toMatchObject({ prefix: 'self', group: 'Layout', values: ['auto', 'start', 'center', 'end', 'stretch'] })
    expect(getStyleToken('cols')).toMatchObject({ prefix: 'grid-cols', group: 'Layout', values: ['1', '2', '3', '4', '5', '6', '12'] })
    expect(getStyleToken('colSpan')).toMatchObject({ prefix: 'col-span', group: 'Layout', values: ['1', '2', '3', '4', '5', '6', '12', 'full'] })
    expect(getStyleToken('maxW')).toMatchObject({ prefix: 'max-w', group: 'Size' })
    expect(getStyleToken('bg')).toMatchObject({ kind: 'color', group: 'Color' })
    expect(getStyleToken('mt')!.values).toEqual(expect.arrayContaining(['0', '0.5', '10', 'auto']))
    expect(getStyleToken('bg')!.values).toEqual(expect.arrayContaining(['primary', 'primary-500', 'neutral-950', 'elevated']))
    expect(isStyleTokenKey('mt')).toBe(true)
    expect(isStyleTokenKey('padding')).toBe(false)
  })

  it('reports unknown keys and values', () => {
    expect(styleTokenProblem('mt', '10')).toBeUndefined()
    expect(styleTokenProblem('mt', '13')).toBe('"13" is not a value of style token "mt"')
    expect(styleTokenProblem('p', '16px')).toBe('"16px" is not a value of style token "p"')
    expect(styleTokenProblem('position', 'fixed')).toBe('Unknown style token "position"')
  })

  it('maps tokens to Tailwind classes in registry order', () => {
    expect(styleClasses({ rounded: 'lg', bg: 'primary', mt: '10' })).toBe('mt-10 bg-primary rounded-lg')
    expect(styleClasses({ maxW: '2xl', w: '1/2', color: 'error', text: '2xl', border: '1' })).toBe('w-1/2 max-w-2xl text-error text-2xl border-1')
    expect(styleClasses({ colSpan: 'full', cols: '3', self: 'center' })).toBe('self-center grid-cols-3 col-span-full')
    expect(styleClasses({})).toBe('')
  })

  it('ignores tokens that are not in the registry', () => {
    expect(styleClasses({ mt: '13', position: 'fixed', p: '4' })).toBe('p-4')
  })
})

describe('responsive style keys', () => {
  it('parses a breakpoint prefix onto a base token', () => {
    expect(BREAKPOINTS).toEqual(['sm', 'md', 'lg'])
    expect(parseStyleKey('cols')).toEqual({ token: getStyleToken('cols'), breakpoint: undefined })
    expect(parseStyleKey('md:cols')).toEqual({ token: getStyleToken('cols'), breakpoint: 'md' })
    expect(parseStyleKey('lg:mt')).toEqual({ token: getStyleToken('mt'), breakpoint: 'lg' })
    expect(parseStyleKey('xl:cols')).toBeUndefined()
    expect(parseStyleKey('md:padding')).toBeUndefined()
    expect(parseStyleKey('md:md:cols')).toBeUndefined()
    expect(styleKey('cols', undefined)).toBe('cols')
    expect(styleKey('cols', 'md')).toBe('md:cols')
    expect(isStyleTokenKey('sm:p')).toBe(true)
    expect(isStyleTokenKey('xl:p')).toBe(false)
  })

  it('validates a prefixed key against its base token values', () => {
    expect(styleTokenProblem('md:cols', '3')).toBeUndefined()
    expect(styleTokenProblem('sm:gap', '4')).toBeUndefined()
    expect(styleTokenProblem('md:cols', '7')).toBe('"7" is not a value of style token "md:cols"')
    expect(styleTokenProblem('xl:cols', '3')).toBe('Unknown breakpoint "xl" in style token "xl:cols" (use sm:, md: or lg:)')
    expect(styleTokenProblem('md:padding', '4')).toBe('Unknown style token "md:padding"')
  })

  it('limits breakpoint variants to the layout groups', () => {
    expect(STYLE_TOKENS.filter(isResponsiveToken).map(t => t.group)).not.toContain('Color')
    expect(isResponsiveToken(getStyleToken('cols')!)).toBe(true)
    expect(isResponsiveToken(getStyleToken('text')!)).toBe(true)
    expect(isResponsiveToken(getStyleToken('bg')!)).toBe(false)
    expect(parseStyleKey('md:bg')).toBeUndefined()
    expect(styleTokenProblem('md:bg', 'primary')).toBe('Style token "bg" has no breakpoint variants (only Spacing, Size, Typography, Layout tokens do)')
    expect(styleClasses({ 'bg': 'primary', 'md:bg': 'error' })).toBe('bg-primary')
    expect(allTokenClasses()).not.toContain('md:bg-primary')
    expect(tokenSafelistCss()).toContain('@source inline("bg-{primary,')
  })

  it('maps prefixed keys to variant classes, ordered by base key then base, sm, md, lg', () => {
    expect(styleClasses({ 'cols': '1', 'md:cols': '3' })).toBe('grid-cols-1 md:grid-cols-3')
    expect(styleClasses({ 'lg:p': '8', 'md:mt': '4', 'p': '4', 'mt': '2', 'sm:mt': '3' })).toBe('mt-2 sm:mt-3 md:mt-4 p-4 lg:p-8')
    expect(styleClasses({ 'md:cols': '7', 'xl:cols': '3' })).toBe('')
  })

  it('generates the variant classes in the safelist', () => {
    expect(allTokenClasses()).toEqual(expect.arrayContaining(['md:grid-cols-3', 'sm:mt-10', 'lg:col-span-full', 'md:text-2xl', 'lg:self-center']))
    expect(tokenSafelistCss()).toContain('@source inline("{,sm:,md:,lg:}grid-cols-{1,2,3,4,5,6,12}");')
  })
})

describe('Framer appearance tokens', () => {
  it('adds opacity on a 0–100 scale, base-only', () => {
    expect(getStyleToken('opacity')).toMatchObject({ prefix: 'opacity', group: 'Effects', values: ['0', '5', '10', '20', '25', '30', '40', '50', '60', '70', '75', '80', '90', '95', '100'] })
    expect(styleClasses({ opacity: '50' })).toBe('opacity-50')
    expect(styleTokenProblem('md:opacity', '50')).toBe('Style token "opacity" has no breakpoint variants (only Spacing, Size, Typography, Layout tokens do)')
  })

  it('adds a responsive overflow', () => {
    expect(getStyleToken('overflow')).toMatchObject({ prefix: 'overflow', group: 'Layout', values: ['visible', 'hidden', 'auto', 'scroll', 'clip'] })
    expect(styleClasses({ 'overflow': 'hidden', 'md:overflow': 'auto' })).toBe('overflow-hidden md:overflow-auto')
    expect(allTokenClasses()).toEqual(expect.arrayContaining(['overflow-clip', 'lg:overflow-scroll']))
  })

  it('adds per-corner radius and per-side border width with the values of the all-sides token', () => {
    const rounded = getStyleToken('rounded')!.values
    const border = getStyleToken('border')!.values
    expect(['roundedTl', 'roundedTr', 'roundedBr', 'roundedBl'].map(k => getStyleToken(k)!.prefix)).toEqual(['rounded-tl', 'rounded-tr', 'rounded-br', 'rounded-bl'])
    expect(['borderT', 'borderR', 'borderB', 'borderL'].map(k => getStyleToken(k)!.prefix)).toEqual(['border-t', 'border-r', 'border-b', 'border-l'])
    for (const k of ['roundedTl', 'roundedTr', 'roundedBr', 'roundedBl']) expect(getStyleToken(k)).toMatchObject({ group: 'Border', values: rounded })
    for (const k of ['borderT', 'borderR', 'borderB', 'borderL']) expect(getStyleToken(k)).toMatchObject({ group: 'Border', values: border })
    expect(styleClasses({ roundedTl: 'lg', rounded: 'md', borderB: '2' })).toBe('border-b-2 rounded-md rounded-tl-lg')
  })
})

describe('display token', () => {
  it('is a responsive Layout token whose classes have no prefix', () => {
    expect(getStyleToken('display')).toMatchObject({ prefix: '', group: 'Layout', values: ['hidden', 'block', 'flex', 'grid'] })
    expect(styleClasses({ display: 'hidden' })).toBe('hidden')
    expect(styleClasses({ 'display': 'hidden', 'md:display': 'flex', 'p': '4' })).toBe('p-4 hidden md:flex')
    expect(styleTokenProblem('lg:display', 'grid')).toBeUndefined()
    expect(styleTokenProblem('display', 'inline')).toBe('"inline" is not a value of style token "display"')
    expect(allTokenClasses()).toEqual(expect.arrayContaining(['hidden', 'md:flex', 'lg:hidden', 'sm:grid']))
    expect(allTokenClasses()).not.toContain('-hidden')
    expect(tokenSafelistCss()).toContain('@source inline("{,sm:,md:,lg:}{hidden,block,flex,grid}");')
  })

  it('replaces the template display class only when set at the base', () => {
    expect(displayFallback('flex', {})).toBe('flex')
    expect(displayFallback('grid', { 'md:display': 'hidden' })).toBe('grid')
    expect(displayFallback('flex', { display: 'hidden' })).toBe('')
    expect(displayFallback('block', { display: 'flex' })).toBe('')
  })
})

describe('token safelist', () => {
  it('lists every registry class exactly once', () => {
    const lines = tokenSafelistCss().split('\n').filter(l => l.startsWith('@source inline('))
    const classes = lines.flatMap(l => expand(/^@source inline\("(.*)"\);$/.exec(l)![1]!))
    expect(classes.sort()).toEqual([...allTokenClasses()].sort())
    expect(new Set(allTokenClasses()).size).toBe(allTokenClasses().length)
    expect(allTokenClasses()).toEqual(expect.arrayContaining(['mt-10', 'mt-0.5', 'w-1/2', 'bg-primary-500', 'shadow-lg', 'justify-between']))
  })

  it('matches the generated app/assets/css/tokens.css (run `pnpm tokens:css` after changing the registry)', () => {
    expect(readFileSync(TOKENS_CSS, 'utf8')).toBe(tokenSafelistCss())
  })
})
