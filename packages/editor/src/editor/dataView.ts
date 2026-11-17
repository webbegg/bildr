import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { Row } from '@bildr/codegen/query'
import { createLiveRows } from '../design/liveRows.ts'
import type { Design } from '../design/store.ts'
import type { ConfirmOptions, EditorView } from './useEditor.ts'
import { createDataArtifactView } from './dataArtifactView.ts'
import { tabsOf } from './dataTabs.ts'
import type { DataItem, DataSpecial, DataTab } from './dataTabs.ts'
import { migrationTargets } from './migrationTargets.ts'
import type { CollectionChange, MigrationTargets } from './migrationTargets.ts'
import type { PendingMigration } from '../types.ts'
import { sampleSourceName, sourceFor } from './newCollection.ts'
import type { CollectionStorage } from './newCollection.ts'
import { collectionsOf, connectionsOf, fixtureRowsOf } from '../shared/dataModel.ts'
import type { DataCollection, DataConnection } from '../shared/dataModel.ts'

/**
 * The Data view's state in the adapter (U7): the hosted `collectionId`/`collection`,
 * `connectionId`/`connection`, `recordId` and the shown collection's rows. A collection is an
 * entity and a connection a REST data source (`shared/dataModel.ts`); both are read from the
 * model, so they follow every edit, undo and file change.
 *
 * The rows are not the document's and nothing here writes the app's (E2): they are what the app's
 * generated list route answers (P5's `createLiveRows`), or the entity's fixtures (the Sample
 * data) when it can't or when the Sample data side of the switch is chosen, and are read only
 * while the Data view is open. Only the Sample data is edited (D4, `rowsEditable`, saved by `sampleRows.ts`): the fixtures
 * are `.bildr/` files, written by the module's `fixture_row_*` actions. The switch is the user's choice (`rowsPreference`); the rows
 * shown come from `rowsSource`, which is Sample data too when Live is chosen and the app does
 * not answer (`rowsFallback`: the choice stays Live, so choosing it again retries).
 *
 * The Data workspace (S2) shows one item at a time, a connection, a collection, a query or an action (S10), on one of the
 * tabs its kind has (`dataItem`, `dataTabs`, `dataTab`), or All model files (`dataFiles`, S3) in its place; `editor/dataLocation.ts` mirrors that in
 * the URL. Read the item through `dataCollection` / `dataConnection` / `dataQuery` / `dataAction`, which are narrowed to it. Which
 * query or action is chosen, and how that lives with the other choices, is `editor/dataArtifactView.ts`'s.
 * A query is run over the rows of the collection it reads (`collectionRows` and the rest follow it: the Results tab shows what
 * the collection's Rows tab shows, with the same Live / Sample data switch).
 *
 * Edits that are not saved (`dataDirty`: the raw editor reports a file's, the query Definition its draft, the action Overview a
 * refused text) are not lost silently: every way of moving the workspace (the item, the tab, All model files, the file in it)
 * goes through `leaveData`, which asks first and moves only when the user discards them.
 *
 * The pending migration plan (S6) is the status's (`plan`, which is null without a database): the workspace shows it where the
 * collection is (`dataMigration`, its banner) or as its own item (`dataSpecial` is `migrations`). `planShown` says whether it does,
 * the one place that knows, for the shell, which has a banner of its own for the plan when this does not show it.
 */

/** Where rows come from: the app's list route (Live) or the collection's own (Sample data). */
export type RowsSource = 'live' | 'sample'

