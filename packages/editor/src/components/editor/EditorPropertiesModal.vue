<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import type { PropertyDef, Value } from '@bildr/codegen/model'
import { FOCUS_RING } from '../../editorUi.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { bindingLabel, propertyField } from '../../shared/componentEditor.ts'
import { variableField } from '../../shared/layoutEditor.ts'
import { formatOptions, parseOptions } from '../../shared/optionList.ts'
import type { DetailField } from '../../shared/propertyLabels.ts'
import { detailPatch, propertiesTitle, propertyLabel, takesPlaceholder } from '../../shared/propertyLabels.ts'

/**
 * Framer's "<Component> variables" modal, here "<Component> properties" or
 * "<Layout> variables" (`editor.propertiesRequest`): the list on the left
 * (drag a row to reorder), the selected one's details on the right: its
 * name, a human type label (read-only, with what it is bound to), a
 * description, the default value (a field of its kind), Optional (whether
 * instances or pages may leave it empty) and, for text kinds, a placeholder.
 * Delete asks first. It opens from the Properties (or Variables) section's
 * gear, a bound field's chip, and right after the binding dot creates a
 * property, with the name field focused. Each edit is one action, one undo
 * step.
 *
 * The module's own (S4): a select's options, and an entity property's entity
 * and whether it is a list of records, which the hosted properties lack.
 */
const editor = useEditor()
const selectedId = ref<string | null>(null)
const dragging = ref<string | null>(null)
const dropIndex = ref<number | null>(null)
const nameField = useTemplateRef<{ select: () => void }>('nameField')

const request = computed(() => editor.propertiesRequest)
const owner = computed(() => {
  const r = request.value
  if (!r) return null
  if (r.kind === 'component') {
    const def = editor.components.find(entry => entry.id === r.id)
    return def ? { kind: 'component' as const, id: def.id, name: def.name, root: def.root, list: def.properties, noun: 'property' } : null
  }
  const layout = editor.layouts.find(entry => entry.id === r.id)
  return layout ? { kind: 'layout' as const, id: layout.id, name: layout.name, root: layout.root, list: layout.variables ?? [], noun: 'variable' } : null
})
const open = computed({
  get: () => !!owner.value,
  set: (value) => {
    if (!value) editor.propertiesRequest = null
  }
})
const title = computed(() => (owner.value ? propertiesTitle(owner.value.kind, owner.value.name) : ''))
const selected = computed(() => owner.value?.list.find(property => property.id === selectedId.value) ?? owner.value?.list[0] ?? null)
const entities = computed(() => Object.values(editor.model?.modules ?? {}).flatMap(entry => entry.entities).map(entry => ({ label: entry.name, value: entry.id })))

// A request the owner no longer has (left the view, deleted) closes the modal.
watch(() => !!request.value && !owner.value, (gone) => {
  if (gone) editor.propertiesRequest = null
})

watch(request, async (value) => {
  if (!value) return
  selectedId.value = value.propertyId
  if (!value.focusName) return
  await nextTick()
  // After the modal has moved the focus into itself.
  requestAnimationFrame(() => nameField.value?.select())
}, { immediate: true })

/** The Default row: a field of the property's kind, labelled Default; it shows the stored default, else the bound node's own value. Null for a slot, a record or a field. */
const defaultField = computed(() => {
  const o = owner.value
  const p = selected.value
  if (!o || !p) return null
  const field = o.kind === 'component' ? propertyField({ name: o.name, root: o.root }, p) : variableField({ name: o.name, root: o.root }, p)
  return field ? { ...field, label: 'Default', description: `What ${o.kind === 'component' ? 'instances' : 'pages'} get when they set none` } : null
})

function update(property: PropertyDef, patch: Record<string, unknown>) {
  const o = owner.value
  if (!o) return
  if (o.kind === 'component') void editor.run('component_property_update', { component: o.id, property: property.id, ...patch })
  else void editor.run('layout_variable_update', { layout: o.id, variable: property.id, ...patch })
}

function rename(property: PropertyDef, name: string) {
  const next = name.trim()
  if (next && next !== property.name) update(property, { name: next })
}

