<script setup lang="ts">
import { computed, ref } from 'vue'
import { STYLE_TOKENS } from '@bildr/codegen/design'
import type { PropertyDef } from '@bildr/codegen/model'
import { NODE_PROPS } from '@bildr/codegen/render'
import CommitInput from './CommitInput.vue'
import { useDesign } from './store.ts'

/**
 * The properties of a component, or the variables of a layout (the same
 * model: a name, a kind and a default), one list for both: the owner decides
 * the actions (`component_property_*`, `layout_variable_*`). A component's
 * properties also bind to the selected node: a prop of it (`text`) or a style
 * key (`bg`), and a slot property names the container whose children an
 * instance replaces.
 */

const props = defineProps<{
  owner: { kind: 'component' | 'layout', id: string }
  items: readonly PropertyDef[]
  kinds: readonly string[]
}>()
const design = useDesign()

const isComponent = computed(() => props.owner.kind === 'component')
const names = computed(() => isComponent.value
  ? { add: 'component_property_add', update: 'component_property_update', remove: 'component_property_remove', owner: 'component', item: 'property' }
  : { add: 'layout_variable_add', update: 'layout_variable_update', remove: 'layout_variable_remove', owner: 'layout', item: 'variable' })
const target = (id?: string) => ({ [names.value.owner]: props.owner.id, ...(id ? { [names.value.item]: id } : {}) })

const update = (id: string, patch: Record<string, unknown>) => design.edit(names.value.update, { ...target(id), ...patch })
const remove = (id: string) => design.edit(names.value.remove, target(id))

// ── Add ──────────────────────────────────────────────────────────────

const name = ref('')
const kind = ref(props.kinds[0]!)
const options = ref('')
const entity = ref('')
const many = ref(false)
const entities = computed(() => Object.values(design.model.value?.modules ?? {}).flatMap(entry => entry.entities.map(item => ({ id: item.id, name: item.name }))))
const needsEntity = computed(() => kind.value === 'entity' || kind.value === 'field')

const add = async () => {
  if (!name.value.trim()) return
  const list = options.value.split(',').map(entry => entry.trim()).filter(Boolean)
  const out = await design.edit(names.value.add, {
    ...target(),
    name: name.value.trim(),
    kind: kind.value,
    ...(kind.value === 'select' && list.length ? { options: list } : {}),
    ...(needsEntity.value && entity.value ? { entity: entity.value } : {}),
    ...(kind.value === 'entity' && many.value ? { many: true } : {})
  })
  if (out) {
    name.value = ''
    options.value = ''
    entity.value = ''
    many.value = false
  }
}

// ── Defaults ─────────────────────────────────────────────────────────

const TEXTUAL = ['text', 'textarea', 'image', 'link', 'icon']
const defaultText = (property: PropertyDef) => property.default === undefined || typeof property.default === 'object' ? '' : String(property.default)
const commitDefault = (property: PropertyDef, raw: string) => update(property.id, { default: raw === '' ? null : property.kind === 'number' ? Number(raw) : raw })
const commitOptions = (property: PropertyDef, raw: string) => {
  const list = raw.split(',').map(entry => entry.trim()).filter(Boolean)
  return update(property.id, { options: list.length ? list : null })
}

// ── Bindings (components) ──────────────────────────────────────────

const selected = computed(() => design.selected.value)
const propKeys = computed(() => selected.value ? [...NODE_PROPS[selected.value.type] ?? [], 'visible'] : [])
const styleKeys = STYLE_TOKENS.map(token => token.key)
const picks = ref<Record<string, string>>({})
type Binding = NonNullable<PropertyDef['bindings']>[number]

