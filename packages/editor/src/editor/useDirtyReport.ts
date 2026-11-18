import { onBeforeUnmount, watch } from 'vue'
import { useEditor } from './useEditor.ts'

/**
 * How a component of the Data workspace says it holds edits that are not saved (the editor's registry, `reportDirty`): `label` is
 * the item's name the workspace asks about before it moves away (`Discard unsaved changes to <label>?`), or null when nothing is
 * unsaved. The component holds its own token, so when it unmounts it clears its own report and no other's. It reports again when the
 * workspace asks (`reportDirtyAgain`, after a discard that was confirmed for a move that was not made): what it still holds is
 * unsaved still.
 */
export function useDirtyReport(label: () => string | null) {
  const editor = useEditor()
  const report = editor.reportDirty()
  watch([label, () => editor.dirtyAsked], ([next]) => report.set(next), { flush: 'sync', immediate: true })
  onBeforeUnmount(report.clear)
}
