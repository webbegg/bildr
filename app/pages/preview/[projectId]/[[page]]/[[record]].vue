<script setup lang="ts">
import type { DataRecord } from '#shared/data/records'
import type { Project } from '#shared/document/schema'
import type { EnvListEntry, EnvValues } from '#shared/env/variables'
import { formSubmitRequest } from '#shared/editor/formSubmit'
import { bindingItem } from '#shared/runtime/bindings'
import { detailTitle, resolvePageRoute } from '#shared/runtime/detail'
import { resolvePageWithLayout } from '#shared/runtime/layouts'
import { listKey, listNodes, listQueryOf, listRecords } from '#shared/runtime/list'
import { listSlice, mergePage } from '#shared/runtime/loadMore'
import type { ListPage, LoadedList } from '#shared/runtime/loadMore'

/**
 * The draft preview the editor's Preview button opens: the project as it is
 * now, unpublished edits included, rendered by the shared runtime with its
 * theme, so links and layout behave as they will once published. It reads
 * through the editor's actions (`project_get`, `record_list`), so like the
 * editor it is same-origin only. Lists show the collections' records as the
 * canvas does. The draft has no public endpoint, so Forms add their record
 * with `record_create` (any collection, not only `publicCreate` ones).
 * `{{ env.NAME }}` resolves from the public variables (`env_list`), and a
 * missing one shows as written, as in the canvas.
 * A detail page (`/preview/<id>/<page>/<key>`) finds its record with
 * `record_find` (any collection, publicRead or not) and renders with it as
 * the page item; a missing key or record shows not found, as published.
 * A List with `loadMore` grows its slice of the records read by `limit` a
 * click; past them, it reads the collection's next 500 with `record_list`.
 */
definePageMeta({ layout: false })

const route = useRoute()
const projectId = computed(() => String(route.params.projectId))
const project = shallowRef<Project | null>(null)
const loadError = ref<string | null>(null)
const env = shallowRef<EnvValues>({})

const segment = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
const target = computed(() => resolvePageRoute(project.value?.pages ?? [], segment(route.params.page), segment(route.params.record)))
const page = computed(() => target.value?.page)

const record = shallowRef<DataRecord | null>(null)
/** `loading` renders nothing yet; `missing` is not found. */
const recordState = ref<'none' | 'loading' | 'found' | 'missing'>('none')
const wantedKey = computed(() => {
  const ref = page.value?.collection
  return ref && target.value?.key !== undefined ? JSON.stringify([ref.slug, ref.field ?? null, target.value.key]) : undefined
})
watch(wantedKey, async (current) => {
  record.value = null
  const ref = page.value?.collection
  const key = target.value?.key
  if (!current || !ref || key === undefined) return (recordState.value = 'none')
  recordState.value = 'loading'
  const found = await callAction<DataRecord>('record_find', { projectId: projectId.value, collection: ref.slug, ...(ref.field ? { field: ref.field } : {}), value: key }).catch(() => null)
  if (current !== wantedKey.value) return
  record.value = found
  recordState.value = found ? 'found' : 'missing'
}, { immediate: true })
const item = computed(() => (record.value ? bindingItem(record.value) : null))
const shown = computed(() => !!page.value && (!page.value.collection || recordState.value === 'found'))

/** Records of each collection a List on the page shows, by collection id (the first 500, as in the canvas, then more for Load more). */
const collectionRecords = shallowRef<Record<string, LoadedList>>({})
/** How many records each Load more List shows (`listKey` → count; its limit until clicked). */
const shownCount = ref<Record<string, number>>({})
/** Collections whose next records are being read, or whose read failed, by id. */
const readStatus = ref<Record<string, 'idle' | 'loading' | 'failed'>>({})
const READ_PAGE = 500
/** The queries of the Lists on the page, by `listKey`. */
const listQueries = computed(() => {
  const nodes = page.value ? listNodes(resolvePageWithLayout(page.value, project.value?.layouts ?? [], project.value?.components ?? []), project.value?.components) : []
  return new Map(nodes.map(node => listQueryOf(node.props)).map(query => [listKey(query), query]))
})
const listCollections = computed(() => {
  const slugs = new Set([...listQueries.value.values()].map(query => query.collection))
  return project.value?.collections.filter(c => slugs.has(c.slug)) ?? []
})
const shownLists = computed(() => {
  const out: Record<string, { records: DataRecord[], more?: ListMoreState }> = {}
  for (const [key, query] of listQueries.value) {
    const shown = listCollections.value.find(c => c.slug === query.collection)
    const read = shown && collectionRecords.value[shown.id]
    if (!shown) continue
    if (!query.loadMore) {
      out[key] = { records: listRecords(shown, read?.records ?? [], query) }
      continue
    }
    const slice = listSlice(shown, read?.records ?? [], query, shownCount.value[key] ?? query.limit)
    const status = readStatus.value[shown.id]
    out[key] = { records: slice.records, more: { more: slice.more || !!read?.more, loading: status === 'loading', failed: status === 'failed' } }
  }
  return out
})
const lists = computed(() => Object.fromEntries(Object.entries(shownLists.value).map(([key, list]) => [key, list.records])))
const listMore = computed(() => Object.fromEntries(Object.entries(shownLists.value).flatMap(([key, list]) => (list.more ? [[key, list.more]] : []))))

