import { entityUsesOf, fieldUsesIndex, fieldUsesOf, stateFieldUsesIndex, stateFieldUsesOf } from '@bildr/codegen/edit'
import type { Model } from '@bildr/codegen/model'
import { useEntries } from './dataArtifacts.ts'
import type { UseEntry } from './dataArtifacts.ts'

/**
 * Who uses a collection and a field, in the words the Data workspace shows: the module's usage index (`entityUsesOf`, `fieldUsesIndex`:
 * the list a delete or a rename is refused with) with one entry for each place and a sentence for each way it uses it (`usageSentences.ts`).
 * Pure reads, like `dataArtifacts.ts` next to it, whose `UseEntry` they share.
 *
 * A place that the module changes along with the collection or the field (`follows`: the collection's own actions, an action's
 * pick of a field) is listed but not counted: only the others are "used in N places", and only they stop a delete or a rename.
 */

/** `Used in 3 places`. */
export const usedInWords = (count: number): string => `Used in ${count} ${count === 1 ? 'place' : 'places'}`

/** `it` for one place, `them` for more: "change them first". */
export const them = (count: number): string => count === 1 ? 'it' : 'them'

/** The entries the module does not change by itself: the places that count, and that stop a delete or a rename of a field. */
export const blockingUses = (entries: UseEntry[]): UseEntry[] => entries.filter(entry => !entry.follows)

/** Who uses collection `entityId`: the pages that read its queries and run its actions, its lists, forms and actions. */
export const collectionUses = (model: Model | null, entityId: string): UseEntry[] =>
  model ? useEntries(model, entityUsesOf(model, entityId), { kind: 'collection' }) : []

/** Who uses each field of collection `entityId`, by field name, from one pass over the model (the codegen's `fieldUsesIndex`, in words). */
export const fieldUsesByName = (model: Model | null, entityId: string): Map<string, UseEntry[]> => {
  if (!model) return new Map()
  return new Map([...fieldUsesIndex(model, entityId)].map(([name, uses]) => [name, useEntries(model, uses, { kind: 'field', name })]))
}

/** Who uses each field of state `stateId`, by field name, from one pass over the model (`stateFieldUsesIndex`, in words). */
export const stateFieldUsesByName = (model: Model | null, stateId: string): Map<string, UseEntry[]> => {
  if (!model) return new Map()
  return new Map([...stateFieldUsesIndex(model, stateId)].map(([name, uses]) => [name, useEntries(model, uses, { kind: 'stateField', name })]))
}

/** Who uses field `name` of state `stateId` (the pages that bind it, the steps that set it), for the one field a change asks about. */
export const stateFieldUses = (model: Model | null, stateId: string, name: string): UseEntry[] =>
  model ? useEntries(model, stateFieldUsesOf(model, stateId, name), { kind: 'stateField', name }) : []

/** Who uses field `name` of collection `entityId`, for the one field a change asks about (the codegen's `fieldUsesOf`). */
export const fieldUses = (model: Model | null, entityId: string, name: string): UseEntry[] =>
  model ? useEntries(model, fieldUsesOf(model, entityId, name), { kind: 'field', name }) : []