function setDetail(property: PropertyDef, field: DetailField, value: string | boolean) {
  const patch = detailPatch(field, value)
  const current = property[field] ?? null
  if (patch[field] !== current) update(property, patch)
}

function setDefault(property: PropertyDef, value: Value | null) {
  update(property, { default: value })
}

/** A select's options, typed as a comma list (a quoted one may hold a comma); none removes them. */
function setOptions(property: PropertyDef, raw: string) {
  const list = parseOptions(raw)
  update(property, { options: list.length ? list : null })
}

async function remove(property: PropertyDef) {
  const o = owner.value
  if (!o) return
  const ok = await editor.confirm({
    title: `Delete "${property.name}"?`,
    description: o.kind === 'component'
      ? `Instances lose their value${property.kind === 'slot' ? ' and their own content' : ''} for it. Undo brings it back.`
      : 'Pages lose their value for it. Undo brings it back.',
    confirmLabel: `Delete ${o.noun}`,
    danger: true
  })
  if (!ok || !owner.value) return
  if (o.kind === 'component') await editor.run('component_property_remove', { component: o.id, property: property.id })
  else await editor.run('layout_variable_remove', { layout: o.id, variable: property.id })
}

function onDragStart(event: DragEvent, property: PropertyDef) {
  dragging.value = property.id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', property.id)
  }
}

function onDragOver(event: DragEvent, index: number) {
  if (!dragging.value) return
  event.preventDefault()
  dropIndex.value = index
}

function onDrop(index: number) {
  const o = owner.value
  const property = o?.list.find(entry => entry.id === dragging.value)
  dragging.value = null
  dropIndex.value = null
  if (property && o!.list.indexOf(property) !== index) update(property, { index })
}

function onDragEnd() {
  dragging.value = null
  dropIndex.value = null
}
</script>

