import { onMounted, ref, watch } from 'vue'
import { callAction, errorMessage } from '../api.ts'
import type { Json, ModelGetResult } from '../types.ts'
import { useEditor } from './useEditor.ts'

/**
 * The `.bildr/` model files as `model_get` returns them (path → parsed JSON), for the Data workspace's JSON tab and
 * All model files (S3). Read when it mounts and again whenever the editor's model changes (a save here, an edit
 * elsewhere, a file changed on disk), and from `load` after a write. The files come back whether or not the model
 * loads, which is what lets a broken file be fixed.
 */
export function useModelFiles() {
  const editor = useEditor()
  const files = ref<Record<string, Json>>({})
  /** Whether the files have been read once. */
  const loaded = ref(false)
  const error = ref<string | null>(null)
  let latest = 0

  const load = async () => {
    const mine = ++latest
    try {
      const result = await callAction<ModelGetResult>('model_get')
      if (mine !== latest) return
      files.value = result.files ?? {}
      error.value = null
      loaded.value = true
    } catch (caught) {
      if (mine === latest) error.value = errorMessage(caught)
    }
  }

  onMounted(load)
  watch([() => editor.model, () => editor.problems], load)
  return { files, loaded, error, load }
}
