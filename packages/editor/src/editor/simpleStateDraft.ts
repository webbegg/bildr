import type { StateFile } from '@bildr/codegen/model'
import type { StatePersist } from '../shared/dataArtifacts.ts'
import { sameJson } from './draftJson.ts'
import { changedOutside as fieldsChangedOutside, changesOf, draftOf, rebaseDraft } from './stateDraft.ts'
import type { StateDraft } from './stateDraft.ts'

/**
 * The simple Data section's store form's draft (simple data, S3): a state's fields (`stateDraft.ts`, which owns how a field is held,
 * converted and refused) and how long it keeps its values, as one draft: one Save, one Discard. Saving is one `state_update` with what
 * changed: the whole list of fields when any field did, `persist` when it did. The module checks the rest and says which field a
 * refusal is about (`fieldOfRefusal`).
 */

export interface StoreDraft extends StateDraft {
  persist: StatePersist
}

/** The draft of a state as it is now. */
export const storeDraftOf = (state: StateFile): StoreDraft => ({ ...draftOf(state), persist: state.persist })

/** Whether the draft has edits, judged against the state it started from. */
export const storeDirty = (draft: StoreDraft, saved: StateFile): boolean => !sameJson(draft, storeDraftOf(saved))

/** Whether the state as stored now differs from the one the draft started from in a part the form edits. */
export const storeChangedOutside = (base: StateFile, stored: StateFile): boolean => base.persist !== stored.persist || fieldsChangedOutside(base, stored)

/** The draft after the user chose to keep their edits over a store that changed under them: what they did not touch shows the stored one's. */
export function storeRebase(draft: StoreDraft, base: StateFile, stored: StateFile): StoreDraft {
  return { fields: rebaseDraft({ fields: draft.fields }, base, stored).fields, persist: draft.persist !== base.persist ? draft.persist : stored.persist }
}

export interface StoreChanges {
  /** The `state_update` input besides the state's id; null when nothing changed or the draft can't be sent. */
  input: Record<string, unknown> | null
  /** What stops the draft from being sent. */
  problems: string[]
}

/** What saving `draft` asks of the module, or the problems that stop it. `base` is the state the draft started from. */
export function storeChangesOf(draft: StoreDraft, base: StateFile): StoreChanges {
  const { fields, problems } = changesOf({ fields: draft.fields }, base)
  if (problems.length) return { input: null, problems }
  const input = { ...(fields ? { fields } : {}), ...(draft.persist !== base.persist ? { persist: draft.persist } : {}) }
  return { input: Object.keys(input).length ? input : null, problems: [] }
}
