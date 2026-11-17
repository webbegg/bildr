import { ref } from 'vue'
import type { Ref } from 'vue'
import type { DraftStep } from './stepDraft.ts'

/**
 * Dragging a step by its grip (the Steps tab): which step is dragged (`dragKey`, by its key, which stays with the step as the
 * list is reordered) and where it would land (`dropSlot`: the insertion slot, 0 to the step count, in the current order). The up
 * and down buttons are the keyboard's way; this is the pointer's. `move` is told the place the step is at and the place it has
 * in the list that results.
 */
export function useStepDrag(steps: () => readonly DraftStep[], move: (from: number, to: number) => void) {
  const dragKey = ref<number | null>(null)
  const dropSlot: Ref<number | null> = ref(null)

  function start(event: DragEvent, key: number) {
    dragKey.value = key
    if (!event.dataTransfer) return
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(key))
    const card = (event.currentTarget as HTMLElement).closest('[data-step-card]')
    if (card) event.dataTransfer.setDragImage(card, 12, 18)
  }

  function over(event: DragEvent, index: number) {
    if (dragKey.value === null) return
    event.preventDefault()
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    dropSlot.value = event.clientY < box.top + box.height / 2 ? index : index + 1
  }

  function end() {
    dragKey.value = null
    dropSlot.value = null
  }

  function drop() {
    const key = dragKey.value
    const slot = dropSlot.value
    end()
    if (key === null || slot === null) return
    const from = steps().findIndex(entry => entry.key === key)
    if (from >= 0) move(from, slot > from ? slot - 1 : slot)
  }

  return { dragKey, dropSlot, start, over, drop, end }
}
