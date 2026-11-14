<script setup lang="ts">
import { computed } from 'vue'
import type { ModelNode, PropertyDef, Value } from '@bildr/codegen/model'
import { bindingPaths } from '@bildr/codegen/edit'
import BindPicker from './BindPicker.vue'
import CommitInput from './CommitInput.vue'
import FormBindingPanel from './FormBindingPanel.vue'
import ListSourcePanel from './ListSourcePanel.vue'
import { BINDABLE, PROP_SPECS, VISIBLE_SPEC } from './propSpecs.ts'
import type { PropSpec } from './propSpecs.ts'
import { useDesign } from './store.ts'

/**
 * The props of the selected node (`node_update_props`): a control per prop its
 * type takes; a prop bound to data (`{ $bind }`, `$template`…) shows read-only
 * with a button to unbind it. An Instance shows its component's variant and
 * property values (`instance_set_values`).
 */

const props = defineProps<{ node: ModelNode }>()
const design = useDesign()

const isExpression = (value: unknown): value is Record<string, Value> => typeof value === 'object' && value !== null && !Array.isArray(value)
const specs = computed<PropSpec[]>(() => [...(PROP_SPECS[props.node.type] ?? []), ...(props.node.type === 'Instance' || props.node.type === 'SlotFill' ? [] : [VISIBLE_SPEC])])
const value = (key: string) => props.node.props?.[key]

const bound = (spec: PropSpec) => isExpression(value(spec.key)) && !(spec.control === 'page')
const describeBound = (key: string) => {
  const expression = value(key) as Record<string, Value>
  return typeof expression.$bind === 'string' ? `{${expression.$bind}}` : typeof expression.$template === 'string' ? expression.$template : JSON.stringify(expression)
}
/** Bound props of the node no control covers (a List's `items`, a Form's `action`). */
const others = computed(() => Object.entries(props.node.props ?? {}).filter(([key, entry]) => isExpression(entry) && !specs.value.some(spec => spec.key === key) && !['values', 'component'].includes(key)
  // A List's items and a Form's action have their own controls on a page.
  && !(design.fileKind.value === 'page' && ((props.node.type === 'List' && key === 'items') || (props.node.type === 'Form' && key === 'action')))).map(([key]) => key))

const save = (patch: Record<string, Value | null>) => design.setProps(props.node.id, patch)

// ── Binding (P5) ───────────────────────────────────────────────────────

/** The names this node can read as a value: a record's fields, a list's length, a lone value (a prop, `layout.x`, `site.name`). */
const paths = computed(() => bindingPaths(design.scopeOf(props.node.id), { leaves: true }))
const canBind = (spec: PropSpec) => (BINDABLE[props.node.type] ?? []).includes(spec.key) && paths.value.length > 0
/** Binds a prop to a name: alone when the prop is empty, else added to its text as a template. */
const bindTo = (key: string, path: string) => {
  const current = value(key)
  save({ [key]: typeof current === 'string' && current !== '' ? { $template: `${current} {${path}}` } : { $bind: path } })
}
const text = (key: string) => {
  const entry = value(key)
  return typeof entry === 'string' ? entry : typeof entry === 'number' ? String(entry) : ''
}
const commitText = (key: string, entry: string) => save({ [key]: entry === '' ? null : entry })
const commitNumber = (key: string, entry: string) => save({ [key]: entry.trim() === '' ? null : Number(entry) })
const commitSelect = (spec: PropSpec, event: Event) => {
  const entry = (event.target as HTMLSelectElement).value
  save({ [spec.key]: entry === '' ? null : spec.numeric ? Number(entry) : entry })
}
const checked = (spec: PropSpec) => typeof value(spec.key) === 'boolean' ? value(spec.key) === true : spec.fallback === true
const commitSwitch = (spec: PropSpec, event: Event) => {
  const on = (event.target as HTMLInputElement).checked
  // The default needs no prop: removing it keeps the file small.
  save({ [spec.key]: on === (spec.fallback === true) ? null : on })
}
const pageOf = () => (isExpression(value('to')) && typeof (value('to') as Record<string, Value>).page === 'string' ? String((value('to') as Record<string, Value>).page) : '')
const pages = computed(() => design.files.value.filter(file => file.kind === 'page'))
const commitPage = (event: Event) => {
  const id = (event.target as HTMLSelectElement).value
  save(id ? { to: { page: id }, href: null } : { to: null })
}