export const createDataView = (design: Design, view: Ref<EditorView>, confirm: (options: ConfirmOptions) => Promise<boolean>, plan: Ref<PendingMigration | null>) => {
  const model = design.model
  const collections = computed<DataCollection[]>(() => model.value ? collectionsOf(model.value) : [])
  const connections = computed<DataConnection[]>(() => model.value ? connectionsOf(model.value) : [])

  /**
   * The collection chosen, by id. `collection` (below) is the one place that says which collection is
   * meant when none is chosen or the chosen one is gone: the first. Everything else reads `collection`,
   * or `dataCollection` when it needs the collection the workspace shows.
   */
  const chosenCollection = ref<string | null>(null)
  /** The connection the right panel shows (its folder was clicked); null shows the collection. */
  const chosenConnection = ref<string | null>(null)

  /** The `.bildr/` file whose JSON has edits that are not saved, reported by the raw editor; null when there are none. */
  const dataDirty = ref<string | null>(null)
  /** How many times the user kept their edits instead of leaving: what moved the screen (the URL) is put back. */
  const leaveDeclined = ref(0)
  let deciding: Promise<boolean> | null = null
  /**
   * Moves the workspace with `apply`, after asking the user to discard their unsaved edits when there are some and the move
   * `changes` something. Several moves asked in a row (a collection and no connection) share the one question, and are made in
   * order when it is confirmed, or none is when it is declined. Resolves whether the move was made.
   */
  const leaveData = (apply: () => void, changes = true): Promise<boolean> => {
    if (deciding === null && (dataDirty.value === null || !changes)) {
      apply()
      return Promise.resolve(true)
    }
    deciding ??= confirm({ title: `Discard unsaved changes to ${dataDirty.value}?`, description: 'Cancel keeps what you typed; discarding loses it.', confirmLabel: 'Discard changes', danger: true }).then((ok) => {
      deciding = null
      if (ok) dataDirty.value = null
      else leaveDeclined.value++
      return ok
    })
    return deciding.then((ok) => {
      if (ok) apply()
      return ok
    })
  }

  /**
   * What is shown instead of the item, when something is: All model files (S3) or the pending migration (S6), one at a time. Choosing a
   * collection, a connection, a query or an action, however it is chosen, shows it instead: the choosers clear this (`special.value = null`).
   */
  const special = ref<DataSpecial | null>(null)
  const dataSpecial = computed<DataSpecial | null>(() => special.value)
  /** The setter of a special view's flag: showing it replaces the one shown; hiding it leaves any other as it is. */
  const specialFlag = (name: DataSpecial) => computed<boolean>({
    get: () => special.value === name,
    set: (shown) => {
      void leaveData(() => {
        if (shown) special.value = name
        else if (special.value === name) special.value = null
      }, shown !== (special.value === name))
    }
  })
  /** All model files (S3) is shown instead of the item, and the `.bildr/` file chosen in it. */
  const dataFiles = specialFlag('files')
  /** The pending migration's plan (S6) is shown instead of the item, which keeps its choice. */
  const dataMigrations = specialFlag('migrations')
  const chosenFile = ref<string | null>(null)
  const dataFile = computed<string | null>({
    get: () => chosenFile.value,
    set: (path) => {
      void leaveData(() => (chosenFile.value = path), path !== chosenFile.value)
    }
  })
  /** The query or the action chosen (S10), and the rules of how it lives with the collection and connection chosen: `dataArtifactView.ts`. */
  const { queries, actions, queryId, actionId, artifact, artifactChosen, forgetArtifact, dataQuery, dataAction } = createDataArtifactView(model, leaveData, special)
  const chooser = (chosen: Ref<string | null>) => computed<string | null>({
    get: () => chosen.value,
    set: (id) => {
      void leaveData(() => {
        chosen.value = id
        special.value = null
        if (id !== null) forgetArtifact()
      }, id !== chosen.value || special.value !== null || (id !== null && artifactChosen.value))
    }
  })
  const collectionId = chooser(chosenCollection)
  const connectionId = chooser(chosenConnection)
  /** The row the right panel shows; null shows the collection and its fields. */
  const recordId = ref<string | null>(null)

  const collection = computed<DataCollection | null>(() => collections.value.find(entry => entry.id === collectionId.value) ?? collections.value[0] ?? null)
  const connection = computed<DataConnection | null>(() => connections.value.find(entry => entry.id === connectionId.value) ?? null)

  /** The item the workspace shows: the query or action chosen, else the connection chosen, else the collection. */
  const dataItem = computed<DataItem | null>(() => artifact.value ?? (connection.value
    ? { kind: 'connection', id: connection.value.id }
    : collection.value ? { kind: 'collection', id: collection.value.id } : null))
  /** The item the workspace shows in its own right: `dataItem`, unless All model files or the pending migration is shown instead. */
  const dataShown = computed<DataItem | null>(() => special.value === null ? dataItem.value : null)
  /** The shown item, narrowed: the collection when a collection is shown, else null. */
  const dataCollection = computed<DataCollection | null>(() => dataItem.value?.kind === 'collection' ? collection.value : null)
  /** The shown item, narrowed: the connection when a connection is shown, else null. */
  const dataConnection = computed<DataConnection | null>(() => dataItem.value?.kind === 'connection' ? connection.value : null)
  /** What the pending plan does and loses, in the collections' words (S6); null with no plan (or without a database). */
  const dataPlan = computed<MigrationTargets | null>(() => plan.value ? migrationTargets(model.value, plan.value) : null)
  /** What the plan does to the collection shown (its banner), when it changes it and the collection is what the workspace shows. */
  const dataMigration = computed<CollectionChange | null>(() => {
    const shown = special.value === null ? dataCollection.value : null
    return shown && dataPlan.value ? dataPlan.value.collections[shown.id] ?? null : null
  })
  /** The workspace shows the plan itself: a collection's banner, or the Migrations item. */
  const planShown = computed(() => plan.value !== null && model.value !== null && (dataMigration.value !== null || special.value === 'migrations'))
  const dataTabs = computed<DataTab[]>(() => dataItem.value ? tabsOf(dataItem.value.kind) : [])
  const chosenTab = ref<DataTab>('rows')
  /** The tab shown: the one chosen when the item has it, else the item's first. Choosing keeps the choice for the next item that has it. */
  const dataTab = computed<DataTab>({
    get: () => dataTabs.value.includes(chosenTab.value) ? chosenTab.value : dataTabs.value[0] ?? chosenTab.value,
    set: (tab) => {
      void leaveData(() => (chosenTab.value = tab), tab !== dataTab.value)
    }
  })
  /** The user's choice: Live shows the app's rows when it answers; Sample data shows the entity's fixtures (a REST collection has none). */
  const rowsPreference = ref<RowsSource>('live')

  /** The collection whose rows are read: the one a query shown reads, else the collection shown. */
  const rowsCollection = computed<DataCollection | null>(() => dataQuery.value ? collections.value.find(entry => entry.id === dataQuery.value!.from) ?? null : collection.value)
  const needed = computed<string[]>(() => view.value === 'data' && rowsCollection.value ? [rowsCollection.value.id] : [])
  const live = createLiveRows(model, needed)

  const fixtures = computed<Row[]>(() => model.value && rowsCollection.value ? fixtureRowsOf(model.value, rowsCollection.value.id) : [])
  const sampleChosen = computed(() => rowsPreference.value === 'sample' && rowsCollection.value?.kind !== 'rest')
  /** Whether the rows shown can be edited: Sample data is chosen (a REST collection has none, and Live is the app's, E2). */
  const rowsEditable = computed(() => sampleChosen.value)
  const answered = computed<Row[] | undefined>(() => rowsCollection.value ? live.rows.value[rowsCollection.value.id] : undefined)
  /** Where the rows shown come from: the app's when it answered (and Live is chosen), else the fixtures. */
  const rowsSource = computed<RowsSource>(() => !sampleChosen.value && answered.value ? 'live' : 'sample')
  /** Live is chosen but the app has not answered (or failed), so the rows shown are the sample data: said beside the switch, which stays on Live. */
  const rowsFallback = computed(() => rowsPreference.value === 'live' && rowsCollection.value?.kind !== 'rest' && rowsSource.value === 'sample' && !live.loading.value)
  const collectionRows = computed<Row[]>(() => rowsSource.value === 'live' ? answered.value ?? [] : fixtures.value)
  /** Why the app's rows could not be read, `''` when they were (or were not asked for yet, or Sample data was chosen). */
  const recordsError = computed(() => (!sampleChosen.value && rowsCollection.value && live.reasons.value[rowsCollection.value.id]) || '')
  const recordsTotal = computed(() => collectionRows.value.length)

  /**
   * The rows each collection has in the source chosen: with Live, the app's once read, else its fixtures; with
   * Sample data, its fixtures. A REST entity has no fixtures: it has the app's once read, whatever is chosen.
   */
  const collectionCounts = computed<Record<string, number>>(() => Object.fromEntries(collections.value.flatMap((entry) => {
    const read = entry.kind === 'rest' || rowsPreference.value === 'live' ? live.rows.value[entry.id] : undefined
    if (read) return [[entry.id, read.length]]
    return entry.kind === 'rest' || !model.value ? [] : [[entry.id, fixtureRowsOf(model.value, entry.id).length]]
  })))

  const reloadRecords = () => live.refresh()

  /**
   * A new collection (S7): an entity with one text field, `title`, over where the user said its rows live: the app's database,
   * or Sample data, which is the memory source the project has, else one named "sample" ("sample-2"… while the name is taken)
   * made first. Nothing is chosen for the user: Database with no database makes nothing and says so. Shows it; returns its id.
   * A source made for it that the entity then refuses is removed again, and the refusal stays; when it cannot be removed either
   * the message says so, after the refusal, so no orphan is left silently.
   */
  const createCollection = async ({ name, storage }: { name: string, storage: CollectionStorage }): Promise<string | undefined> => {
    const current = model.value
    if (!current) return undefined
    let source = sourceFor(current, storage.kind)?.id
    let madeSource = false
    if (!source && storage.kind === 'database') {
      design.error.value = 'This project has no database to keep the rows in. Choose Sample data or a REST API.'
      return undefined
    }
    if (!source) {
      const made = await design.edit('datasource_create', { name: sampleSourceName(current), kind: 'memory' })
      source = made?.datasourceId as string | undefined
      if (!source) return undefined
      madeSource = true
    }
    const created = await design.edit('entity_create', { name, source, fields: [{ name: 'title', type: 'text' }] })
    const id = created?.entityId as string | undefined
    if (id) {
      collectionId.value = id
      connectionId.value = null
    } else if (madeSource) {
      // The source was made for this collection: no orphan is left behind, and the refusal that explains it stays.
      const refusal = design.error.value ?? 'Could not create the collection'
      const removed = await design.edit('datasource_delete', { datasource: source })
      design.error.value = removed ? refusal : `${refusal.replace(/[.\s]+$/, '')}. Could not remove the source made for it: ${design.error.value ?? 'unknown error'}`
    }
    return id
  }

  // An open row is one of the rows shown: another collection, or the user switching source, shows other rows. The app
  // answering late is not a switch: a row it does not have simply has no panel (DataPanel finds no row).
  watch([() => rowsCollection.value?.id, rowsPreference], () => {
    recordId.value = null
  })
  // The app regenerated (its data layer may have changed, and the dev server may still be restarting).
  watch(() => design.regenerated.value, () => {
    if (view.value === 'data') void live.refresh()
  })

  return { collections, connections, queries, actions, queryId, actionId, dataQuery, dataAction, collectionId, connectionId, dataSpecial, dataShown, dataFiles, dataMigrations, dataPlan, dataMigration, planShown, dataFile, dataDirty, leaveData, leaveDeclined, recordId, collection, connection, dataItem, dataCollection, dataConnection, dataTabs, dataTab, rowsPreference, rowsEditable, collectionRows, rowsSource, rowsFallback, recordsError, recordsTotal, recordsLoading: live.loading, collectionCounts, reloadRecords, createCollection }
}
