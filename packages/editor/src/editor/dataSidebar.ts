import { ref } from 'vue'
import type { Ref } from 'vue'
import { useEditor } from './useEditor.ts'

export type DataSidebarTab = 'collections' | 'fields'

const tabs = new WeakMap<object, Ref<DataSidebarTab>>()

/** The Data sidebar's tab, one per editor (Collections at first), so the right panel can switch it to Fields. */
export function useDataSidebarTab(): Ref<DataSidebarTab> {
  const editor = useEditor()
  let tab = tabs.get(editor)
  if (!tab) tabs.set(editor, tab = ref<DataSidebarTab>('collections'))
  return tab
}

/** The last Import from API request each editor's sidebar answered, so a request made before it mounts (⌘K from the Canvas) still opens the dialog. */
export const answeredImports = new WeakMap<object, number>()
