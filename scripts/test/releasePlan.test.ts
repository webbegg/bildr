import { describe, expect, it } from 'vitest'
import { nextVersion, releaseSteps } from '../releasePlan.ts'

describe('nextVersion', () => {
  it('bumps patch, minor and major', () => {
    expect(nextVersion('0.1.0', 'patch')).toBe('0.1.1')
    expect(nextVersion('0.1.3', 'minor')).toBe('0.2.0')
    expect(nextVersion('0.4.2', 'major')).toBe('1.0.0')
  })

  it('takes an explicit version above the current one', () => {
    expect(nextVersion('0.1.0', '0.3.0')).toBe('0.3.0')
    expect(nextVersion('0.1.0', 'v0.1.1')).toBe('0.1.1')
  })

  it('refuses a version that is not above the current one', () => {
    expect(() => nextVersion('0.1.0', '0.1.0')).toThrow(/above 0\.1\.0/)
    expect(() => nextVersion('0.2.0', '0.1.9')).toThrow(/above 0\.2\.0/)
  })

  it('refuses anything that is not x.y.z or a bump', () => {
    expect(() => nextVersion('0.1.0', '1.0')).toThrow(/x\.y\.z/)
    expect(() => nextVersion('0.1.0', '1.0.0-beta.1')).toThrow(/x\.y\.z/)
    expect(() => nextVersion('0.1.0', '')).toThrow(/x\.y\.z/)
  })
})

describe('releaseSteps', () => {
  const labels = (dryRun: boolean) => releaseSteps('0.2.0', { dryRun }).map(s => s.label)

  it('runs every check before it commits, publishes or pushes', () => {
    const steps = labels(false)
    const firstWrite = steps.indexOf('commit')
    for (const check of ['install', 'build editor', 'build packages', 'lint', 'typecheck', 'install golden fixture', 'test'])
      expect(steps.indexOf(check)).toBeGreaterThan(-1)
    for (const check of ['install', 'lint', 'typecheck', 'test'])
      expect(steps.indexOf(check)).toBeLessThan(firstWrite)
  })

  it('publishes before it pushes, so a failed publish leaves nothing on GitHub', () => {
    const steps = labels(false)
    expect(steps.slice(steps.indexOf('commit'))).toEqual(['commit', 'tag', 'publish', 'push'])
  })

  it('pushes main and the tag', () => {
    const push = releaseSteps('0.2.0', { dryRun: false }).find(s => s.label === 'push')
    expect(push?.args).toEqual(['push', '--atomic', 'origin', 'main', 'v0.2.0'])
  })

  it('a dry run commits, tags, publishes and pushes nothing: it packs the tarballs instead', () => {
    // publish --dry-run would skip every version already on npm, and a dry run does not bump.
    const steps = releaseSteps('0.2.0', { dryRun: true, packDir: '/tmp/x' })
    expect(steps.map(s => s.label).slice(-1)).toEqual(['pack'])
    for (const label of ['commit', 'tag', 'publish', 'push']) expect(steps.map(s => s.label)).not.toContain(label)
    expect(steps.at(-1)?.args).toEqual(['-r', '--filter', './packages/**', 'pack', '--pack-destination', '/tmp/x'])
  })
})