<template>
  <EditorModal
    v-model:open="open"
    :title="title"
    width="lg"
  >
    <div
      v-if="owner"
      class="grid min-h-72 grid-cols-[180px_minmax(0,1fr)] gap-4"
      data-properties-modal
      :data-properties-kind="owner.kind"
    >
      <ul
        class="flex flex-col gap-0.5 border-e border-default pe-3"
        role="listbox"
        :aria-label="title"
      >
        <li
          v-for="(property, index) in owner.list"
          :key="property.id"
          role="option"
          :aria-selected="selected?.id === property.id"
          draggable="true"
          class="rounded-lg"
          :class="dropIndex === index && dragging !== property.id ? 'ring-1 ring-(--editor-context)' : ''"
          :data-property-row="property.id"
          @dragstart="onDragStart($event, property)"
          @dragover="onDragOver($event, index)"
          @drop.prevent="onDrop(index)"
          @dragend="onDragEnd"
        >
          <button
            type="button"
            class="flex h-8 w-full min-w-0 cursor-grab items-center gap-2 rounded-lg px-2 text-start text-[12px] active:cursor-grabbing"
            :class="[FOCUS_RING, selected?.id === property.id ? 'bg-white/8 font-[550] text-highlighted' : 'text-toned hover:bg-white/4']"
            @click="selectedId = property.id"
          >
            <UIcon
              name="i-lucide-grip-vertical"
              class="size-3.5 shrink-0 text-dimmed"
            />
            <span class="min-w-0 flex-1 truncate">{{ property.name }}</span>
            <span class="shrink-0 text-[11px] text-dimmed">{{ propertyLabel(property) }}</span>
          </button>
        </li>
        <li
          v-if="!owner.list.length"
          class="px-2 py-1 text-[12px] text-dimmed"
        >
          No {{ owner.kind === 'component' ? 'properties' : 'variables' }} yet. Use a field's binding dot, or + in the panel.
        </li>
      </ul>

      <div
        v-if="selected"
        :key="selected.id"
        class="space-y-3"
        :data-property-details="selected.id"
      >
        <EditorFormRow label="Name">
          <EditorInput
            ref="nameField"
            :model-value="selected.name"
            commit="change"
            :maxlength="100"
            autocomplete="off"
            :aria-label="`${owner.noun === 'property' ? 'Property' : 'Variable'} name`"
            data-property-name
            @commit="rename(selected, $event)"
          />
        </EditorFormRow>
        <EditorFormRow label="Type">
          <span
            class="min-w-0 truncate text-[12px] text-toned"
            data-property-type
          >{{ propertyLabel(selected) }}</span>
          <span class="min-w-0 truncate text-[11px] text-dimmed">{{ selected.kind === 'slot' && selected.nodeId ? bindingLabel(owner.root, { nodeId: selected.nodeId, prop: 'children' }) : bindingLabel(owner.root, selected.bindings?.[0]) }}</span>
        </EditorFormRow>
        <EditorFormRow label="Description">
          <EditorTextarea
            :model-value="selected.description ?? ''"
            commit="change"
            :rows="2"
            placeholder="What it is for, shown as a tooltip"
            aria-label="Description"
            data-property-description
            @commit="setDetail(selected, 'description', $event)"
          />
        </EditorFormRow>
        <EditorFormRow
          v-if="selected.kind === 'select'"
          label="Options"
          help="Separated by commas. Put an option with a comma in quotes"
        >
          <EditorInput
            :model-value="formatOptions(selected.options ?? [])"
            commit="change"
            placeholder="small, medium, large"
            aria-label="Options"
            data-property-options
            @commit="setOptions(selected, $event)"
          />
        </EditorFormRow>
        <EditorFormRow
          v-if="selected.kind === 'entity' || selected.kind === 'field'"
          label="Entity"
        >
          <EditorSelect
            :model-value="selected.entity"
            :items="entities"
            placeholder="Choose an entity"
            aria-label="Entity"
            data-property-entity
            @update:model-value="update(selected, { entity: $event })"
          />
        </EditorFormRow>
        <EditorFormRow
          v-if="selected.kind === 'entity'"
          label="List"
          help="Instances bind a list of records, not one"
        >
          <EditorSwitch
            :model-value="selected.many === true"
            aria-label="List of records"
            data-property-many
            @update:model-value="update(selected, { many: $event ? true : null })"
          />
        </EditorFormRow>
        <!-- The label turns blue once a default is stored; its menu resets it (the bound node's own value shows again). -->
        <EditorPropField
          v-if="defaultField"
          :def="defaultField"
          :value="selected.default ?? defaultField.default"
          :changed="selected.default !== undefined"
          class="grid-cols-[120px_minmax(0,1fr)]! gap-x-3!"
          data-property-default
          @update="setDefault(selected, $event)"
          @reset="setDefault(selected, null)"
        />
        <EditorFormRow
          v-else
          label="Default"
        >
          <span class="text-[12px] text-dimmed">{{ selected.kind === 'slot' ? 'The slot\'s own children, until an instance fills it.' : 'An instance binds a record in scope; there is no default.' }}</span>
        </EditorFormRow>
        <EditorFormRow
          v-if="selected.kind !== 'slot'"
          label="Optional"
          :help="owner.kind === 'component' ? 'Instances may leave it empty' : 'Pages may leave it empty'"
        >
          <EditorSwitch
            :model-value="selected.optional === true"
            aria-label="Optional"
            data-property-optional
            @update:model-value="setDetail(selected, 'optional', $event)"
          />
        </EditorFormRow>
        <EditorFormRow
          v-if="takesPlaceholder(selected.kind)"
          label="Placeholder"
        >
          <EditorInput
            :model-value="selected.placeholder ?? ''"
            commit="change"
            :maxlength="200"
            placeholder="Shown while the field is empty"
            aria-label="Placeholder"
            data-property-placeholder
            @commit="setDetail(selected, 'placeholder', $event)"
          />
        </EditorFormRow>
      </div>
    </div>
    <template #footer>
      <EditorButton
        v-if="selected && owner"
        :label="`Delete ${owner.noun}…`"
        icon="i-lucide-trash-2"
        variant="danger"
        class="me-auto"
        data-property-delete
        @click="remove(selected)"
      />
      <EditorButton
        label="Done"
        variant="primary"
        data-properties-done
        @click="open = false"
      />
    </template>
  </EditorModal>
</template>
