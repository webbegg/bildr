<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { ModelNode, QueryFile, Value } from '@bildr/codegen/model'
import { CONDITION_OPS } from '@bildr/codegen/model'
import { entityFieldNames, queryBehind } from '@bildr/codegen/edit'
import CommitInput from './CommitInput.vue'
import { useDesign } from './store.ts'

/**
 * A List's source (P5, mapping §4): the query it reads, picked among the page's uses or created
 * for an entity ("New from entity…"), and for each query behind it (a computed alias has two) its
 * sort, filter and limit. An edit goes to `query_update` for the use shown: in place when only
 * this use reads the query, a copy `q_<page>_<as>` when others do (Q5). A limit the query takes as
 * a parameter is the page's argument (`page_use_update`).
 */

const props = defineProps<{ node: ModelNode }>()
const design = useDesign()
const field = 'w-full rounded-md border border-default bg-default px-2 py-1 text-sm'
const small = 'rounded-md border border-default bg-default px-1 py-1 text-xs'

const isExpression = (value: unknown): value is Record<string, Value> => typeof value === 'object' && value !== null && !Array.isArray(value)
const page = computed(() => design.page.value)
const model = computed(() => design.model.value)
const current = computed(() => isExpression(props.node.props?.items) && typeof props.node.props.items.$bind === 'string' ? props.node.props.items.$bind.split('.')[0]! : '')

/** The page's uses a List can repeat over: query uses that return many rows, and computed values built from them. */
const aliases = computed<string[]>(() => {
  const shown = page.value
  const current = model.value
  if (!shown || !current) return []
  const many = (alias: string) => queryBehind(current, shown, alias)?.result === 'many'
  return [...(shown.uses?.queries ?? []).map(use => use.as), ...(shown.uses?.computed ?? []).map(use => use.as)].filter(many)
})
const entities = computed(() => {
  const shown = page.value
  const current = model.value
  const module = current && shown ? Object.values(current.modules).find(mod => mod.pages.some(entry => entry.id === shown.id)) : undefined
  return (module?.entities ?? []).filter((entity) => {
    const repository = module!.repositories.find(entry => entry.entity === entity.id)
    return repository?.expose?.list && repository.operations.includes('list')
  })
})

const pickItems = (event: Event) => {
  const value = (event.target as HTMLSelectElement).value
  if (!value || !page.value) return
  if (value.startsWith('new:')) void design.edit('query_create_for_list', { page: page.value.id, entity: value.slice(4), nodeId: props.node.id })
  else void design.setProps(props.node.id, { items: { $bind: value } })
}

// ── The queries behind the binding ──────────────────────────────────────

interface Source { alias: string, query: QueryFile, args: Record<string, Value> }

/** The query uses behind the List's items: the alias itself, or the branches of a computed alias. */
const sources = computed<Source[]>(() => {
  const shown = page.value
  const current_ = model.value
  if (!shown || !current_ || !current.value) return []
  const aliasesBehind = (alias: string, seen: string[] = []): string[] => {
    if (seen.includes(alias)) return []
    if (shown.uses?.queries?.some(use => use.as === alias)) return [alias]
    const computed_ = (shown.uses?.computed ?? []).find(use => use.as === alias) as { then?: Value, else?: Value } | undefined
    return [computed_?.then, computed_?.else].flatMap(branch => isExpression(branch) && typeof branch.$bind === 'string' ? aliasesBehind(branch.$bind.split('.')[0]!, [...seen, alias]) : [])
  }
  return [...new Set(aliasesBehind(current.value))].flatMap((alias) => {
    const use = shown.uses!.queries!.find(entry => entry.as === alias)!
    const query = Object.values(current_.modules).flatMap(mod => mod.queries).find(entry => entry.id === use.query)
    return query ? [{ alias, query, args: use.args ?? {} }] : []
  })
})

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
  const type = typeOf(source, draft.field)
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
    class="flex flex-col gap-2 border-t border-default pt-2"
    data-testid="list-source"
  >
    <label class="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs text-muted">
      Items
      <select
        data-testid="list-items"
        :class="field"
        :value="current"
        @change="pickItems"
      >
        <option
          v-if="current && !aliases.includes(current)"
          :value="current"
        >
          {{ current }}
        </option>
        <option
          v-for="alias in aliases"
          :key="alias"
          :value="alias"
        >
          {{ alias }}
        </option>
        <option
          v-for="entity in entities"
          :key="entity.id"
          :value="`new:${entity.id}`"
        >
          New from {{ entity.name }}…
        </option>
      </select>
    </label>

    <div
      v-for="source in sources"
      :key="source.alias"
      class="flex flex-col gap-1 rounded-md border border-default p-2 text-xs"
      data-testid="source"
      :data-alias="source.alias"
    >
      <div class="font-medium">
        {{ source.query.label }} <span class="text-muted">as {{ source.alias }}</span>
      </div>
      <div class="grid grid-cols-[3.5rem_1fr_auto] items-center gap-1 text-muted">
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
      <div class="grid grid-cols-[3.5rem_1fr] items-center gap-1 text-muted">
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
          class="rounded-sm bg-elevated px-1 py-0.5 text-default"
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
        <CommitInput
          v-else
          :data-testid="`source-${source.alias}-filter-value`"
          :model-value="draftOf(source).value"
          :placeholder="draftOf(source).op === 'in' ? 'a, b, c' : 'value'"
          :numeric="['integer', 'number'].includes(typeOf(source, draftOf(source).field) ?? '')"
          @commit="editFilter(source, 'value', $event)"
        />
      </div>
      <div class="grid grid-cols-[3.5rem_1fr] items-center gap-1 text-muted">
        Limit
        <CommitInput
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
