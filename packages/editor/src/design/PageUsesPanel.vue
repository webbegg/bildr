<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PageFile, Value } from '@bildr/codegen/model'
import CommitInput from './CommitInput.vue'
import { useDesign } from './store.ts'

/**
 * What a page uses (P5, mapping §4): the queries it reads, with the arguments it gives their
 * parameters (`page_use_update`), the actions its forms and buttons run, and its state. Add a query or an
 * action under a name the page's bindings use (`page_use_add`); remove one nothing binds any more
 * (`page_use_remove`, refused otherwise).
 */

const props = defineProps<{ page: PageFile }>()
const design = useDesign()
const field = 'w-full rounded-md border border-default bg-default px-2 py-1 text-sm'

const module = computed(() => Object.values(design.model.value?.modules ?? {}).find(mod => mod.pages.some(entry => entry.id === props.page.id)))
const queries = computed(() => props.page.uses?.queries ?? [])
const rows = computed(() => [
  ...queries.value.map(use => ({ as: use.as, kind: 'query' as const, label: module.value?.queries.find(entry => entry.id === use.query)?.label ?? use.query, removable: true })),
  ...(props.page.uses?.actions ?? []).map(use => ({ as: use.as, kind: 'action' as const, label: module.value?.actions.find(entry => entry.id === use.action)?.label ?? use.action, removable: true })),
  ...(props.page.uses?.state ?? []).map(use => ({ as: use.as, kind: 'state' as const, label: module.value?.state.find(entry => entry.id === use.state)?.label ?? use.state, removable: false }))
])
const paramsOf = (alias: string) => {
  const use = queries.value.find(entry => entry.as === alias)
  const query = module.value?.queries.find(entry => entry.id === use?.query)
  return (query?.params ?? []).map(param => ({ param, value: use?.args?.[param.name] }))
}
const isExpression = (value: unknown) => typeof value === 'object' && value !== null
const textOf = (value: Value | undefined) => value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
const setArg = (alias: string, name: string, type: string, text: string) =>
  design.edit('page_use_update', { page: props.page.id, as: alias, args: { [name]: text.trim() === '' ? null : ['integer', 'number'].includes(type) ? Number(text) : type === 'boolean' ? text === 'true' : text } })

const remove = (alias: string) => design.edit('page_use_remove', { page: props.page.id, as: alias })

const alias = ref('')
const source = ref('')
const chosenName = computed(() => {
  const query = module.value?.queries.find(entry => entry.id === source.value)
  const action = module.value?.actions.find(entry => entry.id === source.value)
  return alias.value.trim() || query?.name || action?.name || ''
})
const add = async () => {
  if (!source.value || !chosenName.value) return
  const done = await design.edit('page_use_add', { page: props.page.id, as: chosenName.value, ...(source.value.startsWith('act_') ? { action: source.value } : { query: source.value }) })
  if (done) {
    alias.value = ''
    source.value = ''
  }
}
</script>

<template>
  <div
    class="flex flex-col gap-2"
    data-testid="page-uses"
  >
    <h3 class="text-xs font-semibold">
      Data this page uses
    </h3>
    <div
      v-for="row in rows"
      :key="row.as"
      class="flex flex-col gap-1 rounded-md border border-default p-2 text-xs"
      data-testid="use-row"
      :data-alias="row.as"
    >
      <div class="flex items-center gap-2">
        <code class="rounded-sm bg-elevated px-1 py-0.5">{{ row.as }}</code>
        <span class="min-w-0 flex-1 truncate text-muted">{{ row.kind }} · {{ row.label }}</span>
        <button
          v-if="row.removable"
          type="button"
          class="text-muted hover:text-default"
          :aria-label="`Remove ${row.as}`"
          :data-testid="`use-remove-${row.as}`"
          @click="remove(row.as)"
        >
          <UIcon
            name="i-lucide-x"
            class="size-3"
          />
        </button>
      </div>
      <label
        v-for="entry in row.kind === 'query' ? paramsOf(row.as) : []"
        :key="entry.param.name"
        class="grid grid-cols-[5rem_1fr] items-center gap-2 text-muted"
      >
        {{ entry.param.name }}
        <code
          v-if="isExpression(entry.value)"
          class="truncate rounded-sm bg-elevated px-1 py-0.5 text-default"
        >{{ textOf(entry.value) }}</code>
        <CommitInput
          v-else
          :data-testid="`use-arg-${row.as}-${entry.param.name}`"
          :model-value="textOf(entry.value)"
          :numeric="['integer', 'number'].includes(entry.param.type)"
          :placeholder="entry.param.default === undefined ? '' : String(entry.param.default)"
          @commit="setArg(row.as, entry.param.name, entry.param.type, $event)"
        />
      </label>
    </div>
    <div class="flex flex-col gap-1">
      <select
        v-model="source"
        data-testid="use-add-source"
        :class="field"
        aria-label="Add a query or an action"
      >
        <option value="">
          Add a query or an action…
        </option>
        <optgroup label="Queries">
          <option
            v-for="query in module?.queries ?? []"
            :key="query.id"
            :value="query.id"
          >
            {{ query.label }}
          </option>
        </optgroup>
        <optgroup label="Actions">
          <option
            v-for="action in module?.actions ?? []"
            :key="action.id"
            :value="action.id"
          >
            {{ action.label }}
          </option>
        </optgroup>
      </select>
      <div class="flex gap-1">
        <CommitInput
          data-testid="use-add-alias"
          :model-value="alias"
          placeholder="Name it binds by"
          @commit="alias = $event"
        />
        <UButton
          data-testid="use-add"
          label="Add"
          size="xs"
          color="neutral"
          variant="soft"
          :disabled="!source || !chosenName"
          @click="add"
        />
      </div>
    </div>
  </div>
</template>
