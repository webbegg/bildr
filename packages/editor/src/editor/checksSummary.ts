import type { DriftFile, HealthReport } from '../types.ts'

/**
 * What the last Health report says is wrong (S8), in plain words, or null when there is nothing to look at: the reason of the failure dot
 * (the Checks entry of the view menu, the toolbar's menu button) and the line at the top of the Checks screen. One sentence for each thing, each ending in a full stop.
 *
 * Only what needs the user counts. A file `detached` (edited by hand: bildr no longer overwrites it) or `deleted` (removed: bildr does not
 * write it back) differs from the model. An `orphaned` file is one bildr no longer generates and keeps, a `pending` one is written by the next sync
 * and a scaffold is the user's from the start: nothing to do. A check that has not run says nothing; neither does a project bildr has not
 * synced yet (no manifest to differ from) or a drift that could not be read (the Checks screen says so).
 */
export function checksSummary(health: HealthReport | null): string | null {
  if (!health) return null
  const failed = Object.values(health.checks).filter(check => check && !check.ok).length
  const files: DriftFile[] = health.drift && 'files' in health.drift ? health.drift.files : []
  const edited = files.filter(file => file.state === 'detached').length
  const deleted = files.filter(file => file.state === 'deleted').length
  const sentences = [
    ...(failed ? [`${failed} ${failed === 1 ? 'check' : 'checks'} failed`] : []),
    ...(health.model && !health.model.ok ? ['Some model files have problems'] : []),
    ...(edited ? [`${edited} ${edited === 1 ? 'file bildr wrote was' : 'files bildr wrote were'} edited by hand`] : []),
    ...(deleted ? [`${deleted} ${deleted === 1 ? 'file bildr wrote was' : 'files bildr wrote were'} deleted`] : [])
  ]
  return sentences.length ? `${sentences.join('. ')}.` : null
}
