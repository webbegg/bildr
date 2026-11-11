<script setup lang="ts">
import { INTERACTION_DELAY_MAX, INTERACTION_EVENTS } from '#shared/document/schema'
import type { InteractionEvent } from '#shared/document/schema'
import { EVENT_LABELS, findInteraction, interactionTargets } from '#shared/editor/interactionPanel'

/**
 * The Interaction popover's body (Framer's): the event that triggers it
 * (Click, Mouse enter, Mouse leave, Appear), the variant it goes to, and the
 * delay in seconds, each change one undo step, plus Remove. It edits
 * interaction `interactionId` of the component being edited. Delete or
 * Backspace anywhere in its popover but a field removes it too.
 */
const { interactionId } = defineProps<{ interactionId: string }>()
const emit = defineEmits<{ removed: [] }>()
const editor = useEditor()

const NONE = '__none'
const found = computed(() => (editor.component ? findInteraction(editor.component, interactionId) : undefined))
const events = INTERACTION_EVENTS.map(on => ({ value: on, label: EVENT_LABELS[on] }))
// The select's items cannot be empty: the primary ('') goes as NONE.
const targets = computed(() => (editor.component && found.value ? interactionTargets(editor.component, found.value.owner).map(t => ({ value: t.id || NONE, label: t.label })) : []))

// A number field may hand over a number despite EditorInput's string type.
function setDelay(input: string | number) {
  const text = String(input)
  const value = Number(text)
  if (!text.trim() || value === 0) return void editor.updateInteraction(interactionId, { delay: null })
  if (Number.isFinite(value)) void editor.updateInteraction(interactionId, { delay: Math.min(Math.max(value, 0), INTERACTION_DELAY_MAX) })
}

async function remove() {
  await editor.removeInteraction(interactionId)
  emit('removed')
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if ((event.key === 'Delete' || event.key === 'Backspace') && !target?.closest('input, textarea, [role="combobox"]')) {
    event.preventDefault()
    void remove()
  }
}

// The popover focuses its close button first, so the whole popover listens.
const root = useTemplateRef<HTMLElement>('root')
let layer: Element | null = null
onMounted(() => {
  layer = root.value?.closest('[role="dialog"]') ?? root.value ?? null
  layer?.addEventListener('keydown', onKeydown as EventListener)
})
onBeforeUnmount(() => layer?.removeEventListener('keydown', onKeydown as EventListener))
</script>

<template>
  <div
    v-if="found"
    ref="root"
    class="space-y-2"
    data-interaction-fields
  >
    <EditorRow label="On">
      <EditorSelect
        class="flex-1"
        :model-value="found.interaction.on"
        :items="events"
        aria-label="Trigger"
        data-interaction-on
        @update:model-value="editor.updateInteraction(interactionId, { on: $event as InteractionEvent })"
      />
    </EditorRow>
    <EditorRow label="To">
      <EditorSelect
        class="flex-1"
        :model-value="found.interaction.to || NONE"
        :items="targets"
        aria-label="Target variant"
        data-interaction-to
        @update:model-value="editor.updateInteraction(interactionId, { to: $event === NONE ? '' : $event })"
      />
    </EditorRow>
    <EditorRow label="Delay">
      <EditorInput
        class="flex-1"
        type="number"
        commit="change"
        :model-value="found.interaction.delay ?? 0"
        :ui="{ trailing: 'pe-2.5 text-[12px] text-dimmed' }"
        aria-label="Delay in seconds"
        data-interaction-delay
        @commit="setDelay"
      >
        <template #trailing>
          s
        </template>
      </EditorInput>
    </EditorRow>
    <div class="flex justify-end pt-1">
      <EditorButton
        label="Remove"
        icon="i-lucide-trash-2"
        size="xs"
        variant="danger"
        data-interaction-remove
        @click="remove"
      />
    </div>
  </div>
</template>
