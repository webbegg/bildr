<script setup lang="ts">
import { filterOps } from '#shared/data/table'
import type { FilterOp, TableFilter } from '#shared/data/table'
import type { Field } from '#shared/document/schema'

/** The toolbar's filter button: pick a field, a condition and a value, then add it as a chip. */
const props = defineProps<{ fields: Field[] }>()
const emit = defineEmits<{ add: [filter: TableFilter] }>()

const OP_NAMES: Record<FilterOp, string> = { contains: 'contains', eq: 'equals', gt: 'is greater than', lt: 'is less than', on: 'is on', off: 'is off', before: 'is before', after: 'is after' }

const open = ref(false)
const key = ref('')
const op = ref<FilterOp>('contains')
const value = ref('')

const usable = computed(() => props.fields.filter(f => filterOps(f.type).length))
const field = computed(() => usable.value.find(f => f.key === key.value))
const ops = computed(() => field.value ? filterOps(field.value.type) : [])
const needsValue = computed(() => op.value !== 'on' && op.value !== 'off')
const ready = computed(() => !!field.value && (!needsValue.value || value.value.trim() !== ''))
const fieldItems = computed(() => usable.value.map(f => ({ label: f.label, value: f.key })))
const opItems = computed(() => ops.value.map(each => ({ label: OP_NAMES[each], value: each })))

watch(open, (isOpen) => {
  if (!isOpen) return
  if (!field.value) key.value = usable.value[0]?.key ?? ''
  value.value = ''
})

watch(ops, (list) => {
  if (!list.includes(op.value)) op.value = list[0] ?? 'contains'
}, { immediate: true })

function add() {
  if (!ready.value) return
  emit('add', needsValue.value ? { key: key.value, op: op.value, value: value.value.trim() } : { key: key.value, op: op.value })
  open.value = false
}
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ side: 'bottom', align: 'start', sideOffset: 6 }"
  >
    <UTooltip text="Filter">
      <EditorButton
        icon="i-lucide-list-filter"
        variant="ghost"
        aria-label="Filter"
        :disabled="!usable.length"
        data-records-filter
      />
    </UTooltip>
    <template #content>
      <form
        class="flex w-60 flex-col gap-2 p-3 text-[12px]"
        data-filter-form
        @submit.prevent="add"
      >
        <EditorSelect
          v-model="key"
          :items="fieldItems"
          aria-label="Filter field"
          data-filter-field
        />
        <EditorSelect
          :model-value="op"
          :items="opItems"
          aria-label="Filter condition"
          data-filter-op
          @update:model-value="op = $event as FilterOp"
        />
        <EditorInput
          v-if="needsValue"
          v-model="value"
          :type="field?.type === 'date' ? 'date' : 'text'"
          :inputmode="field?.type === 'number' ? 'decimal' : undefined"
          placeholder="Value"
          aria-label="Filter value"
          :ui="{ base: '[color-scheme:dark]' }"
          data-filter-value
        />
        <EditorButton
          type="submit"
          variant="primary"
          label="Add filter"
          block
          :disabled="!ready"
          data-filter-add
        />
      </form>
    </template>
  </UPopover>
</template>
