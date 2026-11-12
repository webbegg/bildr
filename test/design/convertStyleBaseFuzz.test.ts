import { describe, expect, it } from 'vitest'
import { STYLE_TOKENS, convertStyleBase, isStyleKeyOf, levels, parseStyleKey } from '../../shared/design/tokens'
import type { BreakpointBase } from '../../shared/design/tokens'

const WIDTHS = [400, 700, 900, 1300]
const MIN: Record<string, number> = { sm: 640, md: 768, lg: 1024 }
const MAX: Record<string, number> = { 'max-sm': 640, 'max-md': 768, 'max-lg': 1024 }
const applies = (bp: string | undefined, w: number) => !bp || (bp in MIN ? w >= MIN[bp]! : w < MAX[bp]!)
// Sides per token, and Tailwind v4 property order (shorthand < axis < side).
const FAM: Record<string, [string, number]> = {}
for (const f of ['m', 'p']) Object.assign(FAM, { [f]: ['trbl', 0], [`${f}x`]: ['rl', 1], [`${f}y`]: ['tb', 1], [`${f}t`]: ['t', 2], [`${f}r`]: ['r', 2], [`${f}b`]: ['b', 2], [`${f}l`]: ['l', 2] })

function computed(style: Record<string, string>, base: BreakpointBase) {
  const order = levels(base)
  const winner = (match: (token: string) => number | undefined) => WIDTHS.map((w) => {
    let best: { r: number, v: string } | undefined
    for (const [k, v] of Object.entries(style)) {
      const p = parseStyleKey(k)!
      const rank = match(p.token.key)
      if (rank === undefined || !applies(p.breakpoint, w)) continue
      const r = order.indexOf(p.breakpoint) * 10 + rank
      if (!best || r > best.r) best = { r, v }
    }
    return best?.v
  })
  const out: Record<string, (string | undefined)[]> = {}
  for (const f of ['m', 'p']) for (const s of 'trbl') out[f + s] = winner(t => (t[0] === f && FAM[t]?.[0].includes(s) ? FAM[t]![1] : undefined))
  for (const t of new Set(Object.keys(style).map(k => parseStyleKey(k)!.token.key))) if (!FAM[t]) out[t] = winner(x => (x === t ? 0 : undefined))
  return out
}

let seed = 987654321
const rnd = (n: number) => {
  seed = seed + 0x6D2B79F5 | 0
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
  return Math.floor(((t ^ t >>> 14) >>> 0) / 4294967296 * n)
}
const keys = [...Object.keys(FAM), 'border', 'borderL', 'rounded', 'roundedTl', 'gap', 'cols', 'w']
function randomStyle(base: BreakpointBase) {
  const style: Record<string, string> = {}
  for (let i = 1 + rnd(5); i > 0; i--) {
    const key = keys[rnd(keys.length)]
    const tok = STYLE_TOKENS.find(t => t.key === key)!
    const bp = ['Spacing', 'Size', 'Layout'].includes(tok.group) && rnd(3) === 0 ? levels(base)[1 + rnd(3)] : undefined
    style[bp ? `${bp}:${tok.key}` : tok.key] = tok.values[rnd(4)]!
  }
  return style
}

describe('convertStyleBase keeps every side of every band, or refuses (fuzz)', () => {
  for (const [from, to] of [['mobile', 'desktop'], ['desktop', 'mobile']] as const) {
    it(`${from} → ${to}`, () => {
      for (let i = 0; i < 5000; i++) {
        const style = randomStyle(from)
        const result = convertStyleBase(style, from, to)
        if ('problem' in result) continue
        for (const k of Object.keys(result.style)) expect(isStyleKeyOf(k, to), k).toBe(true)
        expect(computed(result.style, to), JSON.stringify(style)).toEqual(computed(style, from))
      }
    })
  }

  it.each([
    [{ 'p': '2', 'md:pl': '8' }, 'mobile', 'desktop'],
    [{ 'py': '2', 'pt': '1', 'md:pt': '8' }, 'mobile', 'desktop'],
    [{ 'm': '2', 'mx': '1', 'max-md:mx': 'auto' }, 'desktop', 'mobile']
  ] as const)('refuses %j (%s → %s)', (style, from, to) => {
    expect(convertStyleBase(style, from, to)).toMatchObject({ problem: expect.stringContaining('overlap and one of them changes per breakpoint') })
  })
})
