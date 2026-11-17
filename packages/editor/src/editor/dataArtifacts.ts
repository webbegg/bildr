import { usesOf } from '@bildr/codegen/edit'
import type { ArtifactUse, UseKind } from '@bildr/codegen/edit'
import type { Model } from '@bildr/codegen/model'
import type { FieldType } from '../shared/dataModel.ts'
import type { Editor } from './useEditor.ts'

/**
 * What the Queries and Actions of the Data workspace (S10) share: the words and the module actions of each kind, who
 * uses one ("Used in", from the module's own usage index `usesOf`, so it is the list the delete refusal gives), a
 * step in a sentence, the fields a query can name, how a dialog runs an action and shows its refusal, and the way a
 * use is opened on the Canvas.
 */

export type ArtifactKind = 'query' | 'action'

export const ARTIFACT_KINDS: Record<ArtifactKind, { label: string, plural: string, rename: string, delete: string }> = {
  query: { label: 'Query', plural: 'Queries', rename: 'query_rename', delete: 'query_delete' },
  action: { label: 'Action', plural: 'Actions', rename: 'action_rename', delete: 'action_delete' }
}

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
}

const KIND_LABELS: Record<UseKind, string> = { page: 'Page', component: 'Component', layout: 'Layout', action: 'Action' }
export const useKindLabel = (kind: UseKind): string => KIND_LABELS[kind]
/** The id a use is named by in the DOM and in a test: `page:pg_index`. */
export const useKey = (use: Pick<UseEntry, 'kind' | 'id'>): string => `${use.kind}:${use.id}`

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
    const key = useKey(use)
    const entry = places.get(key) ?? { kind: use.kind, id: use.id, name: use.name, what: [] }
    const what = sentence(use, artifact)
    if (!entry.what.includes(what)) entry.what.push(what)
    places.set(key, entry)
  }
  return [...places.values()]
}

/**
 * Opens the place a use is in: a page, component or layout on the Canvas (the Design screen, which opens it as it does for a
 * collection's detail page), or an action in the Data workspace.
 */
export function openUse(editor: Editor, use: Pick<UseEntry, 'kind' | 'id'>): void {
  if (use.kind === 'action') {
    editor.actionId = use.id
    editor.mode = 'data'
  } else if (use.kind === 'page') {
    editor.mode = 'build'
    editor.sidebarPanel = 'pages'
    editor.selectPage(use.id)
  } else {
    editor.sidebarPanel = 'assets'
    if (use.kind === 'component') editor.editComponent(use.id)
    else editor.editLayout(use.id)
  }
}

// ── An action's steps ────────────────────────────────────────────────────

const text = (value: unknown): string => typeof value === 'string' ? value : ''

/** A step in a sentence, for the Overview's list: what it does, not how it is written. */
export function stepSummary(step: Record<string, unknown>, model: Model | null): string {
  const repositories = new Map(Object.values(model?.modules ?? {}).flatMap(mod => mod.repositories.map((repository): [string, string] => [repository.id, repository.entity])))
  const entities = new Map(Object.values(model?.modules ?? {}).flatMap(mod => mod.entities.map((entity): [string, string] => [entity.id, entity.name])))
  const collection = (repository: unknown) => entities.get(repositories.get(text(repository)) ?? '') ?? text(repository)
  switch (step.kind) {
    case 'validate': return 'Checks the input'
    case 'assert': return `Refuses with “${text(step.error)}” unless a check holds`
    case 'load': return `Loads “${text(step.as)}” (${text(step.op)} on ${collection(step.repository)})${step.orError ? `, refusing with “${text(step.orError)}” when there is none` : ''}`
    case 'return': return step.if === true || step.if === undefined ? 'Returns a value' : 'Returns early when a condition holds'
    case 'repository': return `Repository: ${text(step.op)} on ${collection(step.repository)}`
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
  const entity = Object.values(model?.modules ?? {}).flatMap(mod => mod.entities).find(entry => entry.id === entityId)
  if (!entity) return []
  const key: FieldType = entity.idStrategy === 'uuid' ? 'uuid' : entity.fields.find(field => field.name === 'id')?.type ?? 'text'
  const own = entity.fields.filter(field => field.name !== 'id').map(field => ({ name: field.name, type: field.type as FieldType }))
  return [
    { name: 'id', type: key },
    ...own,
    ...entity.timestamps ? [{ name: 'createdAt', type: 'datetime' as const }, { name: 'updatedAt', type: 'datetime' as const }] : []
  ]
}

// ── Running an action from a dialog or a form ────────────────────────────

/**
 * Runs a module action and, when the module refuses it, takes the refusal for the caller to show where the user is typing
 * (a dialog, a form) instead of the screen's banner. `error` is its message.
 */
export async function attempt<T extends Record<string, unknown>>(editor: Editor, name: string, input: Record<string, unknown>, fallback: string): Promise<{ result: T } | { error: string }> {
  const result = await editor.run(name, input) as T | undefined
  if (result) return { result }
  const error = editor.error ?? fallback
  editor.dismissError()
  return { error }
}
