<script setup lang="ts">
import type { RecordValue } from '#shared/data/records'
import { parseCell } from '#shared/data/table'
import type { Field } from '#shared/document/schema'

/** Framer's quick-add row: fill any cell and press Return to add the record, then keep typing in a fresh row. */
const props = defineProps<{ fields: Field[], create: (values: Record<string, RecordValue>) => Promise<boolean> }>()
const emit = defineEmits<{ leave: [col: number] }>()

const drafts = ref<Record<string, string | boolean>>({})
const busy = ref(false)
const cells = useTemplateRef<HTMLElement[]>('cells')

function focus(col: number) {
  const cell = cells.value?.find(el => el.dataset.col === String(col))
  cell?.querySelector<HTMLElement>('input, button')?.focus()
}

async function submit(col: number) {
  const values: Record<string, RecordValue> = {}
  for (const field of props.fields) {
    const draft = drafts.value[field.key]
    const value = draft === undefined ? undefined : parseCell(field.type, draft)
    if (value !== undefined) values[field.key] = value
  }
  if (busy.value || !Object.keys(values).length) return
  busy.value = true
  const created = await props.create(values)
  busy.value = false
  if (!created) return
  drafts.value = {}
  await nextTick()
  focus(col)
}

function onKey(event: KeyboardEvent, col: number) {
  if (event.key === 'Enter') {
    event.preventDefault()
    void submit(col)
  } else if (event.key === 'ArrowUp' || event.key === 'Escape') {
    event.preventDefault()
    emit('leave', col)
  }
  event.stopPropagation()
}

defineExpose({ focus })
</script>

<template>
  <tr
    class="h-11"
    data-add-row
  >
    <td class="w-10 border-b border-white/5" />
    <td
      v-for="(field, col) in fields"
      ref="cells"
      :key="field.key"
      :data-col="col"
      class="border-b border-l border-white/5 px-4"
    >
      <button
        v-if="field.type === 'boolean'"
        type="button"
        role="switch"
        :aria-checked="drafts[field.key] === true"
        :aria-label="`New item ${field.label}`"
        class="relative inline-flex h-4 w-7 items-center rounded-full transition-colors"
        :class="drafts[field.key] === true ? 'bg-primary' : 'bg-white/8'"
        @click="drafts[field.key] = drafts[field.key] !== true"
        @keydown="onKey($event, col)"
      >
        <span
          class="size-3 rounded-full bg-white/70 transition-transform"
          :class="drafts[field.key] === true ? 'translate-x-3.5' : 'translate-x-0.5'"
        />
      </button>
      <input
        v-else
        :value="drafts[field.key] ?? ''"
        :type="field.type === 'date' ? 'date' : 'text'"
        :inputmode="field.type === 'number' ? 'decimal' : undefined"
        :placeholder="col === 0 ? 'New item…' : undefined"
        :aria-label="`New item ${field.label}`"
        :readonly="busy"
        size="1"
        class="h-full w-full min-w-0 bg-transparent text-sm outline-none [color-scheme:dark] placeholder:text-dimmed"
        :class="field.type === 'date' && !drafts[field.key] ? 'text-dimmed' : 'text-highlighted'"
        data-add-input
        @input="drafts[field.key] = ($event.target as HTMLInputElement).value"
        @keydown="onKey($event, col)"
      >
    </td>
    <td class="w-11 border-b border-white/5" />
  </tr>
</template>
