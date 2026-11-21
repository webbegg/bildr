<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { PageFile, Value } from '@bildr/codegen/model'
import { FIELD, FIELD_RING } from '../editorUi.ts'
import { apiAutoArgs, apiChoiceId, apiChoiceOf, apiChoices, apiMissingArgs } from '../shared/apiPageUse.ts'
import { freeAlias } from '../shared/pageNames.ts'
import { stateById, stateLabel } from '../shared/stateModel.ts'
import ApiArgInput from './ApiArgInput.vue'
import { useDesign } from './store.ts'

/**
 * What a page uses (P5, mapping §4): the queries it reads, with the arguments it gives their
 * parameters (`page_use_update`), the actions its forms and buttons run, and its state. Add a query or an
 * action under a name the page's bindings use (`page_use_add`); remove one nothing binds any more
 * (`page_use_remove`, refused otherwise: the module's refusal is shown). A State is removed by the State (`{ page, state }`), and listed by its label. It sits in the inspector's Page section under the detail
 * page rows (EditorPageCollection), in the kit's field look.
 *
 * An API query (simple data P7b) is listed as "API · <API> · <query>" with its parameters, and any query of any API can be added, one that
 * answers one record or many (`page_use_add` with `api`): a required parameter the page's route does not give is asked for first.
 */

const props = defineProps<{ page: PageFile }>()
const design = useDesign()
const field = `${FIELD} ${FIELD_RING} w-full min-w-0 px-2 text-default`

const module = computed(() => Object.values(design.model.value?.modules ?? {}).find(mod => mod.pages.some(entry => entry.id === props.page.id)))
const queries = computed(() => props.page.uses?.queries ?? [])
const apis = computed(() => props.page.uses?.apis ?? [])
interface UseRow { as: string, kind: 'query' | 'api' | 'action' | 'state', label: string, state?: string }
const KIND_WORDS = { query: 'query', api: 'API', action: 'action', state: 'state' } as const
const rows = computed((): UseRow[] => [
  ...queries.value.map(use => ({ as: use.as, kind: 'query' as const, label: module.value?.queries.find(entry => entry.id === use.query)?.label ?? use.query })),
  ...apis.value.map(use => ({ as: use.as, kind: 'api' as const, label: apiChoiceOf(design.model.value, apiChoiceId(use.datasource, use.query))?.label ?? `${use.datasource} · ${use.query}` })),
  ...(props.page.uses?.actions ?? []).map(use => ({ as: use.as, kind: 'action' as const, label: module.value?.actions.find(entry => entry.id === use.action)?.label ?? use.action })),
  ...(props.page.uses?.state ?? []).map((use) => {
    const state = design.model.value ? stateById(design.model.value, use.state) : undefined
    return { as: use.as, kind: 'state' as const, label: state ? stateLabel(state) : use.as, state: use.state }
  })
])
const paramsOf = (alias: string) => {
  const use = queries.value.find(entry => entry.as === alias)
  const query = module.value?.queries.find(entry => entry.id === use?.query)
  return (query?.params ?? []).map(param => ({ param, value: use?.args?.[param.name] }))
}
/** The parameters of an API query the page reads as `alias`, with what the page gives them. */
const apiParamsOf = (alias: string) => {
  const use = apis.value.find(entry => entry.as === alias)
  const choice = use ? apiChoiceOf(design.model.value, apiChoiceId(use.datasource, use.query)) : undefined
  return (choice?.params ?? []).map(param => ({ param, value: use?.args?.[param.name], required: param.in === 'path' || param.required === true }))
}
const setApiArg = (alias: string, name: string, value: Value | null) => design.edit('page_use_update', { page: props.page.id, as: alias, args: { [name]: value } })
const isExpression = (value: unknown) => typeof value === 'object' && value !== null
const textOf = (value: Value | undefined) => value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
const setArg = (alias: string, name: string, type: string, text: string) =>
  design.edit('page_use_update', { page: props.page.id, as: alias, args: { [name]: text.trim() === '' ? null : ['integer', 'number'].includes(type) ? Number(text) : type === 'boolean' ? text === 'true' : text } })

/** A State use goes by the State it is of (`state`), any other by the name the page reads it under. */
const remove = (row: UseRow) => design.edit('page_use_remove', { page: props.page.id, ...(row.state ? { state: row.state } : { as: row.as }) })

