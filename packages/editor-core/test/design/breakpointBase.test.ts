import { describe, expect, it } from 'vitest'
import { allTokenClasses, breakpointsOf, cascadeTo, convertStyleBase, getStyleToken, levels, parseStyleKey, styleClasses, styleTokenProblem, tokenSafelistCss, variantsOf } from '@bildr/codegen/design'

describe('levels: the cascade per breakpoint base (S37)', () => {
  it('orders a mobile project base, sm, md, lg and a desktop one base, max-lg, max-md, max-sm', () => {
    expect(levels('mobile')).toEqual([undefined, 'sm', 'md', 'lg'])
    expect(levels('desktop')).toEqual([undefined, 'max-lg', 'max-md', 'max-sm'])
    expect(breakpointsOf('mobile')).toEqual(['sm', 'md', 'lg'])
    expect(breakpointsOf('desktop')).toEqual(['max-lg', 'max-md', 'max-sm'])
  })

  it('gives the levels a breakpoint inherits from, its own family only', () => {
    expect(cascadeTo(undefined)).toEqual([undefined])
    expect(cascadeTo('md')).toEqual([undefined, 'sm', 'md'])
    expect(cascadeTo('max-md')).toEqual([undefined, 'max-lg', 'max-md'])
    expect(cascadeTo('max-sm')).toEqual([undefined, 'max-lg', 'max-md', 'max-sm'])
  })

  it('lists a token\'s variants for a base, or every prefix without one', () => {
    const cols = getStyleToken('cols')!
    expect(variantsOf(cols, 'desktop')).toEqual([undefined, 'max-lg', 'max-md', 'max-sm'])
    expect(variantsOf(cols, 'mobile')).toEqual([undefined, 'sm', 'md', 'lg'])
    expect(variantsOf(cols)).toEqual([undefined, 'sm', 'md', 'lg', 'max-lg', 'max-md', 'max-sm'])
    expect(variantsOf(getStyleToken('bg')!, 'desktop')).toEqual([undefined])
  })
})

describe('desktop-first style keys', () => {
  it('parses and renders max-* prefixes', () => {
    expect(parseStyleKey('max-lg:w')).toEqual({ token: getStyleToken('w'), breakpoint: 'max-lg' })
    expect(parseStyleKey('max-xl:w')).toBeUndefined()
    expect(styleClasses({ 'w': '96', 'max-lg:w': '64', 'max-sm:w': 'full' })).toBe('w-96 max-lg:w-64 max-sm:w-full')
    expect(styleClasses({ 'maxW': 'xl', 'max-md:maxW': 'full' })).toBe('max-w-xl max-md:max-w-full')
  })

  it('accepts only the project\'s own prefixes, naming the right ones', () => {
    expect(styleTokenProblem('max-lg:align', 'center', [], 'desktop')).toBeUndefined()
    expect(styleTokenProblem('md:cols', '3', [], 'mobile')).toBeUndefined()
    expect(styleTokenProblem('md:cols', '3', [], 'desktop')).toBe('Breakpoint "md" in style token "md:cols" is for mobile-first projects; this project is desktop-first (use max-lg:, max-md: or max-sm:)')
    expect(styleTokenProblem('max-lg:cols', '3', [], 'mobile')).toBe('Breakpoint "max-lg" in style token "max-lg:cols" is for desktop-first projects; this project is mobile-first (use sm:, md: or lg:)')
    expect(styleTokenProblem('max-lg:cols', '3')).toBe('Breakpoint "max-lg" in style token "max-lg:cols" is for desktop-first projects; this project is mobile-first (use sm:, md: or lg:)')
    expect(styleTokenProblem('xl:cols', '3', [], 'desktop')).toBe('Unknown breakpoint "xl" in style token "xl:cols" (use max-lg:, max-md: or max-sm:)')
    expect(styleTokenProblem('xl:cols', '3')).toBe('Unknown breakpoint "xl" in style token "xl:cols" (use sm:, md: or lg:)')
    expect(styleTokenProblem('max-lg:cols', '7', [], 'desktop')).toBe('"7" is not a value of style token "max-lg:cols"')
    expect(styleTokenProblem('max-lg:bg', 'primary', [], 'desktop')).toBe('Style token "bg" has no breakpoint variants (only Spacing, Size, Typography, Layout tokens do)')
  })

  it('safelists the max-* variants of the responsive tokens', () => {
    expect(tokenSafelistCss()).toContain('@source inline("{,sm:,md:,lg:,max-lg:,max-md:,max-sm:}col-span-{1,2,3,4,5,6,12,full}");')
    expect(tokenSafelistCss()).toContain('@source inline("bg-{primary,')
    expect(allTokenClasses()).toEqual(expect.arrayContaining(['max-lg:text-center', 'max-md:grid-cols-1', 'max-sm:hidden', 'max-lg:max-w-full']))
    expect(allTokenClasses()).not.toContain('max-lg:bg-primary')
  })
})

describe('convertStyleBase: a style between bases (paste across projects)', () => {
  it('keeps the value of every width band', () => {
    expect(convertStyleBase({ 'p': '4', 'md:p': '8', 'bg': 'primary' }, 'mobile', 'desktop')).toEqual({ style: { 'p': '8', 'max-md:p': '4', 'bg': 'primary' } })
    expect(convertStyleBase({ 'cols': '3', 'max-lg:cols': '2', 'max-sm:cols': '1' }, 'desktop', 'mobile')).toEqual({ style: { 'cols': '1', 'sm:cols': '2', 'lg:cols': '3' } })
    expect(convertStyleBase({ align: 'center' }, 'desktop', 'mobile')).toEqual({ style: { align: 'center' } })
  })

  it('returns the style unchanged within one base', () => {
    const style = { 'p': '4', 'md:p': '8' }
    expect(convertStyleBase(style, 'mobile', 'mobile')).toEqual({ style })
  })

  it('refuses a token unset at the target base but set at a narrower band, which the target cannot express', () => {
    expect(convertStyleBase({ 'md:cols': '3' }, 'mobile', 'desktop')).toEqual({ problem: 'Style token "md:cols" has no base value, so it cannot be converted to a desktop-first project' })
  })
})
