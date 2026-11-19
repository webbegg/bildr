<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { expressionText } from '../../shared/bindings.ts'
import type { ValueDraft, ValueModes } from '../../shared/nodeInteractions.ts'

/**
 * The value a step takes (B3, S2), two controls under one label: how it is given, and what it is. The ways are the ones the module
 * takes for the target (`valueModes`): a fixed value typed to fit (a toggle is On or Off, a number box for a number), the control's
 * value (a Checkbox's change), the opposite of the field's current value, or a name from the page. The names are the ones in scope
 * the target takes (`valueChoices`: a value that may be empty is left out where the target can't be empty). An expression the form
 * doesn't edit is shown as it is, and stays until another way is chosen. Edits go up as drafts and are written when the step is whole.
 */
const props = defineProps<{ modes: ValueModes, value: ValueDraft, label: string }>()
const emit = defineEmits<{ update: [value: ValueDraft] }>()

const WAYS = { fixed: 'A fixed value', event: 'The control\'s value', flip: 'The opposite of its current value', bind: 'A value from the page' } as const
type Way = keyof typeof WAYS | 'other'

const wayOf = (value: ValueDraft): Way | '' => value.kind === 'none' ? '' : value.kind === 'route' ? 'bind' : value.kind
const way = ref<Way | ''>(wayOf(props.value))
watch(() => props.value, (value) => {
  // A way chosen whose value is not given yet (a name to pick) stays chosen.
  if (value.kind !== 'none') way.value = wayOf(value)
})

const items = computed(() => [
  { label: WAYS.fixed, value: 'fixed' },
  ...(props.modes.event ? [{ label: WAYS.event, value: 'event' }] : []),
  ...(props.modes.flip ? [{ label: WAYS.flip, value: 'flip' }] : []),
  ...(props.modes.choices.length ? [{ label: WAYS.bind, value: 'bind' }] : []),
  ...(props.value.kind === 'other' ? [{ label: expressionText(props.value.value as Record<string, never>), value: 'other', disabled: true }] : [])
])

function pickWay(next: string) {
  way.value = next as Way
  if (next === 'fixed') emit('update', { kind: 'fixed', text: '' })
  else if (next === 'event') emit('update', { kind: 'event' })
  else if (next === 'flip') emit('update', { kind: 'flip' })
  else if (next === 'bind') emit('update', { kind: 'none' })
}

const fixedText = computed(() => (props.value.kind === 'fixed' ? props.value.text : ''))
const TOGGLE = [{ label: 'On', value: 'true' }, { label: 'Off', value: 'false' }]
const numeric = computed(() => props.modes.type === 'integer' || props.modes.type === 'number')
const PLACEHOLDERS: Record<string, string> = { date: '2026-01-31', datetime: '2026-01-31T09:30:00Z', uuid: '123e4567-e89b-12d3-a456-426614174000' }

const choices = computed(() => props.modes.choices.map(choice => ({ label: choice.label, value: `${choice.kind}:${choice.path}` })))
const chosen = computed(() => (props.value.kind === 'bind' ? `bind:${props.value.path}` : props.value.kind === 'route' ? `route:${props.value.name}` : undefined))
function pickChoice(key: string) {
  const at = key.indexOf(':')
  const path = key.slice(at + 1)
  emit('update', key.startsWith('route:') ? { kind: 'route', name: path } : { kind: 'bind', path })
}
</script>

<template>
  <div
    class="flex min-w-0 flex-1 flex-col gap-1.5"
    data-step-value
    :data-value-way="way || undefined"
  >
    <EditorSelect
      :model-value="way || undefined"
      :items="items"
      placeholder="Choose a value"
      :aria-label="`${label}: how it is given`"
      data-value-way-select
      @update:model-value="pickWay"
    />
    <template v-if="way === 'fixed'">
      <EditorSelect
        v-if="modes.type === 'boolean'"
        :model-value="fixedText || undefined"
        :items="TOGGLE"
        placeholder="Choose On or Off"
        :aria-label="`${label}: value`"
        data-value-fixed
        @update:model-value="emit('update', { kind: 'fixed', text: $event })"
      />
      <EditorInput
        v-else
        :model-value="fixedText"
        :type="numeric ? 'number' : 'text'"
        :placeholder="PLACEHOLDERS[modes.type]"
        commit="change"
        :aria-label="`${label}: value`"
        data-value-fixed
        @commit="emit('update', { kind: 'fixed', text: $event })"
      />
    </template>
    <EditorSelect
      v-else-if="way === 'bind'"
      :model-value="chosen"
      :items="choices"
      placeholder="Choose a value"
      mono
      :aria-label="`${label}: the value`"
      data-value-bind
      @update:model-value="pickChoice"
    />
  </div>
</template>
