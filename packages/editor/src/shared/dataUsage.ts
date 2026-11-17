import { entityUsesOf, fieldUsesIndex } from '@bildr/codegen/edit'
import type { ArtifactUse } from '@bildr/codegen/edit'
import type { Model, ModelNode } from '@bildr/codegen/model'
import { usageKey } from './dataArtifacts.ts'
import type { UseEntry } from './dataArtifacts.ts'

/**
 * Who uses a collection and a field (S5), in the words the Data workspace shows: the module's usage index (`entityUsesOf`,
 * `fieldUsesIndex`, the list a delete or a rename is refused with) with one entry for each place and a sentence for each way it
 * uses it. Pure reads, like `dataArtifacts.ts` next to it, whose `UseEntry` and `usageKey` they share.
 *
 * A place that the module changes along with the collection or the field (`follows`: the collection's own actions, an action's
 * pick of a field) is listed but not counted: only the others are "used in N places", and only they stop a delete or a rename.
 */

/** `Used in 3 places`. */
export const usedInWords = (count: number): string => `Used in ${count} ${count === 1 ? 'place' : 'places'}`

/** The entries the module does not change by itself: the places that count, and that stop a delete or a rename of a field. */
export const outsideOf = (entries: UseEntry[]): UseEntry[] => entries.filter(entry => !entry.follows)

const labelOf = (model: Model, id: string | undefined): string => {
  if (!id) return ''
  const modules = Object.values(model.modules)
  const item = [...modules.flatMap(mod => mod.queries), ...modules.flatMap(mod => mod.actions)].find(entry => entry.id === id)
  return item ? item.label || item.name : id
}

const isAction = (model: Model, id: string | undefined): boolean => !!id && Object.values(model.modules).some(mod => mod.actions.some(action => action.id === id))

const findNode = (node: ModelNode, id: string): ModelNode | undefined => node.id === id ? node : node.children?.map(child => findNode(child, id)).find(Boolean)

/** The type of node `nodeId` of the page, component or layout `ownerId`, when the model has it. */
const nodeTypeOf = (model: Model, ownerId: string, nodeId: string | undefined): string | undefined => {
  if (!nodeId) return undefined
  const owners = [...Object.values(model.modules).flatMap(mod => [...mod.pages, ...mod.components]), ...model.layouts]
  const owner = owners.find(entry => entry.id === ownerId)
  return owner ? findNode(owner.root, nodeId)?.type : undefined
}

/** Whether page `pageId` reads query `queryId` with a route parameter: it shows one row per route, a detail page. */
const readsByRoute = (model: Model, pageId: string, queryId: string | undefined): boolean => {
  const page = Object.values(model.modules).flatMap(mod => mod.pages).find(entry => entry.id === pageId)
  return !!page?.params?.length && (page.uses?.queries ?? []).some(use => use.query === queryId
    && Object.values(use.args ?? {}).some(value => typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).$route === 'string'))
}

const quoted = (name: string | undefined) => name ? ` as “${name}”` : ''

/** One way a place uses a collection, as a sentence. */
const collectionSentence = (model: Model, use: ArtifactUse): string => {
  const at = use.node ?? use.where
  const through = labelOf(model, use.by)
  switch (use.via) {
    case 'uses':
      if (!use.by) return `Uses it${quoted(use.as)}`
      return `${isAction(model, use.by) ? 'Runs' : readsByRoute(model, use.id, use.by) ? 'Detail page: reads' : 'Reads'} “${through}”${quoted(use.as)}`
    case 'bind': return use.where === 'computed' ? `A computed value reads “${use.as}”` : use.where === 'seo' ? `The SEO fields show “${use.as}”` : `${at} shows “${use.as}”`
    case 'list': return `${at} lists its rows${quoted(use.as)}`
    case 'form': return `The form ${at} runs “${through}”`
    case 'interaction': return `${at} runs “${through}” on an interaction`
    case 'field': return nodeTypeOf(model, use.id, use.node) === 'Form' ? `The form ${at} holds it among its fields` : `${at} is a form field for it`
    case 'properties': return 'Has a property for it'
    case 'param': return 'Checks a route parameter with it'
    case 'props': return `${at} has it in its properties`
    case 'input': return 'Takes it as its input'
    case 'output': return 'Returns it'
    case 'step': return 'Writes to it in its steps'
    default: return `Mentions it in its ${use.where}`
  }
}

/** One way a place uses a field, as a sentence. */
const fieldSentence = (use: ArtifactUse, field: string, model: Model): string => {
  const at = use.node ?? use.where
  switch (use.via) {
    case 'bind': return use.where === 'computed' ? `A computed value reads “${use.as}.${field}”` : use.where === 'seo' ? `The SEO fields show “${use.as}.${field}”` : `${at} shows “${use.as}.${field}”`
    case 'where': return 'Filters by it'
    case 'orderBy': return 'Sorts by it'
    case 'pick': return 'Takes it as input'
    case 'set': return 'Sets it in its steps'
    case 'step': return 'Reads it in its steps'
    case 'errors': return 'Names it in an error message'
    case 'field': return nodeTypeOf(model, use.id, use.node) === 'Form' ? `The form ${at} holds it among its fields` : `${at} is a form field for it`
    case 'param': return 'Checks a route parameter with it'
    case 'properties': return 'Has a property for it'
    default: return `Mentions it in its ${use.where}`
  }
}

/** One entry for each place, each way it uses it once, in the order the module gives them. */
const entriesOf = (uses: ArtifactUse[], say: (use: ArtifactUse) => string): UseEntry[] => {
  const places = new Map<string, UseEntry>()
  const followers = new Map<string, boolean>()
  for (const use of uses) {
    const key = usageKey(use)
    const entry = places.get(key) ?? { kind: use.kind, id: use.id, name: use.name, what: [] }
    const what = say(use)
    if (!entry.what.includes(what)) entry.what.push(what)
    places.set(key, entry)
    followers.set(key, (followers.get(key) ?? true) && !!use.follows)
  }
  for (const [key, entry] of places) if (followers.get(key)) entry.follows = true
  return [...places.values()]
}

/** Who uses collection `entityId`: the pages that read its queries and run its actions, its lists, forms and actions. */
export const collectionUses = (model: Model | null, entityId: string): UseEntry[] =>
  model ? entriesOf(entityUsesOf(model, entityId), use => collectionSentence(model, use)) : []

/** Who uses each field of collection `entityId`, by field name, from one scan of the model. */
export const fieldUseIndex = (model: Model | null, entityId: string): Map<string, UseEntry[]> => {
  if (!model) return new Map()
  return new Map([...fieldUsesIndex(model, entityId)].map(([field, uses]) => [field, entriesOf(uses, use => fieldSentence(use, field, model))]))
}

/** Who uses field `field` of collection `entityId`. */
export const fieldUses = (model: Model | null, entityId: string, field: string): UseEntry[] => fieldUseIndex(model, entityId).get(field) ?? []
