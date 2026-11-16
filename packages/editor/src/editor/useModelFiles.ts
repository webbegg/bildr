import { nextTick, onMounted, ref, watch } from 'vue'
import { callAction, errorMessage } from '../api.ts'
import type { Json, ModelGetResult } from '../types.ts'
import { useEditor } from './useEditor.ts'

/**
 * The `.bildr/` model files as `model_get` returns them (path → parsed JSON, and `invalid`: the text of the files that
 * are not valid JSON), for the Data workspace's JSON tab and All model files (S3). Read when it mounts and again whenever
 * the editor's model changes (an edit elsewhere, a file changed on disk, a regeneration), from `load` to try again after
 * a failure, and from `refresh` after a write. The files come back whether or not the model loads, which is what lets a
 * broken file be fixed.
 */
export function useModelFiles() {
  const editor = useEditor()
  const files = ref<Record<string, Json>>({})
  const invalid = ref<Record<string, string>>({})
  /** Whether the files have been read once. */
  const loaded = ref(false)
  const error = ref<string | null>(null)
  let latest = 0
  let refreshing = false

  const load = async () => {
    const mine = ++latest
    try {
      const result = await callAction<ModelGetResult>('model_get')
      if (mine !== latest) return
      files.value = result.files ?? {}
      invalid.value = result.invalid ?? {}
      error.value = null
      loaded.value = true
    } catch (caught) {
      if (mine === latest) error.value = errorMessage(caught)
    }
  }

  /**
   * After a write: the editor's model and the files, each read once. The editor's model changing is what makes `load` run
   * (below); it does not run again for the read made here.
   */
  const refresh = async () => {
    refreshing = true
    try {
      await Promise.all([load(), editor.reload()])
      await nextTick()
    } finally {
      refreshing = false
    }
  }

  onMounted(load)
  watch([() => editor.model, () => editor.problems], () => {
    if (!refreshing) void load()
  })
  return { files, invalid, loaded, error, load, refresh }
}
