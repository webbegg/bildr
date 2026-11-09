import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { allTokenClasses, getStyleToken, isStyleTokenKey, STYLE_TOKENS, styleClasses, styleTokenProblem, tokenSafelistCss } from '#shared/design/tokens'

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
      'border', 'rounded', 'shadow', 'items', 'justify', 'self', 'cols', 'colSpan'
    ])
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
