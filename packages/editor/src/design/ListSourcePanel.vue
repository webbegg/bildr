<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { ModelNode, QueryFile, Value } from '@bildr/codegen/model'
import { CONDITION_OPS } from '@bildr/codegen/model'
import { entityFieldNames, queryBehind } from '@bildr/codegen/edit'
import { FIELD, FIELD_RING } from '../editorUi.ts'
import { apiChoiceId, apiChoiceOf, apiChoices, apiUseRows } from '../shared/apiPageUse.ts'
import { isExpression } from '../shared/bindings.ts'
import { valueKindOf } from '../shared/dataModel.ts'
import { computedValues } from '../shared/listSource.ts'
import ApiArgInput from './ApiArgInput.vue'
import ListConditionForm from './ListConditionForm.vue'
import { useDesign } from './store.ts'
import { useListCondition } from './useListCondition.ts'

/**
 * A List's source (P5, mapping §4): the query it reads, picked among the page's uses or created
 * for an entity ("New from entity…"), and for each query behind it (a computed alias has two) its
 * sort, filter and limit. An edit goes to `query_update` for the use shown: in place when only
 * this use reads the query, a copy `q_<page>_<as>` when others do (Q5). A limit the query takes as
 * a parameter is the page's argument (`page_use_update`). It sits in the inspector's Behaviour section
 * of a List, in the kit's field look.
 *
 * "Depends on a condition" (B4, S4) makes the source "if <an on or off value> then <list> else <list>", the page's computed value
 * the List's `items` bind (`useListCondition` reads and writes it, `ListConditionForm` is its form). Each branch's query keeps its own
 * sort, filter and limit below, named by the branch (Then, Otherwise): the two lists are different queries, and what they show is
 * theirs to set, so the condition only chooses between them.
 *
 * An API query (simple data P7b) is offered for each one that answers many rows, "<API> · <query>", and a page's use of one is among the
 * lists like any other. Its settings are its parameters, the page's arguments (`page_use_update`); it has no sort, filter or limit,
 * which a collection's query has (an API's rows come as the API gives them). A query that needs a value the page can't give by itself
 * asks for it first (`list-api-pending`), and is written when the value is there.
 */

const props = defineProps<{ node: ModelNode }>()
const design = useDesign()
const field = `${FIELD} ${FIELD_RING} w-full min-w-0 px-2 text-default`
const small = `${FIELD} ${FIELD_RING} min-w-0 px-1.5 text-default disabled:opacity-50`

const page = computed(() => design.page.value)
const model = computed(() => design.model.value)
const { itemsRoot, condition, form, summary, ifOptions, thenOptions, elseOptions, branchOf, changeCondition, pickSource, pendingApi, setApiArg, confirmApi, cancelApi, busy, failure, formKey } = useListCondition(() => props.node)

/** What the Items select shows: a condition, written or being made, is one entry. */
const sourceValue = computed(() => (form.value ? 'cond' : itemsRoot.value))

/** The page's uses a List can repeat over: query uses that return many rows, and computed values built from them. */
const aliases = computed<string[]>(() => {
  const onPage = page.value
  const inModel = model.value
  if (!onPage || !inModel) return []
  const many = (alias: string) => queryBehind(inModel, onPage, alias)?.result === 'many'
  const apis = (onPage.uses?.apis ?? []).filter(use => apiUseRows(inModel, use)?.many).map(use => use.as)
  return [...[...(onPage.uses?.queries ?? []).map(use => use.as), ...computedValues(onPage).map(use => use.as)].filter(many), ...apis]
})
/** The API queries a List can repeat over, each to be used on the page when picked. */
const apiOptions = computed(() => apiChoices(model.value, { many: true }))
const entities = computed(() => {
  const onPage = page.value
  const inModel = model.value
  const module = inModel && onPage ? Object.values(inModel.modules).find(mod => mod.pages.some(entry => entry.id === onPage.id)) : undefined
  return (module?.entities ?? []).filter((entity) => {
    const repository = module!.repositories.find(entry => entry.entity === entity.id)
    return repository?.expose?.list && repository.operations.includes('list')
  })
})

/** "Then" for the list a true condition shows, "Otherwise" for the other. */
const branchText = (alias: string) => (branchOf(alias) === 'then' ? 'Then' : 'Otherwise')

// ── The queries behind the binding ──────────────────────────────────────

interface Source { alias: string, query: QueryFile, args: Record<string, Value> }

