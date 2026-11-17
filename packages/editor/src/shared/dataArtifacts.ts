import { usesOf } from '@bildr/codegen/edit'
import type { ArtifactUse, UseKind } from '@bildr/codegen/edit'
import type { Model, QueryFile } from '@bildr/codegen/model'
import { entityById, repositoryEntity } from './dataModel.ts'
import type { FieldType } from './dataModel.ts'

/**
 * What the Data workspace reads of the model about its queries and actions. "Artifact" here means a query or an action, the two
 * kinds the Data tree lists besides collections and connections (S10); it is not the model's wider word for any file.
 *
 * Pure reads, like `dataModel.ts` next to it: the words and the module actions of each kind, who uses one ("Used in", from the
 * module's own usage index `usesOf`, so it is the list the delete refusal gives), a step in a sentence, and the fields a query
 * can name. What needs the editor (running a module action from a dialog, opening a use) is `editor/dataArtifactActions.ts`.
 */

export type ArtifactKind = 'query' | 'action'

export const ARTIFACT_KINDS: Record<ArtifactKind, { label: string, plural: string, rename: string, delete: string }> = {
  query: { label: 'Query', plural: 'Queries', rename: 'query_rename', delete: 'query_delete' },
  action: { label: 'Action', plural: 'Actions', rename: 'action_rename', delete: 'action_delete' }
}

/** How many rows a query returns: all that match (`many`), or the one a page asks for (`one`). */
export type QueryResultKind = QueryFile['result']
export const RESULTS: Array<{ value: QueryResultKind, label: string }> = [{ value: 'one', label: 'One' }, { value: 'many', label: 'Many' }]

/** The generated composable of a name (`featuredPosts` → `useFeaturedPosts`): what hand-written code imports. */
export const composableOf = (name: string): string => `use${name.charAt(0).toUpperCase()}${name.slice(1)}`

// ── Who uses one ─────────────────────────────────────────────────────────

/** One place that uses a query or an action: a page, a component, a layout or another action, with each way it does. */
export interface UseEntry {
  kind: UseKind
  /** The page, component, layout or action that holds the use. */
  id: string
  name: string
  /** What it does there, one sentence for each place in it ("Reads it as “featured”"). */
  what: string[]
  /** The module changes it along with what is deleted or renamed (a collection's own action, an action's pick of a field), so it does not stop that. */
  follows?: boolean
}

const KIND_LABELS: Record<UseKind, string> = { page: 'Page', component: 'Component', layout: 'Layout', action: 'Action', query: 'Query' }
export const usageKindLabel = (kind: UseKind): string => KIND_LABELS[kind]
/** The id a use is named by in the DOM and in a test: `page:pg_index`. */
export const usageKey = (use: Pick<UseEntry, 'kind' | 'id'>): string => `${use.kind}:${use.id}`

const sentence = (use: ArtifactUse, artifact: ArtifactKind): string => {
  const as = use.as ? ` “${use.as}”` : ''
  switch (use.via) {
    case 'uses': return artifact === 'query' ? `Reads it as${as || ' a value'}` : `Runs it as${as || ' an action'}`
    case 'bind': return `${use.node ?? use.where} shows${as || ' it'}`
    case 'form': return `The form ${use.node} runs it`
    case 'interaction': return `${use.node} runs it on an interaction`
    case 'props': return `${use.node} has it in its properties`
    case 'properties': return 'Has a property for it'
    case 'param': return 'Checks a route parameter with it'
    case 'step': return 'Mentions it in its steps'
    default: return `Mentions it in its ${use.where}`
  }
}

/** Who uses query or action `id`, one entry per place (the module's usage index, `usesOf`), in the order it gives them. */
export function usesOfArtifact(model: Model | null, id: string, artifact: ArtifactKind): UseEntry[] {
  if (!model) return []
  const places = new Map<string, UseEntry>()
  for (const use of usesOf(model, id)) {
    const key = usageKey(use)
    const entry = places.get(key) ?? { kind: use.kind, id: use.id, name: use.name, what: [] }
    const what = sentence(use, artifact)
    if (!entry.what.includes(what)) entry.what.push(what)
    places.set(key, entry)
  }
  return [...places.values()]
}