const bindingLabel = (binding: Binding) => `${binding.nodeId} · ${binding.target === 'style' ? 'style ' : ''}${binding.prop}`
const bind = (property: PropertyDef) => {
  const pick = picks.value[property.id]
  if (!pick || !selected.value) return
  const [kindOfTarget, key] = [pick.slice(0, pick.indexOf(':')), pick.slice(pick.indexOf(':') + 1)]
  const binding: Binding = { nodeId: selected.value.id, prop: key, ...(kindOfTarget === 'style' ? { target: 'style' as const } : {}) }
  return update(property.id, { bindings: [...property.bindings ?? [], binding] })
}
const unbind = (property: PropertyDef, index: number) => {
  const rest = (property.bindings ?? []).filter((_, i) => i !== index)
  return update(property.id, { bindings: rest.length ? rest : null })
}
const field = 'w-full rounded-md border border-default bg-default px-2 py-1 text-sm'
</script>

<template>
  <div
    class="flex flex-col gap-2"
    data-testid="property-list"
  >
    <div
      v-for="property in items"
      :key="property.id"
      class="flex flex-col gap-1.5 rounded-md border border-default p-2 text-xs"
      :data-testid="`property-${property.id}`"
    >
      <div class="flex items-center gap-1">
        <CommitInput
          :data-testid="`property-name-${property.id}`"
          :model-value="property.name"
          @commit="update(property.id, { name: $event })"
        />
        <span class="shrink-0 rounded-sm bg-elevated px-1 py-0.5 text-muted">{{ property.kind }}</span>
        <UButton
          :data-testid="`property-remove-${property.id}`"
          icon="i-lucide-trash-2"
          aria-label="Remove"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="remove(property.id)"
        />
      </div>

      <CommitInput
        v-if="TEXTUAL.includes(property.kind) || property.kind === 'number'"
        :data-testid="`property-default-${property.id}`"
        :model-value="defaultText(property)"
        :multiline="property.kind === 'textarea'"
        placeholder="Default"
        @commit="commitDefault(property, $event)"
      />
      <label
        v-else-if="property.kind === 'boolean'"
        class="flex items-center gap-2 text-muted"
      >
        <input
          type="checkbox"
          :data-testid="`property-default-${property.id}`"
          class="size-4"
          :checked="property.default === true"
          @change="update(property.id, { default: ($event.target as HTMLInputElement).checked })"
        >
        Default on
      </label>
      <template v-else-if="property.kind === 'select'">
        <CommitInput
          :data-testid="`property-options-${property.id}`"
          :model-value="(property.options ?? []).join(', ')"
          placeholder="Options, comma separated"
          @commit="commitOptions(property, $event)"
        />
        <select
          :data-testid="`property-default-${property.id}`"
          :class="field"
          :value="String(property.default ?? '')"
          @change="update(property.id, { default: ($event.target as HTMLSelectElement).value || null })"
        >
          <option value="">
            No default
          </option>
          <option
            v-for="option in property.options ?? []"
            :key="option"
            :value="option"
          >
            {{ option }}
          </option>
        </select>
      </template>
      <template v-else-if="property.kind === 'entity' || property.kind === 'field'">
        <select
          :data-testid="`property-entity-${property.id}`"
          :class="field"
          :value="property.entity ?? ''"
          @change="update(property.id, { entity: ($event.target as HTMLSelectElement).value || null })"
        >
          <option value="">
            Entity…
          </option>
          <option
            v-for="entry in entities"
            :key="entry.id"
            :value="entry.id"
          >
            {{ entry.name }}
          </option>
        </select>
        <label
          v-if="property.kind === 'entity'"
          class="flex items-center gap-2 text-muted"
        >
          <input
            type="checkbox"
            :data-testid="`property-many-${property.id}`"
            class="size-4"
            :checked="property.many === true"
            @change="update(property.id, { many: ($event.target as HTMLInputElement).checked || null })"
          >
          A list of them
        </label>
      </template>

      <label class="flex items-center gap-2 text-muted">
        <input
          type="checkbox"
          :data-testid="`property-optional-${property.id}`"
          class="size-4"
          :checked="property.optional === true"
          @change="update(property.id, { optional: ($event.target as HTMLInputElement).checked || null })"
        >
        Optional
      </label>

      <template v-if="isComponent && property.kind === 'slot'">
        <div class="flex items-center gap-2 text-muted">
          <span>Slot node: <code>{{ property.nodeId ?? 'none' }}</code></span>
          <UButton
            :data-testid="`property-slot-${property.id}`"
            label="Use selected"
            size="xs"
            color="neutral"
            variant="soft"
            :disabled="!selected"
            @click="update(property.id, { nodeId: selected!.id })"
          />
        </div>
      </template>
      <template v-else-if="isComponent">
        <ul
          v-if="property.bindings?.length"
          class="flex flex-col gap-0.5"
        >
          <li
            v-for="(binding, index) in property.bindings"
            :key="index"
            class="flex items-center gap-1 text-muted"
          >
            <code class="min-w-0 flex-1 truncate">{{ bindingLabel(binding) }}</code>
            <button
              type="button"
              :data-testid="`property-unbind-${property.id}-${index}`"
              aria-label="Unbind"
              @click="unbind(property, index)"
            >
              <UIcon
                name="i-lucide-x"
                class="size-3"
              />
            </button>
          </li>
        </ul>
        <div
          v-if="selected"
          class="flex items-center gap-1"
        >
          <select
            :data-testid="`property-bind-target-${property.id}`"
            :class="field"
            :value="picks[property.id] ?? ''"
            :aria-label="`Bind ${property.name} to ${selected.id}`"
            @change="picks[property.id] = ($event.target as HTMLSelectElement).value"
          >
            <option value="">
              Bind to {{ selected.name ?? selected.type }}…
            </option>
            <optgroup label="Props">
              <option
                v-for="key in propKeys"
                :key="key"
                :value="`prop:${key}`"
              >
                {{ key }}
              </option>
            </optgroup>
            <optgroup label="Style">
              <option
                v-for="key in styleKeys"
                :key="key"
                :value="`style:${key}`"
              >
                {{ key }}
              </option>
            </optgroup>
          </select>
          <UButton
            :data-testid="`property-bind-${property.id}`"
            icon="i-lucide-link"
            aria-label="Bind"
            size="xs"
            color="neutral"
            variant="soft"
            @click="bind(property)"
          />
        </div>
      </template>
    </div>

    <div
      class="flex flex-col gap-1.5 rounded-md border border-dashed border-default p-2 text-xs"
      data-testid="property-add"
    >
      <div class="flex items-center gap-1">
        <CommitInput
          data-testid="prop-add-name"
          :model-value="name"
          placeholder="Name"
          @commit="name = $event"
        />
        <select
          v-model="kind"
          data-testid="prop-add-kind"
          :class="field"
          aria-label="Kind"
        >
          <option
            v-for="entry in kinds"
            :key="entry"
            :value="entry"
          >
            {{ entry }}
          </option>
        </select>
      </div>
      <CommitInput
        v-if="kind === 'select'"
        data-testid="prop-add-options"
        :model-value="options"
        placeholder="Options, comma separated"
        @commit="options = $event"
      />
      <div
        v-if="needsEntity"
        class="flex items-center gap-2"
      >
        <select
          v-model="entity"
          data-testid="prop-add-entity"
          :class="field"
        >
          <option value="">
            Entity…
          </option>
          <option
            v-for="entry in entities"
            :key="entry.id"
            :value="entry.id"
          >
            {{ entry.name }}
          </option>
        </select>
        <label
          v-if="kind === 'entity'"
          class="flex shrink-0 items-center gap-1 text-muted"
        >
          <input
            v-model="many"
            type="checkbox"
            data-testid="prop-add-many"
            class="size-4"
          >
          List
        </label>
      </div>
      <UButton
        data-testid="prop-add"
        :label="isComponent ? 'Add property' : 'Add variable'"
        icon="i-lucide-plus"
        size="xs"
        color="neutral"
        variant="soft"
        @click="add()"
      />
    </div>
  </div>
</template>