watch(listCollections, async (current) => {
  const entries = await Promise.all(current.map(async (c) => {
    const result = await callAction<ListPage>('record_list', { projectId: projectId.value, collection: c.id, limit: READ_PAGE }).catch(() => null)
    return result ? [[c.id, mergePage(undefined, result)] as const] : []
  }))
  if (current !== listCollections.value) return
  shownCount.value = {}
  readStatus.value = {}
  collectionRecords.value = Object.fromEntries(entries.flat())
})

async function loadMore(key: string): Promise<void> {
  const query = listQueries.value.get(key)
  const collection = query && listCollections.value.find(c => c.slug === query.collection)
  if (!query?.loadMore || !collection || readStatus.value[collection.id] === 'loading') return
  const count = (shownCount.value[key] ?? query.limit) + query.limit
  shownCount.value = { ...shownCount.value, [key]: count }
  const before = collectionRecords.value[collection.id]
  // The records read cover the grown slice, or there are no more to read.
  if (!before?.more || listSlice(collection, before.records, query, count).records.length >= count) return
  readStatus.value = { ...readStatus.value, [collection.id]: 'loading' }
  const page = await callAction<ListPage>('record_list', { projectId: projectId.value, collection: collection.id, limit: READ_PAGE, offset: before.records.length }).catch(() => null)
  if (collectionRecords.value[collection.id] !== before) return
  readStatus.value = { ...readStatus.value, [collection.id]: page ? 'idle' : 'failed' }
  if (page) collectionRecords.value = { ...collectionRecords.value, [collection.id]: mergePage(before, page) }
}

watch(projectId, async (id) => {
  try {
    const [next, listed] = await Promise.all([
      callAction<Project>('project_get', { projectId: id }),
      callAction<{ variables: EnvListEntry[] }>('env_list', { projectId: id })
    ])
    env.value = listedPublicEnv(listed.variables)
    project.value = next
  } catch (error) {
    loadError.value = actionErrorMessage(error)
  }
}, { immediate: true })

async function submitForm(collection: string, values: Record<string, string>): Promise<void> {
  const request = formSubmitRequest({ kind: 'draft', projectId: projectId.value }, collection, values)
  try {
    if (request.via === 'action') await callAction(request.name, request.input)
    else await $fetch(request.url, { method: 'POST', body: request.body })
  } catch (error) {
    throw new Error(actionErrorMessage(error), { cause: error })
  }
}

useTheme(() => project.value?.theme, env)

const badgeStyle = {
  position: 'fixed', top: '12px', right: '12px', zIndex: 50, pointerEvents: 'none',
  padding: '4px 10px', borderRadius: '9999px', background: 'rgba(28, 28, 28, 0.88)', color: '#fff',
  font: '500 12px/16px Inter, system-ui, sans-serif', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)'
} as const

useHead(() => {
  if (!shown.value || !page.value || !project.value) return { title: 'Draft preview' }
  const name = target.value?.key === undefined ? page.value.name : detailTitle(item.value, target.value.key)
  return { title: `${name} · ${project.value.name} (draft)` }
})
</script>

<template>
  <div v-if="shown && page && project">
    <BildrPage
      :page="page"
      :item="item"
      :base="`/preview/${projectId}`"
      :lists="lists"
      :list-more="listMore"
      :load-more="loadMore"
      :components="project.components"
      :layouts="project.layouts"
      :submit-form="submitForm"
      :env="env"
      missing-env="keep"
      class="min-h-screen"
    />
    <!-- Editor chrome, so fixed values: the project theme redefines the spacing scale and the neutral palette. -->
    <div
      :style="badgeStyle"
      data-draft-badge
    >
      Draft preview
    </div>
  </div>
  <div
    v-else-if="recordState === 'loading'"
    class="min-h-screen"
    data-detail-loading
  />
  <UError
    v-else-if="loadError || project"
    :error="{ statusCode: 404, statusMessage: loadError ?? 'Page not found' }"
  />
</template>