const alias = ref('')
const source = ref('')
/** The API query chosen, with the values given for it: the page's route gives what it can, the rest is asked for. */
const apiChoice = computed(() => apiChoiceOf(design.model.value, source.value))
const given = ref<Record<string, Value>>({})
watch(source, () => {
  given.value = {}
})
const automatic = computed(() => (apiChoice.value ? apiAutoArgs(props.page, apiChoice.value.params) : {}))
const apiArgs = computed(() => ({ ...automatic.value, ...given.value }))
/** The required parameters the page's route does not fill: the ones the user is asked for. */
const asked = computed(() => (apiChoice.value?.params ?? []).filter(param => (param.in === 'path' || param.required === true) && !(param.name in automatic.value)))
const complete = computed(() => !apiChoice.value || !apiMissingArgs(apiChoice.value.params, apiArgs.value).length)
const setGiven = (name: string, value: Value | null) => {
  const next = { ...given.value }
  if (value === null) Reflect.deleteProperty(next, name)
  else next[name] = value
  given.value = next
}
const withParams = (label: string, params: Array<{ name: string }>) => (params.length ? `${label} (${params.map(param => param.name).join(', ')})` : label)
const apiOptions = computed(() => apiChoices(design.model.value).map(choice => ({ id: choice.id, text: withParams(choice.label, choice.params) })))

const chosenName = computed(() => {
  const query = module.value?.queries.find(entry => entry.id === source.value)
  const action = module.value?.actions.find(entry => entry.id === source.value)
  return alias.value.trim() || (apiChoice.value ? freeAlias(props.page, apiChoice.value.query, 'api') : '') || query?.name || action?.name || ''
})
const add = async () => {
  if (!source.value || !chosenName.value || !complete.value) return
  const choice = apiChoice.value
  const input = choice
    ? { api: { datasource: choice.datasource, query: choice.query }, ...(Object.keys(apiArgs.value).length ? { args: apiArgs.value } : {}) }
    : source.value.startsWith('act_') ? { action: source.value } : { query: source.value }
  const done = await design.edit('page_use_add', { page: props.page.id, as: chosenName.value, ...input })
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
    <h4 class="pt-1 text-[11px] font-[550] text-toned">
      Data this page uses
    </h4>
    <div
      v-for="row in rows"
      :key="row.as"
      class="flex flex-col gap-1.5 rounded-lg bg-elevated/60 p-2 text-[12px]"
      data-testid="use-row"
      :data-alias="row.as"
    >
      <div class="flex items-center gap-2">
        <code class="rounded-sm bg-white/8 px-1 py-0.5 text-highlighted">{{ row.as }}</code>
        <span class="min-w-0 flex-1 truncate text-dimmed">{{ KIND_WORDS[row.kind] }} · {{ row.label }}</span>
        <button
          type="button"
          class="grid size-5 place-items-center rounded-lg text-dimmed hover:bg-white/8 hover:text-highlighted"
          :aria-label="`Remove ${row.as}`"
          :data-testid="`use-remove-${row.as}`"
          @click="remove(row)"
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
        class="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-2 text-dimmed"
      >
        {{ entry.param.name }}
        <code
          v-if="isExpression(entry.value)"
          class="truncate rounded-sm bg-white/8 px-1 py-0.5 text-default"
        >{{ textOf(entry.value) }}</code>
        <EditorCommitInput
          v-else
          size="xs"
          :data-testid="`use-arg-${row.as}-${entry.param.name}`"
          :model-value="textOf(entry.value)"
          :numeric="['integer', 'number'].includes(entry.param.type)"
          :placeholder="entry.param.default === undefined ? '' : String(entry.param.default)"
          @commit="setArg(row.as, entry.param.name, entry.param.type, $event)"
        />
      </label>
      <label
        v-for="entry in row.kind === 'api' ? apiParamsOf(row.as) : []"
        :key="entry.param.name"
        class="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-2 text-dimmed"
      >
        <span class="pt-1">{{ entry.param.name }}</span>
        <ApiArgInput
          :param="entry.param"
          :value="entry.value"
          :required="entry.required"
          :test-id="`use-arg-${row.as}-${entry.param.name}`"
          @commit="setApiArg(row.as, entry.param.name, $event)"
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
        <optgroup
          v-if="apiOptions.length"
          label="API queries"
        >
          <option
            v-for="choice in apiOptions"
            :key="choice.id"
            :value="choice.id"
          >
            {{ choice.text }}
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
      <label
        v-for="param in asked"
        :key="param.name"
        class="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-2 text-[12px] text-dimmed"
      >
        <span class="pt-1">{{ param.name }}</span>
        <ApiArgInput
          :param="param"
          :value="given[param.name]"
          :required="false"
          :test-id="`use-add-arg-${param.name}`"
          @commit="setGiven(param.name, $event)"
        />
      </label>
      <div class="flex gap-1">
        <EditorCommitInput
          size="xs"
          data-testid="use-add-alias"
          :model-value="alias"
          placeholder="Name it binds by"
          @commit="alias = $event"
        />
        <EditorButton
          data-testid="use-add"
          label="Add"
          size="sm"
          variant="soft"
          :disabled="!source || !chosenName || !complete"
          @click="add"
        />
      </div>
    </div>
  </div>
</template>
