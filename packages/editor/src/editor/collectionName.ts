import { ref } from 'vue'

/**
 * The Name field of the two dialogs that finish a collection from an API (Import from URL, a connection's New collection): the
 * name New collection took (`initial`) is the field's start and is kept, so testing or fetching does not propose another over
 * it; with none, a name is proposed from the path or URL until the user types one. `reset` starts over each time the dialog opens.
 */
export function useCollectionName(initial: () => string | undefined) {
  const name = ref('')
  const edited = ref(false)

  const reset = () => {
    name.value = initial() ?? ''
    edited.value = !!name.value
  }
  /** Proposes `value` unless a name was handed over or typed. */
  const propose = (value: string) => {
    if (!edited.value) name.value = value
  }
  /** The user typed in the field. */
  const touch = () => {
    edited.value = true
  }

  return { name, edited, reset, propose, touch }
}
