<script setup lang="ts">
import { computed } from 'vue'
import type { ModelNode } from '@bildr/codegen/model'
import { useDesign } from './store.ts'

/**
 * A Form's action and fields (P5, mapping §4): the action the submit runs (picked among the page's
 * module's actions; the page starts using it as it picks) and the fields of its entity the form
 * edits, in the entity's order (`fields`: field ids). Switching the action clears the fields:
 * they belong to the entity it creates.
 */

const props = defineProps<{ node: ModelNode }>()
const design = useDesign()
const field = 'w-full rounded-md border border-default bg-default px-2 py-1 text-sm'

const module = computed(() => {
  const current = design.model.value
  const page = design.page.value
  return current && page ? Object.values(current.modules).find(mod => mod.pages.some(entry => entry.id === page.id)) : undefined
})
const actions = computed(() => module.value?.actions ?? [])
const chosen = computed(() => typeof props.node.props?.action === 'string' ? props.node.props.action : '')
const entity = computed(() => {
  const id = actions.value.find(entry => entry.id === chosen.value)?.input.entity
  return module.value?.entities.find(entry => entry.id === id)
})
const editable = computed(() => (entity.value?.fields ?? []).filter(entry => !entry.readonly))
const selected = computed<string[]>(() => Array.isArray(props.node.props?.fields) ? props.node.props.fields.map(String) : [])

const pick = async (event: Event) => {
  const id = (event.target as HTMLSelectElement).value
  const page = design.page.value
  const action = actions.value.find(entry => entry.id === id)
  if (!page || !action) return
  if (!page.uses?.actions?.some(use => use.action === id)) {
    const taken = [...(page.uses?.queries ?? []), ...(page.uses?.actions ?? []), ...(page.uses?.state ?? []), ...(page.uses?.computed ?? [])].map(use => use.as)
    let as = action.name
    for (let n = 2; taken.includes(as); n++) as = `${action.name}${n}`
    const added = await design.edit('page_use_add', { page: page.id, as, action: id })
    if (!added) return
  }
  await design.setProps(props.node.id, { action: id, fields: [] })
}
const toggle = (id: string, on: boolean) => {
  const next = editable.value.map(entry => entry.id).filter(entry => entry === id ? on : selected.value.includes(entry))
  return design.setProps(props.node.id, { fields: next })
}
</script>

<template>
  <div
    class="flex flex-col gap-2 border-t border-default pt-2"
    data-testid="form-binding"
  >
    <label class="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs text-muted">
      Action
      <select
        data-testid="form-action"
        :class="field"
        :value="chosen"
        @change="pick"
      >
        <option value="">
          None
        </option>
        <option
          v-for="action in actions"
          :key="action.id"
          :value="action.id"
        >
          {{ action.label }}
        </option>
      </select>
    </label>
    <div
      v-if="entity"
      class="grid grid-cols-[6.5rem_1fr] gap-2 text-xs text-muted"
    >
      Fields
      <div class="flex flex-col gap-1">
        <label
          v-for="entry in editable"
          :key="entry.id"
          class="flex items-center gap-2 text-default"
        >
          <input
            type="checkbox"
            :data-testid="`form-field-${entry.id}`"
            class="size-4"
            :checked="selected.includes(entry.id)"
            @change="toggle(entry.id, ($event.target as HTMLInputElement).checked)"
          >
          {{ entry.name }}
        </label>
      </div>
    </div>
  </div>
</template>
