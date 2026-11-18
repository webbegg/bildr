import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { ActionFile, Model, QueryFile, StateFile } from '@bildr/codegen/model'
import type { ArtifactKind } from '../shared/dataArtifacts.ts'
import { actionsOf, queriesOf, statesOf } from '../shared/dataModel.ts'
import type { DataArtifact } from '../shared/dataModel.ts'
import type { DataItem, DataSpecial } from './dataTabs.ts'

/**
 * Which query, action or state the Data workspace shows (S10, B2): the "artifact" of `dataView.ts`, composed there. A query, an action or
 * a state is chosen like a collection or a connection, and the four rules of how they live together are these, all of them here:
 *
 * 1. **One item at a time.** The artifact chosen is shown instead of the collection or connection, which keep their own choice
 *    until one of them is chosen again (`dataView` shows the artifact first, else the connection, else the collection).
 * 2. **Choosing moves the others out of the way.** Choosing a collection, a connection or All model files un-chooses the
 *    artifact (`forgetArtifact`, which the others' choosers call); choosing an artifact closes All model files.
 * 3. **An artifact the model no longer has is not shown, and is forgotten.** Deleted here or elsewhere, it falls back to the
 *    collection, and one made later with the same id is not shown by surprise.
 * 4. **Every choice goes through `leaveData`.** With edits that are not saved it asks first, and moves only when they are
 *    given up; choosing what is shown already asks nothing.
 */

/** The workspace's guard over unsaved edits (`dataView.ts`): `apply` runs when the move is made; `changes` is whether it moves anything. */
export type LeaveData = (apply: () => void, changes?: boolean) => Promise<boolean>

export const createDataArtifactView = (model: Ref<Model | null>, leaveData: LeaveData, special: Ref<DataSpecial | null>) => {
  /** The queries, the actions and the states of the model, as the tree lists them. */
  const queries = computed<DataArtifact[]>(() => model.value ? queriesOf(model.value) : [])
  const actions = computed<DataArtifact[]>(() => model.value ? actionsOf(model.value) : [])
  const states = computed<DataArtifact[]>(() => model.value ? statesOf(model.value) : [])
  const listOf = (kind: ArtifactKind) => kind === 'query' ? queries : kind === 'action' ? actions : states

  const chosen = ref<DataItem | null>(null)

  const chooser = (kind: ArtifactKind) => computed<string | null>({
    get: () => chosen.value?.kind === kind ? chosen.value.id : null,
    set: (id) => {
      const current = chosen.value?.kind === kind ? chosen.value.id : null
      void leaveData(() => {
        if (id !== null) chosen.value = { kind, id }
        else if (current !== null) chosen.value = null
        special.value = null
      }, id !== current || special.value !== null)
    }
  })
  const queryId = chooser('query')
  const actionId = chooser('action')
  const stateId = chooser('state')

  /** The query, action or state chosen, when the model still has it (rule 3). */
  const artifact = computed<DataItem | null>(() => {
    const item = chosen.value
    return item && (item.kind === 'query' || item.kind === 'action' || item.kind === 'state') && listOf(item.kind).value.some(entry => entry.id === item.id) ? item : null
  })
  watch(() => model.value !== null && chosen.value !== null && artifact.value === null, (gone) => {
    if (gone) chosen.value = null
  })

  const fileOf = <T extends QueryFile | ActionFile | StateFile>(kind: 'queries' | 'actions' | 'state', id: string): T | null =>
    (Object.values(model.value?.modules ?? {}).flatMap(mod => mod[kind] as T[]).find(entry => entry.id === id)) ?? null
  /** The query's file when a query is shown, else null. */
  const dataQuery = computed<QueryFile | null>(() => artifact.value?.kind === 'query' ? fileOf<QueryFile>('queries', artifact.value.id) : null)
  /** The action's file when an action is shown, else null. */
  const dataAction = computed<ActionFile | null>(() => artifact.value?.kind === 'action' ? fileOf<ActionFile>('actions', artifact.value.id) : null)
  /** The state's file when a state is shown, else null. */
  const dataState = computed<StateFile | null>(() => artifact.value?.kind === 'state' ? fileOf<StateFile>('state', artifact.value.id) : null)

  return {
    queries,
    actions,
    states,
    queryId,
    actionId,
    stateId,
    /** The query, action or state shown, else null. */
    artifact,
    /** Whether one is chosen (the collection and connection choosers ask: choosing theirs moves the move through `leaveData` too). */
    artifactChosen: computed(() => chosen.value !== null),
    /** Rule 2: a collection or a connection was chosen. Runs inside the choice's `leaveData`. */
    forgetArtifact: () => {
      chosen.value = null
    },
    dataQuery,
    dataAction,
    dataState
  }
}