/** The query uses behind the List's items: the alias itself, or the branches of a computed alias. */
const sources = computed<Source[]>(() => {
  const onPage = page.value
  const inModel = model.value
  if (!onPage || !inModel || !itemsRoot.value) return []
  const aliasesBehind = (alias: string, seen: string[] = []): string[] => {
    if (seen.includes(alias)) return []
    if (onPage.uses?.queries?.some(use => use.as === alias)) return [alias]
    const entry = computedValues(onPage).find(use => use.as === alias)
    return [entry?.then, entry?.else].flatMap(branch => isExpression(branch) && typeof branch.$bind === 'string' ? aliasesBehind(branch.$bind.split('.')[0]!, [...seen, alias]) : [])
  }
  return [...new Set(aliasesBehind(itemsRoot.value))].flatMap((alias) => {
    const use = onPage.uses!.queries!.find(entry => entry.as === alias)!
    const query = Object.values(inModel.modules).flatMap(mod => mod.queries).find(entry => entry.id === use.query)
    return query ? [{ alias, query, args: use.args ?? {} }] : []
  })
})

/** The API query behind the List's items, when it reads one: its use, its choice and the parameters with the page's arguments. */
const apiSource = computed(() => {
  const onPage = page.value
  const use = onPage?.uses?.apis?.find(entry => entry.as === itemsRoot.value)
  const choice = use ? apiChoiceOf(model.value, apiChoiceId(use.datasource, use.query)) : undefined
  if (!use || !choice) return null
  return { alias: use.as, choice, params: choice.params.map(param => ({ param, value: use.args?.[param.name], required: param.in === 'path' || param.required === true })) }
})
const setApiParam = (alias: string, name: string, value: Value | null) => {
  if (page.value) return design.edit('page_use_update', { page: page.value.id, as: alias, args: { [name]: value } })
}

const fieldsOf = (query: QueryFile) => {
  const entity = Object.values(model.value?.modules ?? {}).flatMap(mod => mod.entities).find(entry => entry.id === query.from)
  return entity ? entityFieldNames(entity).map(name => ({ name, type: entity.fields.find(entry => entry.name === name)?.type ?? 'text' })) : []
}

const update = (source: Source, patch: Record<string, unknown>) => {
  if (!page.value) return Promise.resolve(undefined)
  return design.edit('query_update', { query: source.query.id, page: page.value.id, as: source.alias, ...patch })
}

// The sort is a draft too: a second change made before the first one has been read back builds on it, not on the stale query.
const sorts = reactive<Record<string, { field: string, direction: string }>>({})
const freshSort = (source: Source) => ({ field: source.query.orderBy?.[0]?.field ?? '', direction: source.query.orderBy?.[0]?.direction ?? 'asc' })
const sortOf = (source: Source) => sorts[source.alias] ?? freshSort(source)
const saveSort = (source: Source, sort: { field: string, direction: string }) => {
  sorts[source.alias] = sort
  const rest = source.query.orderBy?.slice(1) ?? []
  return update(source, { orderBy: sort.field ? [{ field: sort.field, direction: sort.direction }, ...rest] : null })
}
const setSortField = (source: Source, event: Event) => saveSort(source, { ...sortOf(source), field: (event.target as HTMLSelectElement).value })
const setSortDirection = (source: Source, event: Event) => {
  if (sortOf(source).field) void saveSort(source, { ...sortOf(source), direction: (event.target as HTMLSelectElement).value })
}

/** A limit the query takes as a parameter is the page's argument; otherwise the query's own. */
const limitParam = (source: Source) => isExpression(source.query.limit) && typeof source.query.limit.$param === 'string' ? source.query.limit.$param : undefined
const limitText = (source: Source) => {
  const param = limitParam(source)
  const value = param ? source.args[param] ?? source.query.params.find(entry => entry.name === param)?.default : source.query.limit
  return typeof value === 'number' ? String(value) : ''
}
const setLimit = (source: Source, text: string) => {
  const value = text.trim() === '' ? null : Number(text)
  const param = limitParam(source)
  if (param && page.value) return design.edit('page_use_update', { page: page.value.id, as: source.alias, args: { [param]: value } })
  return update(source, { limit: value })
}

