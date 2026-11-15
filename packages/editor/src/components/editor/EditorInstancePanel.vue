<script setup lang="ts">
import { computed } from 'vue'
import type { ModelNode, PropertyDef, Value } from '@bildr/codegen/model'
import { FIELD, FIELD_RING } from '../../editorUi.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { isExpression } from '../../shared/bindings.ts'

/**
 * INTERIM (U5 replaces it with the hosted `EditorComponentPanel`): what the inspector shows of an
 * Instance, over the kit. Its component's variant (not the states: hover and pressed follow the
 * pointer) and one field per property, set per instance (`instance_set_values`: an entity
 * property binds a record in scope, a text or number is typed, an expression shows as it is),
 * each slot's "Own content" switch (`instance_set_slot`, with the other selected nodes moved in),
 * Detach and Replace with. The values a required property needs are asked for when the
 * instance is inserted (RequiredValuesDialog).
 */
const props = defineProps<{ node: ModelNode }>()
const editor = useEditor()

const component = computed(() => editor.components.find(entry => entry.id === props.node.props?.component))
const values = computed(() => isExpression(props.node.props?.values) ? props.node.props.values as Record<string, Value> : {})
const SIMPLE_KINDS = ['text', 'textarea', 'image', 'link', 'icon', 'number', 'boolean', 'select']
const properties = computed(() => (component.value?.properties ?? []).filter(property => SIMPLE_KINDS.includes(property.kind) || property.kind === 'entity'))
/** The records an entity property can take: the names in scope of its entity (one record, or a list for `many`). */
const records = (property: PropertyDef) => editor.scopeOf(props.node.id).filter(entry => entry.entity === property.entity && entry.many === (property.many === true)).map(entry => entry.name)
const boundName = (id: string) => isExpression(values.value[id]) && typeof (values.value[id] as Record<string, Value>).$bind === 'string' ? (values.value[id] as Record<string, string>).$bind! : ''
const setValue = (id: string, entry: Value | null) => editor.runOnPage('instance_set_values', { nodeId: props.node.id, values: { [id]: entry } })
const setVariant = (event: Event) => editor.runOnPage('instance_set_values', { nodeId: props.node.id, variant: (event.target as HTMLSelectElement).value })
const variants = computed(() => (component.value?.variants ?? []).filter(variant => !variant.state))
const slots = computed(() => (component.value?.properties ?? []).filter(property => property.kind === 'slot'))
const filled = (slot: string) => !!props.node.children?.some(child => child.type === 'SlotFill' && child.props?.slot === slot)
const setSlot = (slot: string, on: boolean) => editor.runOnPage('instance_set_slot', { nodeId: props.node.id, slot, filled: on })
/** The other selected nodes (siblings in the same file) go into the slot as its content. */
const moveIn = (slot: string) => editor.runOnPage('instance_set_slot', { nodeId: props.node.id, slot, filled: true, nodeIds: editor.selectedIds.filter(id => id !== props.node.id) })
const replacements = computed(() => editor.components.filter(entry => entry.id !== props.node.props?.component && entry.id !== editor.page?.id))
const replace = async (event: Event) => {
  const select = event.target as HTMLSelectElement
  const id = select.value
  select.value = ''
  if (id) await editor.replaceInstance(props.node.id, id)
}
const select = `${FIELD} ${FIELD_RING} w-full min-w-0 px-2 text-default`
</script>

