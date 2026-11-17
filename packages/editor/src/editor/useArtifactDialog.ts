import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { ARTIFACT_KINDS } from '../shared/dataArtifacts.ts'
import type { ArtifactKind } from '../shared/dataArtifacts.ts'
import type { DataArtifact } from '../shared/dataModel.ts'
import { attempt } from './dataArtifactActions.ts'
import { useEditor } from './useEditor.ts'

/**
 * What the three dialogs of the Queries and Actions sections (create, rename, delete: S10) share, with the shell
 * `components/data/DataArtifactDialog.vue` that draws them: what was asked for (a kind, or an item of a kind) and is kept
 * while the dialog closes, so it keeps its words, whether it is open, the error and the saving state of the action it runs, and
 * the item looked up in the tree's lists.
 */

/** A query or an action of the tree. */
export interface ArtifactTarget {
  kind: ArtifactKind
  id: string
}

const kindOf = (asked: ArtifactKind | ArtifactTarget): ArtifactKind => typeof asked === 'string' ? asked : asked.kind

/**
 * `asked` is what the dialog was asked for (null: closed), `close` tells the parent to drop it. `opened` runs each time something
 * is asked for, after what is shown and the error are reset, so a dialog starts its fields over.
 */
export function useArtifactDialog<T extends ArtifactKind | ArtifactTarget>(asked: () => T | null, close: () => void, opened?: (next: T) => void) {
  const editor = useEditor()
  /** What was asked for last, so the dialog keeps its words while it closes. */
  const shown = ref(asked()) as Ref<T | null>
  const error = ref('')
  const saving = ref(false)

  const open = computed({
    get: () => asked() !== null,
    set: (value) => {
      if (!value) close()
    }
  })
  const words = computed(() => ARTIFACT_KINDS[shown.value ? kindOf(shown.value) : 'query'])
  /** The item of the tree the dialog is about, when it is about one and the model still has it. */
  const item: ComputedRef<DataArtifact | undefined> = computed(() => {
    const target = shown.value
    return target && typeof target !== 'string' ? (target.kind === 'query' ? editor.queries : editor.actions).find(entry => entry.id === target.id) : undefined
  })

  watch(asked, (next) => {
    if (!next) return
    shown.value = next
    error.value = ''
    opened?.(next)
  }, { immediate: true })

  /** Runs a module action of the dialog: its result when the module took it, else the refusal is shown here and nothing is returned. */
  async function submit<R extends Record<string, unknown>>(name: string, input: Record<string, unknown>, fallback: string): Promise<R | undefined> {
    if (saving.value) return undefined
    saving.value = true
    const done = await attempt<R>(editor, name, input, fallback)
    saving.value = false
    if ('error' in done) {
      error.value = done.error
      return undefined
    }
    return done.result
  }

  return { shown, open, words, item, error, saving, submit }
}
