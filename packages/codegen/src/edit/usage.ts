import type { Model } from '../model/load.ts'
import type { ActionFile, PageFile } from '../model/schemas.ts'
import { mapNodePaths, mapPaths, rootOf, walkScoped } from './bindings.ts'
import { treesOf } from './core.ts'
import { walk } from './tree.ts'

/**
 * The usage index (D10a): who uses an artifact, as data. Deleting a query, an action or an
 * entity is refused while this list isn't empty (`useLabels` turns it into the sentence), and
 * the Data workspace's "Used in" reads it.
 *
 * Two layers: `idUses` finds the files that hold an artifact's id (a page's `uses`, a Form's
 * `action`, a `runAction` step, a component property's entity…): what must change before the
 * artifact can go. `usesOf` adds how the artifact is read: the nodes that bind the name a page
 * uses it under, and the actions whose input, output or steps mention it.
 */

export type UseKind = 'page' | 'component' | 'layout' | 'action'
/**
 * How it is used: `uses` (a page's uses), `param` (a page's route param), `properties` (a component's
 * properties), `props` (a node's props), `form` (a Form's action), `interaction` (a node's interaction steps),
 * `bind` (a node, computed value or SEO field binding the name a page uses it under), and for an action that
 * mentions it: `input`, `output`, `step`, `errors` or `client`.
 */
export type UseVia = 'uses' | 'param' | 'properties' | 'props' | 'form' | 'interaction' | 'bind' | 'input' | 'output' | 'step' | 'errors' | 'client'

export interface ArtifactUse {
  kind: UseKind
  /** The page, component, layout or action id. */
  id: string
  name: string
  via: UseVia
  /** Where in the file: `uses`, `computed`, `seo`, `properties`, a node id, or the action's section. */
  where: string
  /** The node, when the use is on one. */
  node?: string
  /** The name a page uses it under (`uses`) or binds it by (`bind`). */
  as?: string
}

/** Whether `value` holds one of the strings `ids` anywhere. */
export const mentions = (value: unknown, ids: ReadonlySet<string>): boolean => {
  if (typeof value === 'string') return ids.has(value)
  if (!value || typeof value !== 'object') return false
  return Object.values(value).some(item => mentions(item, ids))
}

/** The pages, components and layouts that hold any of `ids` (queries, actions, fields, an entity…). */
export const idUses = (model: Model, ids: ReadonlySet<string>): ArtifactUse[] => treesOf(model).flatMap((tree) => {
  const found: ArtifactUse[] = []
  const owner = tree.owner as { name: string, uses?: { queries?: Array<{ as: string, query: string }>, actions?: Array<{ as: string, action: string }>, state?: Array<{ as: string, state: string }> }, params?: unknown, properties?: unknown }
  const base = { kind: tree.kind, id: tree.file, name: owner.name } as const
  const aliased = [
    ...(owner.uses?.queries ?? []).filter(use => ids.has(use.query)),
    ...(owner.uses?.actions ?? []).filter(use => ids.has(use.action)),
    ...(owner.uses?.state ?? []).filter(use => ids.has(use.state))
  ]
  for (const use of aliased) found.push({ ...base, via: 'uses', where: 'uses', as: use.as })
  if (!aliased.length && mentions(owner.uses, ids)) found.push({ ...base, via: 'uses', where: 'uses' })
  if (mentions(owner.params, ids)) found.push({ ...base, via: 'param', where: 'uses' })
  if (mentions(owner.properties, ids)) found.push({ ...base, via: 'properties', where: 'properties' })
  walk(tree.root, (node) => {
    if (mentions(node.props, ids)) {
      const action = node.type === 'Form' && typeof node.props?.action === 'string' && ids.has(node.props.action)
      found.push({ ...base, via: action ? 'form' : 'props', where: node.id, node: node.id })
    }
    if (mentions(node.interactions, ids)) found.push({ ...base, via: 'interaction', where: node.id, node: node.id })
  })
  return found
})

/** `pg_index (uses)`, `pg_new_post (n_form)`: where each use is, each place once. */
export const useLabels = (uses: ArtifactUse[]): string[] => [...new Set(uses.map(use => `${use.id} (${use.where})`))]

/** The sentence a refusal gives for one use: `page "index" (pg_index) reads it as "featured"`. */
export const describeUse = (use: ArtifactUse): string => {
  const what = `${use.kind} "${use.name}" (${use.id})`
  if (use.via === 'uses') return `${what} uses it${use.as ? ` as "${use.as}"` : ''}`
  if (use.via === 'form') return `${what}: the Form ${use.node} runs it`
  if (use.via === 'interaction') return `${what}: ${use.node} runs it on an interaction`
  if (use.via === 'bind') return `${what}: ${use.where === use.node ? use.node : use.where} binds "${use.as}"`
  if (use.via === 'properties') return `${what} has a property for it`
  if (use.via === 'param') return `${what} validates a route param with it`
  if (use.via === 'props') return `${what}: ${use.node} has it in its props`
  return `${what} mentions it in its ${use.where}`
}

/** `describeUse` of each distinct use, as one sentence part (at most `limit`, then "and N more"). */
export const describeUses = (uses: ArtifactUse[], limit = 6): string => {
  const lines = [...new Set(uses.map(describeUse))]
  return lines.length > limit ? `${lines.slice(0, limit).join('; ')}; and ${lines.length - limit} more` : lines.join('; ')
}

const ACTION_PARTS = [['input', 'input'], ['output', 'output'], ['steps', 'step'], ['errors', 'errors'], ['client', 'client']] as const

/** Everything that uses artifact `artifactId` (a query, action, entity, field…): see the file comment. */
export const usesOf = (model: Model, artifactId: string): ArtifactUse[] => {
  const ids = new Set([artifactId])
  const uses = idUses(model, ids)

  // The nodes, computed values and SEO fields that bind the name a page reads a query or runs an action under.
  for (const tree of treesOf(model)) {
    if (tree.kind !== 'page') continue
    const page = tree.owner as PageFile
    const aliases = [
      ...(page.uses?.queries ?? []).filter(use => use.query === artifactId).map(use => use.as),
      ...(page.uses?.actions ?? []).filter(use => use.action === artifactId).map(use => use.as)
    ]
    const base = { kind: 'page', id: page.id, name: page.name, via: 'bind' } as const
    for (const as of aliases) {
      const reads = (value: unknown) => {
        let bound = false
        mapPaths(value, (path) => {
          if (rootOf(path) === as) bound = true
          return undefined
        })
        return bound
      }
      if (reads(page.uses?.computed)) uses.push({ ...base, where: 'computed', as })
      if (reads(page.seo)) uses.push({ ...base, where: 'seo', as })
      walkScoped(page.root, (node, scope) => {
        let bound = false
        mapNodePaths(node, (path) => {
          if (rootOf(path) === as && !scope.has(as)) bound = true
          return undefined
        })
        if (bound) uses.push({ ...base, where: node.id, node: node.id, as })
      })
    }
  }

  // The actions that mention it in their input, output, steps, errors or client part.
  for (const mod of Object.values(model.modules)) {
    for (const action of mod.actions as ActionFile[]) {
      if (action.id === artifactId) continue
      for (const [key, via] of ACTION_PARTS) {
        if (mentions(action[key], ids)) uses.push({ kind: 'action', id: action.id, name: action.name, via, where: key })
      }
    }
  }
  return uses
}
