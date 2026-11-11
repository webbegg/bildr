<script setup lang="ts">
import type { PropValue } from '#shared/document/components'
import type { LayoutSlot, PropertyDef } from '#shared/document/schema'
import { layoutItems, layoutValue, NO_LAYOUT, pageSlots, variableField } from '~/composables/layoutEditor'

/**
 * The page settings' layout rows: the Layout the page renders in (None, or
 * one of the project's, each a two-line item naming its slots and variables,
 * with Edit to open it in the layout view), a field
 * per layout variable, set per page (blue when set; reset goes back to the
 * default), and per named slot an "Own content" switch: on, the page gives
 * the slot its own content; off, the layout's default shows.
 */
const editor = useEditor()

const page = computed(() => editor.currentPage)
const layout = computed(() => editor.project?.layouts.find(l => l.id === page.value?.layoutId) ?? null)
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
/** A layout choice's second line: what a page can set in it (its named slots, the children slot aside, and its variables). */
function layoutHint(value: string): string {
  if (value === NO_LAYOUT) return 'The page renders on its own'
  const option = editor.project?.layouts.find(l => l.id === value)
  if (!option) return ''
  const slots = Math.max(0, option.slots.length - 1)
  const variables = option.variables.length
  return slots || variables ? [slots && count(slots, 'slot'), variables && count(variables, 'variable')].filter(Boolean).join(', ') : 'No slots or variables'
}
const items = computed(() => (editor.project ? layoutItems(editor.project).map(item => ({ ...item, description: layoutHint(item.value) })) : []))
const fields = computed(() => (layout.value ? layout.value.variables.map(variable => ({ variable, field: variableField(layout.value!, variable) })) : []))
const slots = computed(() => (layout.value && page.value ? pageSlots(layout.value, page.value) : []))

async function setLayout(value: string) {
  const current = page.value
  if (!current || value === (layout.value?.id ?? NO_LAYOUT)) return
  const loses = !!Object.keys(current.layoutValues ?? {}).length || slots.value.some(s => s.filled)
  if (loses && !await editor.confirm({
    title: 'Change the layout?',
    description: `${current.name} drops its layout values and its own slot content. Undo brings them back.`,
    items: slots.value.filter(s => s.filled).map(s => `${s.slot.name}: own content`),
    confirmLabel: 'Change layout'
  })) return
  editor.run('page_set_layout', { pageId: current.id, layoutId: value === NO_LAYOUT ? null : value })
}

function setValue(variable: PropertyDef, value: PropValue | null) {
  if (page.value) editor.run('page_set_layout_values', { pageId: page.value.id, values: { [variable.id]: value } })
}

function setSlot(slot: LayoutSlot, filled: boolean) {
  if (page.value) editor.run('page_set_slot', { pageId: page.value.id, slot: slot.id, filled })
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
