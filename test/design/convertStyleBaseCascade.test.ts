import { describe, expect, it } from 'vitest'
import { convertStyleBase, levels, parseStyleKey } from '../../shared/design/tokens'
import type { BreakpointBase } from '../../shared/design/tokens'

const BANDS = [500, 700, 900, 1280]
const SIDE_KEYS: Record<string, string[]> = { p: ['p', 'px', 'pl'], m: ['m', 'mx', 'ml'] }
function bandsOf(style: Record<string, string>, base: BreakpointBase, family: 'p' | 'm'): (string | undefined)[] {
  const order = levels(base)
  const applies = (bp: string | undefined, width: number) => {
    if (!bp) return true
    const min = { sm: 640, md: 768, lg: 1024 }[bp as 'sm']
    const below = { 'max-sm': 640, 'max-md': 768, 'max-lg': 1024 }[bp as 'max-sm']
    return min !== undefined ? width >= min : width < below!
  }
  return BANDS.map((width) => {
    let best: { rank: number, value: string } | undefined
    for (const [key, value] of Object.entries(style)) {
      const parsed = parseStyleKey(key)
      const specificity = parsed ? SIDE_KEYS[family]!.indexOf(parsed.token.key) : -1
      if (!parsed || specificity < 0 || !applies(parsed.breakpoint, width)) continue
      const rank = order.indexOf(parsed.breakpoint) * 10 + specificity
      if (!best || rank > best.rank) best = { rank, value }
    }
    return best?.value
  })
}

describe('convertStyleBase with overlapping spacing tokens', () => {
  it.each([
    ['mobile', 'desktop', 'p', { 'p': '2', 'pl': '8', 'md:p': '4' }],
    ['desktop', 'mobile', 'p', { 'p': '4', 'pl': '8', 'max-md:p': '2' }],
    ['mobile', 'desktop', 'p', { 'px': '2', 'pl': '8', 'md:px': '4' }],
    ['mobile', 'desktop', 'm', { 'm': '2', 'ml': '8', 'lg:m': '4' }]
  ] as const)('%s → %s keeps the %s side of %j in every band, or refuses it', (from, to, family, style) => {
    const result = convertStyleBase(style, from, to)
    if ('problem' in result) return
    expect(bandsOf(result.style, to, family)).toEqual(bandsOf(style, from, family))
  })
  it('still converts a lone responsive shorthand', () => {
    expect(convertStyleBase({ 'p': '2', 'md:p': '4' }, 'mobile', 'desktop')).toEqual({ style: { 'p': '4', 'max-md:p': '2' } })
  })
  it('still converts a non-responsive mix of a shorthand and a side unchanged', () => {
    expect(convertStyleBase({ p: '2', pl: '8' }, 'mobile', 'desktop')).toEqual({ style: { p: '2', pl: '8' } })
  })
  it('names the overlapping tokens when it refuses', () => {
    expect(convertStyleBase({ 'p': '2', 'pl': '8', 'md:p': '4' }, 'mobile', 'desktop')).toEqual({
      problem: 'Style tokens "p" and "pl" overlap and one of them changes per breakpoint, so they cannot be converted to a desktop-first project'
    })
  })
  it('converts responsive tokens of one family that set different sides', () => {
    expect(convertStyleBase({ 'px': '2', 'py': '8', 'md:px': '4' }, 'mobile', 'desktop')).toEqual({ style: { 'px': '4', 'max-md:px': '2', 'py': '8' } })
  })
})
