import { openUse } from './dataArtifactActions.ts'
import type { Target, TargetRoute } from './findingTargets.ts'
import type { Editor } from './useEditor.ts'
import { openView } from './views.ts'

/**
 * Opens a target (`findingTargets.ts`, S8). A target with a route (an item of the Data workspace, Code, All model files) is a
 * navigation. A page, a component or a layout opens on the canvas: through the editor of the screen when there is one (the Data and
 * Design screens, as a "Used in" link does), else (the Checks screen) the Design screen is opened on it.
 */
export function openTarget(target: Target, nav: { push: (to: TargetRoute) => unknown, editor: Editor | null }): void {
  if (target.to) {
    void nav.push(target.to)
  } else if (target.kind === 'page' || target.kind === 'component' || target.kind === 'layout') {
    if (nav.editor) openUse(nav.editor, { kind: target.kind, id: target.id })
    else openView('build', target.kind === 'page' ? { pageId: target.id } : { fileId: target.id })
  }
}
