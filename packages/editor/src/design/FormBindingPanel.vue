<script setup lang="ts">
import { computed } from 'vue'
import type { ModelNode } from '@bildr/codegen/model'
import { FIELD, FIELD_RING } from '../editorUi.ts'
import { useDesign } from './store.ts'

/**
 * A Form's action and fields (P5, mapping §4): the action the submit runs (picked among the actions of
 * the page's module that take an entity; setting it makes the page use it, in the same edit) and the fields of its entity the form
 * edits, in the entity's order (`fields`: field ids). Switching the action clears the fields:
 * they belong to the entity it creates. It sits in the inspector's Behaviour section of a Form, in the kit's field look.
 */

const props = defineProps<{ node: ModelNode }>()
const design = useDesign()
const field = `${FIELD} ${FIELD_RING} w-full min-w-0 px-2 text-default`

const module = computed(() => {
  const current = design.model.value
  const page = design.page.value
  return current && page ? Object.values(current.modules).find(mod => mod.pages.some(entry => entry.id === page.id)) : undefined
})
const actions = computed(() => (module.value?.actions ?? []).filter(entry => !!entry.input.entity || entry.id === chosen.value))
const chosen = computed(() => typeof props.node.props?.action === 'string' ? props.node.props.action : '')
const entity = computed(() => {
  const id = actions.value.find(entry => entry.id === chosen.value)?.input.entity
  return module.value?.entities.find(entry => entry.id === id)
})
const editable = computed(() => (entity.value?.fields ?? []).filter(entry => !entry.readonly))
const selected = computed<string[]>(() => Array.isArray(props.node.props?.fields) ? props.node.props.fields.map(String) : [])

const pick = async (event: Event) => {
  const id = (event.target as HTMLSelectElement).value
  if (!design.page.value || !actions.value.some(entry => entry.id === id)) return
  // One edit: the module adds the page's use of the action with the prop, or refuses both.
  await design.setProps(props.node.id, { action: id, fields: [] })
}
const toggle = (id: string, on: boolean) => {
  const next = editable.value.map(entry => entry.id).filter(entry => entry === id ? on : selected.value.includes(entry))
  return design.setProps(props.node.id, { fields: next })
}
</script>

<template>
  <div
    class="flex flex-col gap-2"
    data-testid="form-binding"
  >
    <EditorRow
      label="Action"
      title="The action the submit runs"
    >
      <select
        data-testid="form-action"
        :class="field"
        aria-label="Action"
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
    </EditorRow>
    <EditorRow
      v-if="entity"
      label="Fields"
      title="The fields of the action's collection this form edits"
    >
      <div class="flex min-w-0 flex-1 flex-col gap-1 py-1.5">
        <label
          v-for="entry in editable"
          :key="entry.id"
          class="flex items-center gap-2 text-[12px] text-default"
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
    </EditorRow>
  </div>
</template>