// The filter is edited as a draft (field, operator, value) and saved once complete; clearing the field removes it.
const drafts = reactive<Record<string, { field: string, op: string, value: string }>>({})
const textOfValue = (value: Value | undefined) => value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
const fresh = (source: Source) => ({ field: source.query.where?.field ?? '', op: source.query.where?.op ?? '', value: textOfValue(source.query.where?.value) })
watch(sources, (now) => {
  for (const source of now) {
    drafts[source.alias] = fresh(source)
    sorts[source.alias] = freshSort(source)
  }
}, { immediate: true })
const draftOf = (source: Source) => drafts[source.alias] ?? fresh(source)
const paramValue = (source: Source) => isExpression(source.query.where?.value) && typeof source.query.where.value.$param === 'string'
const typeOf = (source: Source, name: string) => fieldsOf(source.query).find(entry => entry.name === name)?.type
const typed = (source: Source, draft: { field: string, value: string }): Value | undefined => {
  const type = valueKindOf(typeOf(source, draft.field))
  if (type === 'boolean') return draft.value === 'true' ? true : draft.value === 'false' ? false : undefined
  if (type === 'integer' || type === 'number') return draft.value.trim() !== '' && Number.isFinite(Number(draft.value)) ? Number(draft.value) : undefined
  return draft.value === '' ? undefined : draft.value
}
const saveFilter = (source: Source) => {
  const draft = draftOf(source)
  if (!draft.field) return update(source, { where: null })
  const value = draft.op === 'in' ? draft.value.split(',').map(part => part.trim()).filter(Boolean) : typed(source, draft)
  if (!draft.op || value === undefined || (Array.isArray(value) && !value.length)) return undefined
  return update(source, { where: { op: draft.op, field: draft.field, value } })
}
const editFilter = (source: Source, key: 'field' | 'op' | 'value', value: string) => {
  const draft = draftOf(source)
  drafts[source.alias] = { ...draft, [key]: value, ...(key === 'field' ? { value: '' } : {}) }
  void saveFilter(source)
}
const filterField = (source: Source, event: Event) => editFilter(source, 'field', (event.target as HTMLSelectElement).value)
const filterOp = (source: Source, event: Event) => editFilter(source, 'op', (event.target as HTMLSelectElement).value)
const filterValue = (source: Source, event: Event) => editFilter(source, 'value', (event.target as HTMLSelectElement).value)
</script>

