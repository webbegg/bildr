import { describe, expect, it } from 'vitest'
import { checksAlert } from '../../src/editor/checksAlert.ts'
import type { CheckName, CheckResult, HealthReport } from '../../src/types.ts'

/** The failure dot of the Checks entry and the toolbar's menu button (S8): whether the last report has anything to look at, and the plain words for it. */

const result = (name: CheckName, ok: boolean): CheckResult => ({ name, ok, startedAt: '2026-11-13T09:00:00.000Z', durationMs: 5, summary: ok ? 'fine' : 'broken', findings: [] })
const report = (patch: Partial<HealthReport> = {}): HealthReport => ({ updatedAt: '2026-11-13T09:00:00.000Z', model: { ok: true }, drift: { missingManifest: false, files: [] }, checks: {}, ...patch })

describe('the failure dot', () => {
  it('shows nothing before the report is read, or when no check has run and nothing is wrong', () => {
    expect(checksAlert(null)).toBeNull()
    expect(checksAlert(report())).toBeNull()
    expect(checksAlert({ updatedAt: '', checks: {} })).toBeNull()
  })

  it('shows nothing when every check that ran passes', () => {
    expect(checksAlert(report({ checks: { lint: result('lint', true), types: result('types', true) } }))).toBeNull()
  })

  it('counts the checks that failed, in plain words', () => {
    expect(checksAlert(report({ checks: { lint: result('lint', false), types: result('types', true) } }))).toBe('1 check failed')
    expect(checksAlert(report({ checks: { lint: result('lint', false), types: result('types', false), tests: result('tests', true) } }))).toBe('2 checks failed')
  })

  it('shows when the model has problems', () => {
    expect(checksAlert(report({ model: { ok: false, problems: [{ path: '.bildr/modules/blog/pages/index.json', message: 'bad' }] } }))).toBe('The model has problems')
  })

  it('shows when a generated file differs from the model, and not for a project that was never synced or a drift that could not be read', () => {
    const files = [{ path: 'layers/blog/app/pages/index.vue', state: 'detached' }, { path: 'layers/blog/app/pages/new.vue', state: 'deleted' }]
    expect(checksAlert(report({ drift: { missingManifest: false, files: files.slice(0, 1) } }))).toBe('1 generated file differs from the model')
    expect(checksAlert(report({ drift: { missingManifest: false, files } }))).toBe('2 generated files differ from the model')
    expect(checksAlert(report({ drift: { missingManifest: true, files: [] } }))).toBeNull()
    expect(checksAlert(report({ drift: { error: 'could not read' } }))).toBeNull()
  })

  it('says everything that is wrong, one sentence each', () => {
    const wrong = report({
      model: { ok: false, problems: [{ path: '.bildr/bildr.json', message: 'bad' }] },
      drift: { missingManifest: false, files: [{ path: 'layers/blog/app/pages/index.vue', state: 'detached' }] },
      checks: { build: result('build', false) }
    })
    expect(checksAlert(wrong)).toBe('1 check failed. The model has problems. 1 generated file differs from the model')
  })
})
