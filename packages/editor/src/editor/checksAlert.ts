import type { HealthReport } from '../types.ts'

/**
 * The failure dot (S8) of the Checks entry in the view menu and of the toolbar's menu button: what the last Health report says is wrong,
 * in plain words, or null when there is nothing to look at. A check that has not run says nothing; neither does a project bildr has not
 * synced yet (no manifest to differ from) or a drift that could not be read (the Checks screen says so).
 */
export function checksAlert(health: HealthReport | null): string | null {
  if (!health) return null
  const failed = Object.values(health.checks).filter(check => check && !check.ok).length
  const files = health.drift && 'files' in health.drift ? health.drift.files.length : 0
  const parts = [
    ...(failed ? [`${failed} ${failed === 1 ? 'check' : 'checks'} failed`] : []),
    ...(health.model && !health.model.ok ? ['The model has problems'] : []),
    ...(files ? [`${files} generated ${files === 1 ? 'file differs' : 'files differ'} from the model`] : [])
  ]
  return parts.length ? parts.join('. ') : null
}
