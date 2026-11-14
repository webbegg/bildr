<script setup lang="ts">
import { computed } from 'vue'
import type { PageFile, PropertyDef, Value } from '@bildr/codegen/model'
import CommitInput from './CommitInput.vue'
import PageUsesPanel from './PageUsesPanel.vue'
import { useDesign } from './store.ts'

/**
 * What the inspector shows of the page being edited: the layout it renders in
 * (`page_set_layout`), the values it gives the layout's variables (a control
 * typed by each variable's kind, `page_set_layout_values`) and its own content
 * for the layout's named slots (`page_set_slot`: a slot is filled or shows the
 * layout's default content).
 */

const props = defineProps<{ page: PageFile }>()
const design = useDesign()

const layout = computed(() => design.layouts.value.find(entry => entry.id === props.page.layout))
const variables = computed(() => layout.value?.variables ?? [])
const slots = computed(() => (layout.value?.slots ?? []).filter(slot => slot.id !== 'children'))
const filled = (slot: string) => !!props.page.root.children?.some(child => child.type === 'SlotFill' && child.props?.slot === slot)

const setLayout = (event: Event) => design.edit('page_set_layout', { page: props.page.id, layout: (event.target as HTMLSelectElement).value || null })
const setValue = (variable: PropertyDef, value: Value | null) => design.edit('page_set_layout_values', { page: props.page.id, values: { [variable.id]: value } })
const shown = (variable: PropertyDef) => {
  const value = props.page.layoutValues?.[variable.id]
  return value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
}
const commitText = (variable: PropertyDef, raw: string) => setValue(variable, raw === '' ? null : variable.kind === 'number' ? Number(raw) : raw)
const setSlot = (slot: string, on: boolean) => design.edit('page_set_slot', { page: props.page.id, slot, filled: on })
const moveIn = (slot: string) => design.edit('page_set_slot', { page: props.page.id, slot, filled: true, nodeIds: [...design.selectedIds.value] })
const field = 'w-full rounded-md border border-default bg-default px-2 py-1 text-sm'
</script>

<template>
  <div
    class="flex flex-col gap-3 p-3"
    data-testid="page-panel"
  >
    <label class="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs text-muted">
      Layout
      <select
        data-testid="layout-picker"
        :class="field"
        :value="page.layout ?? ''"
        @change="setLayout"
      >
        <option value="">
          None
        </option>
        <option
          v-for="entry in design.layouts.value"
          :key="entry.id"
          :value="entry.id"
        >
          {{ entry.name }}
        </option>
      </select>
    </label>

    <template v-if="layout && variables.length">
      <h3 class="text-xs font-semibold">
        Layout values
      </h3>
      <label
        v-for="variable in variables"
        :key="variable.id"
        class="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs text-muted"
        :title="variable.description"
      >
        {{ variable.label ?? variable.name }}
        <input
          v-if="variable.kind === 'boolean'"
          type="checkbox"
          :data-testid="`layout-value-${variable.id}`"
          class="size-4 justify-self-start"
          :checked="(page.layoutValues?.[variable.id] ?? variable.default) === true"
          @change="setValue(variable, ($event.target as HTMLInputElement).checked)"
        >
        <select
          v-else-if="variable.kind === 'select'"
          :data-testid="`layout-value-${variable.id}`"
          :class="field"
          :value="shown(variable)"
          @change="setValue(variable, ($event.target as HTMLSelectElement).value || null)"
        >
          <option value="">
            Default
          </option>
          <option
            v-for="option in variable.options ?? []"
            :key="option"
            :value="option"
          >
            {{ option }}
          </option>
        </select>
        <CommitInput
          v-else
          :data-testid="`layout-value-${variable.id}`"
          :model-value="shown(variable)"
          :multiline="variable.kind === 'textarea'"
          :numeric="variable.kind === 'number'"
          :placeholder="variable.default === undefined ? '' : String(variable.default)"
          @commit="commitText(variable, $event)"
        />
      </label>
    </template>

    <PageUsesPanel :page="page" />

    <template v-if="layout && slots.length">
      <h3 class="text-xs font-semibold">
        Slot content
      </h3>
      <div
        v-for="slot in slots"
        :key="slot.id"
        class="flex items-center gap-2 text-xs text-muted"
      >
        <label class="flex flex-1 items-center gap-2">
          <input
            type="checkbox"
            :data-testid="`slot-fill-${slot.id}`"
            class="size-4"
            :checked="filled(slot.id)"
            @change="setSlot(slot.id, ($event.target as HTMLInputElement).checked)"
          >
          {{ slot.name }}
        </label>
        <button
          v-if="design.selectedIds.value.length"
          type="button"
          :data-testid="`slot-fill-move-${slot.id}`"
          class="text-primary"
          @click="moveIn(slot.id)"
        >
          Move selection in
        </button>
      </div>
    </template>
  </div>
</template>
