import { describe, expect, it } from 'vitest'
import { checksSummary } from '../../src/editor/checksSummary.ts'
import type { CheckName, CheckResult, DriftFile, FileState, HealthReport } from '../../src/types.ts'

/**
 * What the last Health report says is wrong (S8), in plain words: the failure dot's reason in the menu and the toolbar, and the line at
 * the top of the Checks screen. Only what needs the user counts.
 */

const result = (name: CheckName, ok: boolean): CheckResult => ({ name, ok, startedAt: '2026-11-13T09:00:00.000Z', durationMs: 5, summary: ok ? 'fine' : 'broken', findings: [] })
const report = (patch: Partial<HealthReport> = {}): HealthReport => ({ updatedAt: '2026-11-13T09:00:00.000Z', model: { ok: true }, drift: { missingManifest: false, files: [] }, checks: {}, ...patch })
const file = (state: FileState, name = 'index'): DriftFile => ({ path: `layers/blog/app/pages/${name}.vue`, state })
const drifted = (...files: DriftFile[]) => report({ drift: { missingManifest: false, files } })

describe('the summary of the checks', () => {
  it('says nothing before the report is read, or when no check has run and nothing is wrong', () => {
    expect(checksSummary(null)).toBeNull()
    expect(checksSummary(report())).toBeNull()
    expect(checksSummary({ updatedAt: '', checks: {} })).toBeNull()
  })

  it('says nothing when every check that ran passes', () => {
    expect(checksSummary(report({ checks: { lint: result('lint', true), types: result('types', true) } }))).toBeNull()
  })

  it('counts the checks that failed', () => {
    expect(checksSummary(report({ checks: { lint: result('lint', false), types: result('types', true) } }))).toBe('1 check failed.')
    expect(checksSummary(report({ checks: { lint: result('lint', false), types: result('types', false), tests: result('tests', true) } }))).toBe('2 checks failed.')
  })

  it('says some model files have problems', () => {
    expect(checksSummary(report({ model: { ok: false, problems: [{ path: '.bildr/modules/blog/pages/index.json', message: 'bad' }] } }))).toBe('Some model files have problems.')
  })

  it('says each file bildr wrote that was edited by hand, or deleted', () => {
    expect(checksSummary(drifted(file('detached')))).toBe('1 file bildr wrote was edited by hand.')
    expect(checksSummary(drifted(file('detached'), file('detached', 'new')))).toBe('2 files bildr wrote were edited by hand.')
    expect(checksSummary(drifted(file('deleted')))).toBe('1 file bildr wrote was deleted.')
    expect(checksSummary(drifted(file('deleted'), file('deleted', 'new')))).toBe('2 files bildr wrote were deleted.')
    expect(checksSummary(drifted(file('detached'), file('deleted', 'new'), file('deleted', 'old')))).toBe('1 file bildr wrote was edited by hand. 2 files bildr wrote were deleted.')
  })

  // Only the states that ask something of the user count (the states of `FileState`, `codegen/sync/drift.ts`).
  it.each<[FileState, string | null]>([
    ['detached', '1 file bildr wrote was edited by hand.'],
    ['deleted', '1 file bildr wrote was deleted.'],
    // No longer generated, and kept because it was edited: bildr leaves it alone, so there is nothing to do.
    ['orphaned', null],
    // Generated but not written yet: the next sync writes it.
    ['pending', null],
    // Written once and the user's since: a file the user is meant to change.
    ['scaffold', null],
    ['managed', null],
    ['anything-else', null]
  ])('counts a file that is %s: %j', (state, wanted) => {
    expect(checksSummary(drifted(file(state)))).toBe(wanted)
  })

  it('does not count what is not drift: a project never synced, or a drift that could not be read', () => {
    expect(checksSummary(report({ drift: { missingManifest: true, files: [] } }))).toBeNull()
    expect(checksSummary(report({ drift: { error: 'could not read' } }))).toBeNull()
  })

  it('says everything that is wrong, one sentence each, in plain words', () => {
    const wrong = report({
      model: { ok: false, problems: [{ path: '.bildr/bildr.json', message: 'bad' }] },
      drift: { missingManifest: false, files: [file('detached')] },
      checks: { build: result('build', false) }
    })
    const summary = checksSummary(wrong)
    expect(summary).toBe('1 check failed. Some model files have problems. 1 file bildr wrote was edited by hand.')
    // The words of S2: no "generated", "drift" or "model" as jargon, no states.
    expect(summary).not.toMatch(/generated|drift|detached/i)
  })
})
