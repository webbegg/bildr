import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import { plainCopy } from './draftJson.ts'
import { useEditor } from './useEditor.ts'

/**
 * What the Data workspace's draft forms share (S10: the query Definition, D10b, and the action Steps, D10c): a form holds an
 * item (a query, an action) as a draft until Save, and keeps the draft's *base*: the item as it was when the draft was opened
 * or last saved. What the user touched is judged against the base, not against the item as stored now, so a part that changed
 * outside the form (another editor, a rename, an undo, a JSON-tab save) and was not touched is never sent back from the form's
 * stale copy.
 *
 * - `dirty`: the draft has edits, and `stale`: it has edits while the stored item differs from its base in a part the form
 *   holds. Save waits for the user's choice, the form's `DataStaleNotice`: `discard` ("Load the new version") or `keepMine`.
 * - `dataDirty`: while the draft has edits, the workspace asks before it moves away (`editor.dataDirty` is the item's name).
 * - The draft follows the model: another item replaces it, and so does a change of the model while nothing was edited.
 *
 * The form's own part is what to compare and how to rebase (`options`), and its Save.
 */
export interface DraftFormOptions<Stored, Draft> {
  /** The item as the model has it now (read in a getter, so the form follows the model). */
  stored: () => Stored
  /** What tells the form which item it shows: another id is another form. */
  id: () => string
  /** The name the workspace asks about when it would move away from unsaved edits. */
  label: () => string
  /** The draft of an item. */
  open: (stored: Stored) => Draft
  /** Whether the draft has edits, judged against its base. */
  dirty: (draft: Draft, base: Stored) => boolean
  /** Whether `stored` differs from `base` in a part the draft holds. */
  changedOutside: (base: Stored, stored: Stored) => boolean
  /** The draft that keeps the user's edits over a changed item: the part they did not touch shows the stored one's. */
  rebase: (draft: Draft, base: Stored, stored: Stored) => Draft
  /** Whether the draft says what its base says, so a change of the model can replace it. Default: it has no edits. */
  untouched?: (draft: Draft, base: Stored) => boolean
  /** The form's part of replacing the draft: `switched` is another item, not a discard. */
  reset?: (before: Draft, after: Draft, switched: boolean) => void
}

export function useDraftForm<Stored, Draft>(options: DraftFormOptions<Stored, Draft>) {
  const editor = useEditor()
  const draft = ref(options.open(options.stored())) as Ref<Draft>
  /** The item the draft started from. Replaced as a whole, never edited. */
  const base = shallowRef<Stored>(plainCopy(options.stored()))
  const error = ref('')
  const saving = ref(false)

  const dirty = computed(() => options.dirty(draft.value, base.value))
  /** The item changed outside the form while it has edits (not while a save of this form is refreshing the model). */
  const stale = computed(() => dirty.value && !saving.value && options.changedOutside(base.value, options.stored()))

  watch([dirty, options.label], ([unsaved, label]) => {
    editor.dataDirty = unsaved ? label : null
  }, { flush: 'sync', immediate: true })
  onBeforeUnmount(() => {
    editor.dataDirty = null
  })

  function load(switched: boolean) {
    const before = draft.value
    base.value = plainCopy(options.stored())
    draft.value = options.open(options.stored())
    error.value = ''
    options.reset?.(before, draft.value, switched)
  }
  /** Gives up the edits: the form shows the item as it is saved, which is its base now. Also "Load the new version". */
  const discard = () => load(false)

  /** "Keep my edits": the stored item is the base now, and the form keeps only what the user touched over it. */
  function keepMine() {
    draft.value = plainCopy(options.rebase(draft.value, base.value, options.stored()))
    base.value = plainCopy(options.stored())
    error.value = ''
  }

  // Another item, or the model changed under a form with nothing edited in it: the form shows it. Edits that are not saved stay.
  watch(options.id, () => load(true))
  watch(() => JSON.stringify(options.stored()), () => {
    if (options.untouched ? options.untouched(draft.value, base.value) : !dirty.value) discard()
  })
  watch(draft, () => {
    error.value = ''
  }, { deep: true })

  return { draft, base, error, saving, dirty, stale, discard, keepMine }
}
