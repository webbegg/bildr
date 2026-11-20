import { computed, onBeforeUnmount, onMounted, provide } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useToast } from '@nuxt/ui/composables/useToast'
import { createDesign, DESIGN_KEY } from '../design/store.ts'
import { useStatus } from '../status.ts'
import { createEditor, provideEditor } from './useEditor.ts'
import type { Editor } from './useEditor.ts'

/**
 * What the Data screens share (the Data workspace, `/data/advanced`, and the simple Data section, `/data`): an editor on the Data view over
 * the `.bildr/` model, with the hosted page's chrome (the toolbar, ⌘K, undo and redo outside fields), the dark editor chrome of the
 * document, and the guard that asks before the screen is left with edits that are not saved. The pending migration plan is the shell's
 * status: the editor tells it when the screen shows the plan itself (`editor.planShown`), so the shell's own banner shows only while
 * the screen does not. The screen's own setup (its URL, its views) is left to it.
 */
export function useDataScreen(): Editor {
  const design = createDesign()
  provide(DESIGN_KEY, design)
  const toast = useToast()
  const status = useStatus()
  const editor = provideEditor(createEditor(design, { toast: notice => toast.add(notice), view: 'data', plan: status.plan }))
  const withdrawPlanShown = status.showPlanFrom(computed(() => editor.planShown))
  // Leaving the screen is a move away from unsaved edits too.
  onBeforeRouteLeave(() => editor.dataDirty === null || editor.leaveData(() => {}))

  const isEditable = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null
    return !!el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
  }

  // Keys inside a popover or menu are theirs.
  const inFloatingLayer = (event: KeyboardEvent): boolean =>
    !!(event.target as HTMLElement | null)?.closest?.('[data-dismissable-layer], [role="dialog"], [role="menu"], [role="listbox"]')

  // ⌘K opens the quick actions and ⌘P the preview from anywhere; undo and redo work outside fields.
  const onKeyDown = (event: KeyboardEvent) => {
    const meta = event.metaKey || event.ctrlKey
    const key = event.key.toLowerCase()
    if (meta && !event.shiftKey && !event.altKey && (key === 'p' || key === 'k')) {
      if (editor.shortcut(event.key, true, false)) event.preventDefault()
      return
    }
    if (event.defaultPrevented || isEditable(event.target) || inFloatingLayer(event)) return
    if (meta && (key === 'z' || key === 'y') && editor.shortcut(event.key, true, event.shiftKey)) event.preventDefault()
  }

  // The dark editor chrome (main.css) is scoped to this page's document.
  onMounted(() => {
    window.addEventListener('keydown', onKeyDown)
    document.documentElement.classList.add('bildr-editor')
    void editor.start()
  })
  onBeforeUnmount(() => {
    withdrawPlanShown()
    window.removeEventListener('keydown', onKeyDown)
    document.documentElement.classList.remove('bildr-editor')
    editor.dispose()
  })
  return editor
}
