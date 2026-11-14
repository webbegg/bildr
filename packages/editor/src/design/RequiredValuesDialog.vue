<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { PropertyDef, Value } from '@bildr/codegen/model'
import { useDesign } from './store.ts'

/**
 * A component with required properties (an entity record, a text…) can't be inserted empty: the model
 * refuses an instance without them. This asks for each one first. A record is picked among the names in
 * scope at the insertion point (a List's item, a one-record query, a record property), so inserting
 * outside a List says there is nothing to bind there; other kinds are typed.
 */

const design = useDesign()
const pending = computed(() => design.pendingInsert.value)
const values = reactive<Record<string, Value | undefined>>({})
watch(pending, (now) => {
  for (const key of Object.keys(values)) values[key] = undefined
  for (const property of now?.needs ?? []) if (property.kind === 'boolean') values[property.id] = false
})

const open = computed({
  get: () => !!pending.value,
  set: (on: boolean) => {
    if (!on) design.pendingInsert.value = null
  }
})

/** What can be given to a record property: the names in scope of its entity, one record for a single, a list for `many`. */
const candidates = (property: PropertyDef) => (pending.value?.scope ?? []).filter(entry => entry.entity === property.entity && entry.many === (property.many === true))
const ready = computed(() => (pending.value?.needs ?? []).every(property => values[property.id] !== undefined && values[property.id] !== ''))
const isNumber = (property: PropertyDef) => property.kind === 'number'
const give = (property: PropertyDef, raw: string) => {
  values[property.id] = property.kind === 'entity' ? (raw ? { $bind: raw } : undefined) : isNumber(property) ? (raw.trim() === '' || !Number.isFinite(Number(raw)) ? undefined : Number(raw)) : raw
}
const confirm = () => design.confirmInsert(Object.fromEntries(Object.entries(values).filter((entry): entry is [string, Value] => entry[1] !== undefined)))
const field = 'w-full rounded-md border border-default bg-default px-2 py-1 text-sm'
</script>

<template>
  <UModal
    v-model:open="open"
    :title="pending ? `${pending.component.name} needs a value` : ''"
    description="Its required properties have no default: give each one before it is inserted."
  >
    <template #body>
      <div
        v-if="pending"
        class="flex flex-col gap-3"
        data-testid="required-dialog"
      >
        <label
          v-for="property in pending.needs"
          :key="property.id"
          class="grid grid-cols-[7rem_1fr] items-center gap-2 text-sm"
        >
          {{ property.label ?? property.name }}
          <select
            v-if="property.kind === 'entity'"
            :data-testid="`required-${property.name}`"
            :class="field"
            @change="give(property, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">
              Pick a record…
            </option>
            <option
              v-for="entry in candidates(property)"
              :key="entry.name"
              :value="entry.name"
            >
              {{ entry.name }}
            </option>
          </select>
          <select
            v-else-if="property.kind === 'select'"
            :data-testid="`required-${property.name}`"
            :class="field"
            @change="give(property, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">
              Pick one…
            </option>
            <option
              v-for="option in property.options ?? []"
              :key="option"
              :value="option"
            >
              {{ option }}
            </option>
          </select>
          <input
            v-else-if="property.kind === 'boolean'"
            type="checkbox"
            :data-testid="`required-${property.name}`"
            class="size-4 justify-self-start"
            @change="values[property.id] = ($event.target as HTMLInputElement).checked"
          >
          <input
            v-else
            :data-testid="`required-${property.name}`"
            :class="field"
            :placeholder="property.placeholder ?? ''"
            @input="give(property, ($event.target as HTMLInputElement).value)"
          >
        </label>
        <p
          v-if="pending.needs.some(property => property.kind === 'entity' && !candidates(property).length)"
          class="text-xs text-muted"
          data-testid="required-none"
        >
          Nothing here holds such a record. Put it inside a List of them (select the List, then add it), or bind the list first.
        </p>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          data-testid="required-cancel"
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="open = false"
        />
        <UButton
          data-testid="required-confirm"
          label="Insert"
          :disabled="!ready"
          @click="confirm"
        />
      </div>
    </template>
  </UModal>
</template>
