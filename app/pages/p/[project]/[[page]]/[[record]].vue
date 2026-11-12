<script setup lang="ts">
import type { DataRecord } from '#shared/data/records'
import { bindingItem } from '#shared/runtime/bindings'
import { detailKeyField, detailTitle, resolvePageRoute } from '#shared/runtime/detail'
import { resolvePageWithLayout } from '#shared/runtime/layouts'
import { listKey, listNodes, listQueryOf, listSearch } from '#shared/runtime/list'
import { mergePage, nextPageSearch } from '#shared/runtime/loadMore'
import type { ListPage, LoadedList } from '#shared/runtime/loadMore'
import type { VisitorSnapshot } from '#shared/runtime/visitor'

/**
 * The published app: the last published snapshot, rendered by the shared runtime.
 * Each List query on the page reads its records from the public data endpoint,
 * which serves only `publicRead` collections; a failed read renders nothing.
 * Forms post their values to the same endpoint, which takes them only for
 * `publicCreate` collections, and show its (generic) message on failure.
 * `{{ env.NAME }}` resolves from the snapshot's public variables (copied at
 * publish); a secret or missing one renders empty.
 * A detail page (`/p/<site>/<page>/<key>`) reads its record from the public
 * record endpoint, which serves only `publicRead` collections, and renders
 * with it as the page item; without a key, with a key no record has, or
 * with a key on a plain page, it shows not found (the app is a SPA, so the
 * status stays 200).
 * A List with `loadMore` reads its next page from the same endpoint
 * (`offset` = the records loaded, same limit, sort and filter) and appends it.
 */
definePageMeta({ layout: false })

const route = useRoute()
const projectSlug = computed(() => String(route.params.project))
const { data, error } = await useFetch<VisitorSnapshot>(() => `/api/published/${projectSlug.value}`)

const project = computed(() => data.value?.project)
const env = computed(() => data.value?.env ?? {})
const segment = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
const target = computed(() => resolvePageRoute(project.value?.pages ?? [], segment(route.params.page), segment(route.params.record)))
const page = computed(() => target.value?.page)

/** The record a detail page asks for: its collection (as published), the key and the key field. */
const wanted = computed(() => {
  const ref = page.value?.collection
  const key = target.value?.key
  if (!ref || key === undefined) return undefined
  const collection = project.value?.collections.find(c => c.slug === ref.slug)
  return { collection, key, field: detailKeyField(collection, ref.field) }
})
const record = shallowRef<DataRecord | null>(null)
/** `loading` renders nothing yet; `missing` is not found. */
const recordState = ref<'none' | 'loading' | 'found' | 'missing'>('none')
const wantedKey = computed(() => wanted.value && JSON.stringify([wanted.value.collection?.slug, wanted.value.field, wanted.value.key]))
watch(wantedKey, async (current) => {
  record.value = null
  const want = wanted.value
  if (!current || !want) return (recordState.value = 'none')
  // Collections the snapshot does not mark publicRead would only answer 404, so they are not asked.
  if (!want.collection?.publicRead) return (recordState.value = 'missing')
  recordState.value = 'loading'
  const url = `/api/public/${projectSlug.value}/${want.collection.slug}/${encodeURIComponent(want.key)}?field=${encodeURIComponent(want.field)}`
  const result = await $fetch<{ record: DataRecord }>(url).catch(() => null)
  if (current !== wantedKey.value) return
  record.value = result?.record ?? null
  recordState.value = result ? 'found' : 'missing'
}, { immediate: true })
const item = computed(() => (record.value ? bindingItem(record.value) : null))
const shown = computed(() => !!page.value && (!page.value.collection || recordState.value === 'found'))

/** Records loaded per List query (`listKey`), and whether more follow. */
const loaded = shallowRef<Record<string, LoadedList>>({})
const lists = computed(() => Object.fromEntries(Object.entries(loaded.value).map(([key, list]) => [key, list.records])))
/** Load more reads in flight or failed, by `listKey`. */
const moreStatus = ref<Record<string, 'idle' | 'loading' | 'failed'>>({})
const listMore = computed(() => Object.fromEntries(Object.entries(loaded.value).map(([key, list]) => [key, {
  more: list.more,
  loading: moreStatus.value[key] === 'loading',
  failed: moreStatus.value[key] === 'failed'
}])))
// Collections the snapshot does not mark publicRead would only answer 404, so they are not asked.
const queries = computed(() => {
  const readable = new Set(project.value?.collections.filter(c => c.publicRead).map(c => c.slug))
  const all = page.value ? listNodes(resolvePageWithLayout(page.value, project.value?.layouts ?? [], project.value?.components ?? []), project.value?.components).map(node => listQueryOf(node.props)).filter(q => readable.has(q.collection)) : []
  return [...new Map(all.map(q => [listKey(q), q])).values()]
})
watch(queries, async (current) => {
  const entries = await Promise.all(current.map(async (query) => {
    const url = `/api/public/${projectSlug.value}/${query.collection}?${listSearch(query)}`
    const result = await $fetch<ListPage>(url).catch(() => null)
    return result ? [[listKey(query), mergePage(undefined, result)] as const] : []
  }))
  if (current !== queries.value) return
  moreStatus.value = {}
  loaded.value = Object.fromEntries(entries.flat())
}, { immediate: true })

async function loadMore(key: string): Promise<void> {
  const query = queries.value.find(q => listKey(q) === key)
  const before = loaded.value[key]
  if (!query?.loadMore || !before?.more || moreStatus.value[key] === 'loading') return
  moreStatus.value = { ...moreStatus.value, [key]: 'loading' }
  const url = `/api/public/${projectSlug.value}/${query.collection}?${nextPageSearch(query, before)}`
  const page = await $fetch<ListPage>(url).catch(() => null)
  // The page's Lists were read again meanwhile: this page belongs to the old records.
  if (loaded.value[key] !== before) return
  moreStatus.value = { ...moreStatus.value, [key]: page ? 'idle' : 'failed' }
  if (page) loaded.value = { ...loaded.value, [key]: mergePage(before, page) }
}

async function submitForm(collection: string, values: Record<string, string>): Promise<void> {
  try {
    await $fetch(`/api/public/${projectSlug.value}/${collection}`, { method: 'POST', body: { values } })
  } catch (error) {
    const data = (error as { data?: { message?: string } }).data
    throw new Error(data?.message || 'Could not send the form, try again later', { cause: error })
  }
}

useWebMcp(project, page, item)
useTheme(() => project.value?.theme, env)

useHead(() => {
  if (!shown.value || !page.value || !project.value) return { title: recordState.value === 'loading' ? project.value?.name ?? '' : 'Not found' }
  const name = target.value?.key === undefined ? page.value.name : detailTitle(item.value, target.value.key)
  return { title: `${name} · ${project.value.name}` }
})
</script>

<template>
  <BildrPage
    v-if="shown && page"
    :page="page"
    :item="item"
    :base="`/p/${projectSlug}`"
    :lists="lists"
    :list-more="listMore"
    :load-more="loadMore"
    :components="project?.components"
    :layouts="project?.layouts"
    :submit-form="submitForm"
    :env="env"
    missing-env="empty"
    class="min-h-screen"
  />
  <div
    v-else-if="recordState === 'loading'"
    class="min-h-screen"
    data-detail-loading
  />
  <UError
    v-else
    :error="{ statusCode: 404, statusMessage: error ? 'This app has not been published' : 'Page not found' }"
  />
</template>