// ── Instance ──────────────────────────────────────────────────────────

const component = computed(() => props.node.type === 'Instance' ? design.components.value.find(entry => entry.id === props.node.props?.component) : undefined)
const values = computed(() => isExpression(props.node.props?.values) ? props.node.props.values as Record<string, Value> : {})
const SIMPLE_KINDS = ['text', 'textarea', 'image', 'link', 'icon', 'number', 'boolean', 'select']
const properties = computed(() => (component.value?.properties ?? []).filter(property => SIMPLE_KINDS.includes(property.kind) || property.kind === 'entity'))
/** The records an entity property can take: the names in scope of its entity (one record, or a list for `many`). */
const records = (property: PropertyDef) => design.scopeOf(props.node.id).filter(entry => entry.entity === property.entity && entry.many === (property.many === true)).map(entry => entry.name)
const boundName = (id: string) => isExpression(values.value[id]) && typeof (values.value[id] as Record<string, Value>).$bind === 'string' ? (values.value[id] as Record<string, string>).$bind! : ''
const setValue = (id: string, entry: Value | null) => design.edit('instance_set_values', { file: design.fileId.value!, nodeId: props.node.id, values: { [id]: entry } })
const setVariant = (event: Event) => design.edit('instance_set_values', { file: design.fileId.value!, nodeId: props.node.id, variant: (event.target as HTMLSelectElement).value })
/** What an instance can be set to: the variants, not the states (hover and pressed follow the pointer). */
const variants = computed(() => (component.value?.variants ?? []).filter(variant => !variant.state))
const slots = computed(() => (component.value?.properties ?? []).filter(property => property.kind === 'slot'))
const filled = (slot: string) => !!props.node.children?.some(child => child.type === 'SlotFill' && child.props?.slot === slot)
const setSlot = (slot: string, on: boolean) => design.edit('instance_set_slot', { file: design.fileId.value!, nodeId: props.node.id, slot, filled: on })
/** The other selected nodes (siblings in the same file) go into the slot as its content. */
const moveIn = (slot: string) => design.edit('instance_set_slot', { file: design.fileId.value!, nodeId: props.node.id, slot, filled: true, nodeIds: design.selectedIds.value.filter(id => id !== props.node.id) })
const detach = () => design.edit('instance_detach', { file: design.fileId.value!, nodeId: props.node.id })
const replacements = computed(() => design.components.value.filter(entry => entry.id !== props.node.props?.component && entry.id !== design.fileId.value))
const replace = async (event: Event) => {
  const select = event.target as HTMLSelectElement
  const id = select.value
  select.value = ''
  if (id) await design.edit('instance_replace', { file: design.fileId.value!, nodeId: props.node.id, component: id })
}
const field = 'w-full rounded-md border border-default bg-default px-2 py-1 text-sm'
</script>