<template>
  <EditorStyleSection
    v-if="component"
    label="Component"
    data-instance-panel
  >
    <EditorRow label="Component">
      <span class="truncate text-[12px] text-toned">{{ component.name }}</span>
    </EditorRow>
    <EditorRow
      v-if="variants.length"
      label="Variant"
      :provenance="typeof node.props?.variant === 'string' && node.props.variant ? { state: 'set', key: 'variant', value: node.props.variant } : undefined"
    >
      <select
        data-testid="instance-variant"
        :class="select"
        aria-label="Variant"
        :value="typeof node.props?.variant === 'string' ? node.props.variant : ''"
        @change="setVariant"
      >
        <option value="">
          Primary
        </option>
        <option
          v-for="variant in variants"
          :key="variant.id"
          :value="variant.id"
        >
          {{ variant.name }}
        </option>
      </select>
    </EditorRow>
    <EditorRow
      v-for="property in properties"
      :key="property.id"
      :label="property.label ?? property.name"
      :title="property.description"
      :provenance="values[property.id] !== undefined ? { state: 'set', key: property.id, value: String(property.kind === 'entity' ? boundName(property.id) : values[property.id]) } : undefined"
      @reset="setValue(property.id, null)"
    >
      <select
        v-if="property.kind === 'entity'"
        :data-testid="`value-${property.name}`"
        :class="select"
        :aria-label="property.label ?? property.name"
        :value="boundName(property.id)"
        @change="setValue(property.id, ($event.target as HTMLSelectElement).value ? { $bind: ($event.target as HTMLSelectElement).value } : null)"
      >
        <option value="">
          None
        </option>
        <option
          v-if="boundName(property.id) && !records(property).includes(boundName(property.id))"
          :value="boundName(property.id)"
        >
          {{ boundName(property.id) }}
        </option>
        <option
          v-for="name in records(property)"
          :key="name"
          :value="name"
        >
          {{ name }}
        </option>
      </select>
      <code
        v-else-if="isExpression(values[property.id])"
        class="min-w-0 truncate rounded-sm bg-elevated px-1 py-0.5 text-[11px] text-default"
      >{{ JSON.stringify(values[property.id]) }}</code>
      <input
        v-else-if="property.kind === 'boolean'"
        type="checkbox"
        :data-testid="`value-${property.name}`"
        class="size-4"
        :aria-label="property.label ?? property.name"
        :checked="values[property.id] === true"
        @change="setValue(property.id, ($event.target as HTMLInputElement).checked)"
      >
      <select
        v-else-if="property.kind === 'select'"
        :data-testid="`value-${property.name}`"
        :class="select"
        :aria-label="property.label ?? property.name"
        :value="String(values[property.id] ?? '')"
        @change="setValue(property.id, ($event.target as HTMLSelectElement).value || null)"
      >
        <option value="">
          Default
        </option>
        <option
          v-for="option in property.options"
          :key="option"
          :value="option"
        >
          {{ option }}
        </option>
      </select>
      <EditorCommitInput
        v-else
        :data-testid="`value-${property.name}`"
        :model-value="String(values[property.id] ?? '')"
        :numeric="property.kind === 'number'"
        :placeholder="property.default === undefined ? '' : String(property.default)"
        :aria-label="property.label ?? property.name"
        size="xs"
        variant="soft"
        @commit="setValue(property.id, $event === '' ? null : property.kind === 'number' ? Number($event) : $event)"
      />
    </EditorRow>
    <EditorRow
      v-for="slot in slots"
      :key="slot.id"
      :label="slot.label ?? slot.name"
      title="Fill the slot with this instance's own content"
    >
      <div class="flex h-[30px] items-center gap-2">
        <input
          type="checkbox"
          :data-testid="`instance-slot-${slot.id}`"
          class="size-4"
          :aria-label="`${slot.label ?? slot.name}: own content`"
          :checked="filled(slot.id)"
          @change="setSlot(slot.id, ($event.target as HTMLInputElement).checked)"
        >
        <span class="text-[11px] text-dimmed">Own content</span>
        <button
          v-if="editor.selectedIds.length > 1"
          type="button"
          :data-testid="`instance-slot-fill-${slot.id}`"
          class="text-[11px] text-(--editor-selection)"
          @click="moveIn(slot.id)"
        >
          Move selection in
        </button>
      </div>
    </EditorRow>
    <div class="flex items-center gap-2 pt-1">
      <EditorButton
        data-testid="instance-detach"
        label="Detach"
        icon="i-lucide-unlink"
        variant="soft"
        size="xs"
        @click="editor.detachInstance(node.id)"
      />
      <select
        data-testid="instance-replace"
        :class="select"
        aria-label="Replace with"
        @change="replace"
      >
        <option value="">
          Replace with…
        </option>
        <option
          v-for="entry in replacements"
          :key="entry.id"
          :value="entry.id"
        >
          {{ entry.name }}
        </option>
      </select>
    </div>
  </EditorStyleSection>
</template>
