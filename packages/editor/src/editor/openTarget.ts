import { isFileTarget } from './findingTargets.ts'
import type { Target } from './findingTargets.ts'
import { openItem } from './openItem.ts'
import type { OpenContext, Push } from './openItem.ts'

/**
 * Opens a target (`findingTargets.ts`, S8). The two that are not an item, a generated file in Code and a model file in All model files, are a route that is
 * pushed (from an editor, after asking about unsaved edits in the Data workspace, as any move away from it). An item is opened as every item is (`openItem`).
 * Resolves whether it was opened.
 */
export function openTarget(target: Target, context: OpenContext & { push: Push }): Promise<boolean> {
  if (!isFileTarget(target)) return openItem(target, context)
  const { to } = target
  const go = () => void context.push(to)
  if (!context.editor) {
    go()
    return Promise.resolve(true)
  }
  return context.editor.leaveData(go)
}
