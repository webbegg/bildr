<script setup lang="ts">
import { computed } from 'vue'
import type { LayoutFile, PropertyDef, Value } from '@bildr/codegen/model'
import { useEditor } from '../../editor/useEditor.ts'
import EditorPropField from './EditorPropField.vue'
import { layoutChoiceHint, layoutItems, layoutValue, NO_LAYOUT, pageSlots, variableField } from '../../shared/layoutEditor.ts'

/**
 * The page settings' layout rows: the Layout the page renders in (None, or
 * one of the project's, each a two-line item counting the pages using it and
 * naming its slots and variables, with Edit to open it in the layout view), a field
 * per layout variable, set per page (blue when set; reset goes back to the
 * default), and per named slot an "Own content" switch: on, the page gives
 * the slot its own content; off, the layout's default shows. The variable rows are
 * `EditorPropField` (U4).
 */
const editor = useEditor()

const page = computed(() => editor.currentPage)
const layout = computed(() => editor.layouts.find(l => l.id === page.value?.layout) ?? null)
/** A layout choice's second line (see `layoutChoiceHint`). */
function layoutHint(value: string, pages = 0): string {
  if (value === NO_LAYOUT) return 'The page renders on its own'
  const option = editor.layouts.find(l => l.id === value)
  return option ? layoutChoiceHint(option, pages) : ''
}
const items = computed(() => (editor.model ? layoutItems(editor.model).map(({ pages, ...item }) => ({ ...item, description: layoutHint(item.value, pages) })) : []))
const fields = computed(() => (layout.value ? (layout.value.variables ?? []).map(variable => ({ variable, field: variableField(layout.value!, variable) })) : []))
const slots = computed(() => (layout.value && page.value ? pageSlots(layout.value, page.value) : []))

function setLayout(value: string) {
  void editor.setPageLayout(value === NO_LAYOUT ? null : value)
}

function setValue(variable: PropertyDef, value: Value | null) {
  if (page.value) editor.run('page_set_layout_values', { page: page.value.id, values: { [variable.id]: value } })
}

function setSlot(slot: LayoutFile['slots'][number], filled: boolean) {
  if (page.value) editor.run('page_set_slot', { page: page.value.id, slot: slot.id, filled })
}
</script>

<template>
  <template v-if="page">
    <EditorRow
      label="Layout"
      data-page-layout
    >
      <div class="flex w-full min-w-0 items-center gap-1">
        <div class="min-w-0 flex-1">
          <EditorSelect
            :model-value="layout?.id ?? NO_LAYOUT"
            :items="items"
            aria-label="Page layout"
            @update:model-value="setLayout"
          />
        </div>
        <EditorButton
          v-if="layout"
          icon="i-lucide-pencil-ruler"
          variant="soft"
          :aria-label="`Edit layout ${layout.name}`"
          @click="editor.editLayout(layout.id)"
        />
      </div>
    </EditorRow>
    <EditorPropField
      v-for="{ variable, field } in fields"
      :key="variable.id"
      :def="field"
      :value="layoutValue(page, variable) ?? field.default"
      :changed="layoutValue(page, variable) !== undefined"
      @update="setValue(variable, $event)"
      @reset="setValue(variable, null)"
    />
    <EditorRow
      v-for="{ slot, filled } in slots"
      :key="slot.id"
      :label="slot.name"
      :title="`${slot.name}: on, this page has its own content; off, it shows the layout's`"
    >
      <div class="flex h-[30px] items-center gap-2">
        <EditorSwitch
          :model-value="filled"
          :aria-label="`${slot.name}: own content`"
          @update:model-value="setSlot(slot, $event)"
        />
        <span class="text-[11px] text-dimmed">Own content</span>
      </div>
    </EditorRow>
  </template>
</template>