// ── An action's steps ────────────────────────────────────────────────────

const text = (value: unknown): string => typeof value === 'string' ? value : ''

/** A step that returns nothing: no value, or the one value a void result takes (`{ $var: 'undefined' }`). */
const bareReturn = (step: Record<string, unknown>): boolean =>
  step.value === undefined || (typeof step.value === 'object' && step.value !== null && (step.value as Record<string, unknown>).$var === 'undefined')

const spaced = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
const article = (word: string) => /^[aeiou]/i.test(word) ? 'an' : 'a'

/**
 * What a lookup finds a row by, as words: the argument it is given (`slug`), else the one its operation takes (`get` is by the
 * key: `id`, `findBySlug` is by `slug`).
 */
function lookupArg(lookup: Record<string, unknown>): string | undefined {
  const [given] = typeof lookup.args === 'object' && lookup.args !== null ? Object.keys(lookup.args) : []
  if (given) return spaced(given)
  const op = text(lookup.op)
  if (op === 'get') return 'id'
  const finder = /^findBy(.+)$/.exec(op)
  return finder ? spaced(finder[1]!) : undefined
}

/**
 * A step in a sentence: what it does, not how it is written (no operation or collection code names). The Steps tab (D10c) heads
 * each card with it.
 */
export function stepSummary(step: Record<string, unknown>, model: Model | null): string {
  const collection = (repository: unknown) => (model ? entityById(model, repositoryEntity(model, text(repository)) ?? '')?.name : undefined) ?? undefined
  const object = (repository: unknown) => {
    const name = collection(repository)
    return name ? `${article(name)} ${name}` : 'a row'
  }
  switch (step.kind) {
    case 'validate': return 'Checks the input'
    case 'assert': {
      // The generated check is `if (await lookup) return err(...)`: the action refuses if the lookup finds a row.
      const lookup = typeof step.unless === 'object' && step.unless !== null ? step.unless as Record<string, unknown> : {}
      const by = lookupArg(lookup)
      const name = collection(lookup.repository)
      return `Refuses with “${text(step.error)}” if ${name && by ? `${article(name)} ${name} with this ${by} already exists` : 'a row is found'}`
    }
    case 'load': {
      const by = lookupArg(step)
      return `“${text(step.as)}”: ${object(step.repository)}${by ? ` by ${by}` : ''}${step.orError ? `, refusing with “${text(step.orError)}” if there is none` : ''}`
    }
    case 'return': {
      const early = !(step.if === true || step.if === undefined)
      if (bareReturn(step)) return early ? 'Ends the action early when a condition holds' : 'Ends the action'
      return early ? 'Returns early when a condition holds' : 'Returns a value'
    }
    case 'repository': {
      const verb = ({ create: 'Creates', update: 'Updates', delete: 'Deletes' } as Record<string, string>)[text(step.op)]
      return verb ? `${verb} ${object(step.repository)}` : `Writes to ${collection(step.repository) ?? 'a collection'}`
    }
    case 'call': return 'Calls a service. Not generated yet'
    case 'custom': return 'Runs custom code. Not generated yet'
    default: return text(step.kind) || 'A step'
  }
}

// ── What a query can name ────────────────────────────────────────────────

export interface QueryField {
  name: string
  type: FieldType
}

/**
 * The fields a query's condition and ordering may name, as the module allows them: the collection's own, its key and, when
 * it has timestamps, `createdAt` and `updatedAt`.
 */
export function queryFields(model: Model | null, entityId: string): QueryField[] {
  const entity = model ? entityById(model, entityId) : undefined
  if (!entity) return []
  const key: FieldType = entity.idStrategy === 'uuid' ? 'uuid' : entity.fields.find(field => field.name === 'id')?.type ?? 'text'
  const own = entity.fields.filter(field => field.name !== 'id').map(field => ({ name: field.name, type: field.type as FieldType }))
  return [
    { name: 'id', type: key },
    ...own,
    ...entity.timestamps ? [{ name: 'createdAt', type: 'datetime' as const }, { name: 'updatedAt', type: 'datetime' as const }] : []
  ]
}
