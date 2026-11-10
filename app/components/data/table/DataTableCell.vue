<script setup lang="ts">
import type { RecordValue } from '#shared/data/records'
import { cellInput } from '#shared/data/table'
import type { CellMove } from '#shared/data/table'
import type { Field } from '#shared/document/schema'

/** One records-table cell: the value, or its inline editor. A toggle commits on click. */
const props = defineProps<{ field: Field, value: RecordValue, editing: boolean, readOnly: boolean, initial?: string }>()
const emit = defineEmits<{ commit: [raw: string | boolean, move?: CellMove], cancel: [] }>()

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

const empty = computed(() => props.value === null || props.value === '')
const text = computed(() => {
  if (empty.value) return ''
  if (props.field.type === 'date') {
    const time = Date.parse(String(props.value).length === 10 ? `${props.value}T00:00:00Z` : String(props.value))
    return Number.isNaN(time) ? String(props.value) : DATE.format(time)
  }
  return String(props.value)
})

const input = useTemplateRef<HTMLInputElement>('input')
const draft = ref('')
let done = false

watch(() => props.editing, async (editing) => {
  if (!editing) return
  done = false
  draft.value = props.initial ?? cellInput(props.field.type, props.value)
  await nextTick()
  input.value?.focus()
  if (props.initial === undefined) input.value?.select()
}, { immediate: true })

function finish(move?: CellMove) {
  if (done) return
  done = true
  emit('commit', draft.value, move)
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    finish()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    done = true
    emit('cancel')
  } else if (event.key === 'Tab') {
    event.preventDefault()
    finish(event.shiftKey ? 'prev' : 'next')
  }
  event.stopPropagation()
}
</script>

<template>
  <button
    v-if="field.type === 'boolean'"
    type="button"
    role="switch"
    :aria-checked="value === true"
    :aria-label="field.label"
    :disabled="readOnly"
    class="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors disabled:cursor-default"
    :class="value === true ? 'bg-primary' : 'bg-white/14'"
    tabindex="-1"
    data-cell-toggle
    @click.stop="emit('commit', value !== true)"
  >
    <span
      class="size-3 rounded-full bg-white shadow transition-transform"
      :class="value === true ? 'translate-x-3.5' : 'translate-x-0.5'"
    />
  </button>
  <input
    v-else-if="editing"
    ref="input"
    v-model="draft"
    :type="field.type === 'date' ? 'date' : 'text'"
    :inputmode="field.type === 'number' ? 'decimal' : undefined"
    :placeholder="field.type === 'image' ? 'https://… or /image.png' : undefined"
    size="1"
    class="h-full w-full min-w-0 bg-transparent text-sm text-highlighted outline-none [color-scheme:dark] placeholder:text-dimmed"
    data-cell-input
    @keydown="onKey"
    @blur="finish()"
  >
  <img
    v-else-if="field.type === 'image' && !empty"
    :src="text"
    :alt="field.label"
    :title="text"
    class="block h-6 w-10 rounded-md border border-white/10 bg-white/4 object-cover"
    data-cell-image
  >
  <span
    v-else
    class="block truncate"
    :class="[empty ? 'text-dimmed' : 'text-default', { 'tabular-nums': field.type === 'number' }]"
  >{{ empty ? '' : text }}</span>
</template>
