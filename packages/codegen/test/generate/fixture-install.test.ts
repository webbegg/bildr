import { describe, expect, it } from 'vitest'
import { fixtureGate } from './fixture-install'

/** The compile tests need the golden fixture's node_modules: without them they skip, and say so once, loudly (verify R3-002). */
describe('fixtureGate', () => {
  const INSTALL = 'pnpm --dir fixtures/codegen/blog install'

  it('runs the tests, silently, when the fixture is installed', () => {
    const warnings: string[] = []
    const gate = fixtureGate(message => warnings.push(message))
    expect(gate({ installed: true, ci: false })).toBe('')
    expect(warnings).toEqual([])
  })

  it('skips with a console warning that names the install command, once, outside CI', () => {
    const warnings: string[] = []
    const gate = fixtureGate(message => warnings.push(message))
    expect(gate({ installed: false, ci: false })).toBe(` (skipped: run \`${INSTALL}\` first)`)
    expect(gate({ installed: false, ci: false })).toContain('skipped')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(INSTALL)
    expect(warnings[0]).toMatch(/skipp/i)
  })

  it('does not change in CI: it runs the tests (a missing install fails them), with no warning', () => {
    const warnings: string[] = []
    const gate = fixtureGate(message => warnings.push(message))
    expect(gate({ installed: false, ci: true })).toBe('')
    expect(gate({ installed: true, ci: true })).toBe('')
    expect(warnings).toEqual([])
  })
})
