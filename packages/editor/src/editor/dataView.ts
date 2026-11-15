import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { Row } from '@bildr/codegen/query'
import { createLiveRows } from '../design/liveRows.ts'
import type { Design } from '../design/store.ts'
import type { EditorView } from './useEditor.ts'
import { collectionsOf, connectionsOf, defaultSourceOf, fixtureRowsOf } from '../shared/dataModel.ts'
import type { DataCollection, DataConnection } from '../shared/dataModel.ts'

/**
 * The Data view's state in the adapter (U7): the hosted `collectionId`/`collection`,
 * `connectionId`/`connection`, `recordId` and the shown collection's rows. A collection is an
 * entity and a connection a REST data source (`shared/dataModel.ts`); both are read from the
 * model, so they follow every edit, undo and file change.
 *
 * The rows are not the document's and nothing writes them (E2): they are what the app's
 * generated list route answers (P5's `createLiveRows`), or the entity's fixtures when it
 * can't, and are read only while the Data view is open.
 */
export const createDataView = (design: Design, view: Ref<EditorView>) => {
  const model = design.model
  const collections = computed<DataCollection[]>(() => model.value ? collectionsOf(model.value) : [])
  const connections = computed<DataConnection[]>(() => model.value ? connectionsOf(model.value) : [])

  /** The collection the Data view shows (the first when none is chosen or the chosen one is gone). */
  const collectionId = ref<string | null>(null)
  /** The connection the right panel shows (its folder was clicked); null shows the collection. */
  const connectionId = ref<string | null>(null)
  /** The row the right panel shows; null shows the collection and its fields. */
  const recordId = ref<string | null>(null)

  const collection = computed<DataCollection | null>(() => collections.value.find(entry => entry.id === collectionId.value) ?? collections.value[0] ?? null)
  const connection = computed<DataConnection | null>(() => connections.value.find(entry => entry.id === connectionId.value) ?? null)

  const needed = computed<string[]>(() => view.value === 'data' && collection.value ? [collection.value.id] : [])
  const live = createLiveRows(model, needed)

  const fixtures = computed<Row[]>(() => model.value && collection.value ? fixtureRowsOf(model.value, collection.value.id) : [])
  /** The app's rows when it answered, else the fixtures. */
  const collectionRows = computed<Row[]>(() => (collection.value && live.rows.value[collection.value.id]) || fixtures.value)
  const rowsSource = computed<'live' | 'fixtures'>(() => collection.value && collection.value.id in live.rows.value ? 'live' : 'fixtures')
  /** Why the app's rows could not be read, `''` when they were (or were not asked for yet). */
  const recordsError = computed(() => (collection.value && live.reasons.value[collection.value.id]) || '')
  const recordsTotal = computed(() => collectionRows.value.length)

  /** The rows each collection has: the app's once read, else its fixtures; a REST entity has none until read. */
  const collectionCounts = computed<Record<string, number>>(() => Object.fromEntries(collections.value.flatMap((entry) => {
    const read = live.rows.value[entry.id]
    if (read) return [[entry.id, read.length]]
    return entry.kind === 'rest' || !model.value ? [] : [[entry.id, fixtureRowsOf(model.value, entry.id).length]]
  })))

  const reloadRecords = () => live.refresh()

  /**
   * A new collection (the hosted `collection_create { name }`): an entity with one text field, `title`, over the
   * app's database, else a memory data source (made first when the project has none). Shows it; returns its id.
   */
  const createCollection = async (name: string): Promise<string | undefined> => {
    const current = model.value
    if (!current) return undefined
    let source = defaultSourceOf(current)?.id
    if (!source) {
      const made = await design.edit('datasource_create', { name: 'memory', kind: 'memory' })
      source = made?.datasourceId as string | undefined
      if (!source) return undefined
    }
    const created = await design.edit('entity_create', { name, source, fields: [{ name: 'title', type: 'text' }] })
    const id = created?.entityId as string | undefined
    if (id) {
      collectionId.value = id
      connectionId.value = null
    }
    return id
  }

  watch(() => collection.value?.id, () => {
    recordId.value = null
  })
  // The app regenerated (its data layer may have changed, and the dev server may still be restarting).
  watch(() => design.regenerated.value, () => {
    if (view.value === 'data') void live.refresh()
  })

  return { collections, connections, collectionId, connectionId, recordId, collection, connection, collectionRows, rowsSource, recordsError, recordsTotal, recordsLoading: live.loading, collectionCounts, reloadRecords, createCollection }
}