<template>
  <div
    class="flex flex-col gap-2"
    data-testid="list-source"
  >
    <EditorRow
      label="Items"
      title="The list of records the List repeats over"
    >
      <select
        data-testid="list-items"
        :class="field"
        aria-label="Items"
        :value="sourceValue"
        :disabled="busy"
        @change="pickSource(($event.target as HTMLSelectElement).value)"
      >
        <option
          v-if="itemsRoot && !form && !aliases.includes(itemsRoot)"
          :value="itemsRoot"
        >
          {{ itemsRoot }}
        </option>
        <option
          v-for="alias in aliases.filter(entry => entry !== condition?.as)"
          :key="alias"
          :value="alias"
        >
          {{ alias }}
        </option>
        <option value="cond">
          Depends on a condition
        </option>
        <option
          v-for="entity in entities"
          :key="entity.id"
          :value="`new:${entity.id}`"
        >
          New from {{ entity.name }}…
        </option>
        <option
          v-for="choice in apiOptions"
          :key="choice.id"
          :value="choice.id"
        >
          {{ choice.label }}
        </option>
      </select>
    </EditorRow>

    <ListConditionForm
      v-if="form"
      :key="formKey"
      :form="form"
      :summary="summary"
      :if-options="ifOptions"
      :then-options="thenOptions"
      :else-options="elseOptions"
      :busy="busy"
      @change="changeCondition"
    />
    <p
      v-if="failure"
      class="text-[12px] leading-4 text-error"
      role="alert"
      data-testid="list-condition-error"
    >
      {{ failure }}
    </p>

    <div
      v-if="pendingApi"
      class="flex flex-col gap-1.5 rounded-lg bg-elevated/60 p-2 text-[12px]"
      data-testid="list-api-pending"
    >
      <div class="font-[550] text-highlighted">
        {{ pendingApi.choice.label }} <span class="font-normal text-dimmed">needs a value</span>
      </div>
      <label
        v-for="param in pendingApi.required"
        :key="param.name"
        class="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-2 text-dimmed"
      >
        <span class="pt-1">{{ param.name }}</span>
        <ApiArgInput
          :param="param"
          :value="pendingApi.args[param.name]"
          :test-id="`list-api-arg-${param.name}`"
          :required="false"
          @commit="setApiArg(param.name, $event)"
        />
      </label>
      <div class="flex gap-1">
        <EditorButton
          data-testid="list-api-add"
          label="Use it"
          size="xs"
          variant="soft"
          :disabled="pendingApi.missing.length > 0 || busy"
          @click="confirmApi"
        />
        <EditorButton
          data-testid="list-api-cancel"
          label="Cancel"
          size="xs"
          variant="ghost"
          @click="cancelApi"
        />
      </div>
    </div>

    <div
      v-if="apiSource"
      class="flex flex-col gap-1.5 rounded-lg bg-elevated/60 p-2 text-[12px]"
      data-testid="api-source"
      :data-alias="apiSource.alias"
    >
      <div class="font-[550] text-highlighted">
        {{ apiSource.choice.label }} <span class="font-normal text-dimmed">as {{ apiSource.alias }}</span>
      </div>
      <p
        v-if="!apiSource.params.length"
        class="text-dimmed"
      >
        It takes no values: the List shows what it answers.
      </p>
      <label
        v-for="entry in apiSource.params"
        :key="entry.param.name"
        class="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-2 text-dimmed"
      >
        <span class="pt-1">{{ entry.param.name }}</span>
        <ApiArgInput
          :param="entry.param"
          :value="entry.value"
          :required="entry.required"
          :test-id="`source-${apiSource.alias}-arg-${entry.param.name}`"
          @commit="setApiParam(apiSource.alias, entry.param.name, $event)"
        />
      </label>
    </div>

    <div
      v-for="source in sources"
      :key="source.alias"
      class="flex flex-col gap-1.5 rounded-lg bg-elevated/60 p-2 text-[12px]"
      data-testid="source"
      :data-alias="source.alias"
      :data-branch="branchOf(source.alias)"
    >
      <div class="font-[550] text-highlighted">
        <span
          v-if="branchOf(source.alias)"
          class="me-1 font-normal text-dimmed"
        >{{ branchText(source.alias) }}:</span>{{ source.query.label }} <span class="font-normal text-dimmed">as {{ source.alias }}</span>
      </div>
      <div class="grid grid-cols-[3.5rem_1fr_auto] items-center gap-1 text-dimmed">
        Sort
        <select
          :data-testid="`source-${source.alias}-sort-field`"
          :class="small"
          :value="sortOf(source).field"
          @change="setSortField(source, $event)"
        >
          <option value="">
            None
          </option>
          <option
            v-for="entry in fieldsOf(source.query)"
            :key="entry.name"
            :value="entry.name"
          >
            {{ entry.name }}
          </option>
        </select>
        <select
          :data-testid="`source-${source.alias}-sort-dir`"
          :class="small"
          :disabled="!sortOf(source).field"
          :value="sortOf(source).direction"
          @change="setSortDirection(source, $event)"
        >
          <option value="asc">
            asc
          </option>
          <option value="desc">
            desc
          </option>
        </select>
      </div>
      <div class="grid grid-cols-[3.5rem_1fr] items-center gap-1 text-dimmed">
        Filter
        <div class="flex gap-1">
          <select
            :data-testid="`source-${source.alias}-filter-field`"
            :class="[small, 'min-w-0 flex-1']"
            :value="draftOf(source).field"
            @change="filterField(source, $event)"
          >
            <option value="">
              None
            </option>
            <option
              v-for="entry in fieldsOf(source.query)"
              :key="entry.name"
              :value="entry.name"
            >
              {{ entry.name }}
            </option>
          </select>
          <select
            :data-testid="`source-${source.alias}-filter-op`"
            :class="small"
            :disabled="!draftOf(source).field"
            :value="draftOf(source).op"
            @change="filterOp(source, $event)"
          >
            <option value="">
              …
            </option>
            <option
              v-for="op in CONDITION_OPS"
              :key="op"
              :value="op"
            >
              {{ op }}
            </option>
          </select>
        </div>
        <span />
        <code
          v-if="paramValue(source)"
          class="rounded-sm bg-white/8 px-1 py-0.5 text-default"
        >{{ draftOf(source).value }}</code>
        <select
          v-else-if="typeOf(source, draftOf(source).field) === 'boolean'"
          :data-testid="`source-${source.alias}-filter-value`"
          :class="small"
          :disabled="!draftOf(source).field"
          :value="draftOf(source).value"
          @change="filterValue(source, $event)"
        >
          <option value="">
            …
          </option>
          <option value="true">
            true
          </option>
          <option value="false">
            false
          </option>
        </select>
        <EditorCommitInput
          v-else
          size="xs"
          :data-testid="`source-${source.alias}-filter-value`"
          :model-value="draftOf(source).value"
          :placeholder="draftOf(source).op === 'in' ? 'a, b, c' : 'value'"
          :numeric="['integer', 'number'].includes(typeOf(source, draftOf(source).field) ?? '')"
          @commit="editFilter(source, 'value', $event)"
        />
      </div>
      <div class="grid grid-cols-[3.5rem_1fr] items-center gap-1 text-dimmed">
        Limit
        <EditorCommitInput
          size="xs"
          :data-testid="`source-${source.alias}-limit`"
          :model-value="limitText(source)"
          numeric
          placeholder="All rows"
          @commit="setLimit(source, $event)"
        />
      </div>
    </div>
  </div>
</template>