<template>
  <div
    class="flex flex-col gap-2 p-3"
    data-testid="props-panel"
  >
    <label
      v-for="spec in specs"
      :key="spec.key"
      class="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs text-muted"
    >
      {{ spec.label }}
      <span
        v-if="bound(spec)"
        :data-testid="`prop-${spec.key}-bound`"
        class="flex items-center gap-1"
      >
        <code class="min-w-0 flex-1 truncate rounded-sm bg-elevated px-1 py-0.5 text-default">{{ describeBound(spec.key) }}</code>
        <button
          type="button"
          class="text-muted hover:text-default"
          aria-label="Unbind"
          @click.prevent="save({ [spec.key]: null })"
        ><UIcon
          name="i-lucide-x"
          class="size-3"
        /></button>
      </span>
      <span
        v-else-if="spec.control === 'text' || spec.control === 'textarea'"
        class="flex items-start gap-1"
      >
        <CommitInput
          :data-testid="`prop-${spec.key}`"
          :model-value="text(spec.key)"
          :multiline="spec.control === 'textarea'"
          @commit="commitText(spec.key, $event)"
        />
        <BindPicker
          v-if="canBind(spec)"
          :data-testid="`bind-${spec.key}`"
          :paths="paths"
          @pick="bindTo(spec.key, $event)"
        />
      </span>
      <CommitInput
        v-else-if="spec.control === 'number'"
        :data-testid="`prop-${spec.key}`"
        :model-value="text(spec.key)"
        numeric
        @commit="commitNumber(spec.key, $event)"
      />
      <select
        v-else-if="spec.control === 'select'"
        :data-testid="`prop-${spec.key}`"
        :class="field"
        :value="text(spec.key)"
        @change="commitSelect(spec, $event)"
      >
        <option value="">
          Default
        </option>
        <option
          v-for="option in spec.options"
          :key="option"
          :value="option"
        >
          {{ option }}
        </option>
      </select>
      <input
        v-else-if="spec.control === 'switch'"
        type="checkbox"
        :data-testid="`prop-${spec.key}`"
        class="size-4 justify-self-start"
        :checked="checked(spec)"
        @change="commitSwitch(spec, $event)"
      >
      <select
        v-else
        :data-testid="`prop-${spec.key}`"
        :class="field"
        :value="pageOf()"
        @change="commitPage"
      >
        <option value="">
          None
        </option>
        <option
          v-for="page in pages"
          :key="page.id"
          :value="page.id"
        >
          {{ page.name }}
        </option>
      </select>
    </label>

    <div
      v-for="key in others"
      :key="key"
      class="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs text-muted"
      :data-testid="`prop-${key}-bound`"
    >
      {{ key }}
      <code class="min-w-0 truncate rounded-sm bg-elevated px-1 py-0.5 text-default">{{ describeBound(key) }}</code>
    </div>

    <ListSourcePanel
      v-if="node.type === 'List' && design.fileKind.value === 'page'"
      :node="node"
    />
    <FormBindingPanel
      v-if="node.type === 'Form' && design.fileKind.value === 'page'"
      :node="node"
    />

    <template v-if="component">
      <div class="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs text-muted">
        Component
        <span class="truncate text-default">{{ component.name }}</span>
      </div>
      <label
        v-if="variants.length"
        class="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs text-muted"
      >
        Variant
        <select
          data-testid="instance-variant"
          :class="field"
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
      </label>
      <label
        v-for="property in properties"
        :key="property.id"
        class="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs text-muted"
      >
        {{ property.label ?? property.name }}
        <select
          v-if="property.kind === 'entity'"
          :data-testid="`value-${property.name}`"
          :class="field"
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
        <span
          v-else-if="isExpression(values[property.id])"
          class="truncate"
        ><code class="rounded-sm bg-elevated px-1 py-0.5 text-default">{{ JSON.stringify(values[property.id]) }}</code></span>
        <input
          v-else-if="property.kind === 'boolean'"
          type="checkbox"
          :data-testid="`value-${property.name}`"
          class="size-4 justify-self-start"
          :checked="values[property.id] === true"
          @change="setValue(property.id, ($event.target as HTMLInputElement).checked)"
        >
        <select
          v-else-if="property.kind === 'select'"
          :data-testid="`value-${property.name}`"
          :class="field"
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
        <CommitInput
          v-else
          :data-testid="`value-${property.name}`"
          :model-value="String(values[property.id] ?? '')"
          :numeric="property.kind === 'number'"
          :placeholder="property.default === undefined ? '' : String(property.default)"
          @commit="setValue(property.id, $event === '' ? null : property.kind === 'number' ? Number($event) : $event)"
        />
      </label>
      <div
        v-for="slot in slots"
        :key="slot.id"
        class="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs text-muted"
      >
        {{ slot.label ?? slot.name }}
        <span class="flex items-center gap-2">
          <input
            type="checkbox"
            :data-testid="`instance-slot-${slot.id}`"
            class="size-4"
            title="Fill the slot with this instance's own content"
            :checked="filled(slot.id)"
            @change="setSlot(slot.id, ($event.target as HTMLInputElement).checked)"
          >
          <button
            v-if="design.selectedIds.value.length > 1"
            type="button"
            :data-testid="`instance-slot-fill-${slot.id}`"
            class="text-xs text-primary"
            @click="moveIn(slot.id)"
          >Move selection in</button>
        </span>
      </div>
      <div class="flex items-center gap-2 pt-1">
        <UButton
          data-testid="instance-detach"
          label="Detach"
          icon="i-lucide-unlink"
          size="xs"
          color="neutral"
          variant="soft"
          @click="detach()"
        />
        <select
          data-testid="instance-replace"
          :class="field"
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
    </template>
  </div>
</template>
