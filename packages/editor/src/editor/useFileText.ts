import { computed, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import type { Json } from '../types.ts'

/**
 * The text a model file's editor shows (S3), and the rules that tie it to the file:
 * - it is the file's text (JSON, or the file as it is on disk when that is not valid JSON), and follows the file when the
 *   file changes elsewhere (an edit, a regeneration) as long as it has not been typed on;
 * - once it has been typed on (`dirty`), an outside change is never applied over the edits: it is `external`, the new
 *   version, until the user takes it (`loadNew`) or keeps the edits (`keepMine`);
 * - what was saved is the file's text (`saved`): the module's own form of it comes back when the files are read again,
 *   and is taken like any other change to a file that has not been typed on;
 * - `base` is the file the edits started from (its JSON, its text when it is not valid JSON, null when there is no file),
 *   which `model_file_put` takes to refuse a write over a file that has changed since.
 */

export interface FileTextSource {
  /** The file shown; empty when none is. */
  path: Ref<string>
  /** Every file as `model_get` returns it, path → parsed JSON. Read inside a getter so that it is tracked. */
  files: () => Record<string, Json>
  /** The files that are not valid JSON, path → their text. */
  invalid?: () => Record<string, string>
}

export type FileBase = Json | string | null

export function useFileText(source: FileTextSource) {
  const has = <T>(map: Record<string, T> | undefined, path: string): map is Record<string, T> => map !== undefined && Object.hasOwn(map, path)
  const textOf = (path: string): string | undefined => {
    const raw = source.invalid?.()
    if (has(raw, path)) return raw[path]
    const files = source.files()
    return has(files, path) ? JSON.stringify(files[path], null, 2) : undefined
  }
  const baseOf = (path: string): FileBase => {
    const raw = source.invalid?.()
    if (has(raw, path)) return raw[path]!
    const files = source.files()
    return has(files, path) ? files[path]! : null
  }
  const current = () => textOf(source.path.value)

  /** The text the file last gave: the editor's text is untouched by the file while it is still this. */
  const loaded = ref(current() ?? '')
  const content = ref(loaded.value)
  const base = shallowRef<FileBase>(baseOf(source.path.value))
  /** The file's new text when it changed elsewhere while the text was typed on, else null. */
  const external = ref<string | null>(null)

  const dirty = computed(() => content.value !== loaded.value)
  /** The file on disk is not valid JSON: its text is shown as it is. */
  const unreadable = computed(() => has(source.invalid?.(), source.path.value))

  const take = (text: string) => {
    content.value = text
    loaded.value = text
    base.value = baseOf(source.path.value)
    external.value = null
  }

  watch(source.path, (path) => {
    take(textOf(path) ?? '')
  })

  watch(current, (text) => {
    if (text === undefined) return
    if (text === loaded.value) {
      external.value = null
      return
    }
    // Not typed on, or typed to be what the file now is: the text is the file's.
    if (!dirty.value || content.value === text) take(text)
    else external.value = text
  })

  return {
    content,
    dirty,
    external,
    unreadable,
    base,
    /** The edits are saved: the text is the file's, until the module's form of it is read back. */
    saved: () => {
      loaded.value = content.value
      external.value = null
    },
    /** Takes the file's new version over the edits. */
    loadNew: () => {
      if (external.value !== null) take(external.value)
    },
    /** Keeps the edits: the file's new version is what they are made from now. */
    keepMine: () => {
      if (external.value === null) return
      loaded.value = external.value
      base.value = baseOf(source.path.value)
      external.value = null
    },
    /** Drops the edits (the file was deleted, or the editor is done with them). */
    discard: () => {
      content.value = loaded.value
      external.value = null
    }
  }
}
