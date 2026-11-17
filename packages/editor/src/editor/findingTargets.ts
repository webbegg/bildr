import { generate } from '@bildr/codegen/generate'
import type { Model } from '@bildr/codegen/model'
import { kindOfPath } from '../model.ts'
import type { CheckFinding, ModelProblem } from '../types.ts'
import { actionsOf, entityById, queriesOf, repositoryEntity } from '../shared/dataModel.ts'

/**
 * Where a Health finding, a drift item or a model problem leads (S8): pure reads, no router and no editor
 * (`editor/openTarget.ts` opens a target). A target is one place in the editor:
 *
 *  - an item of the Data workspace (`collection`, `connection`, `query`, `action`), by its route;
 *  - a `page`, `component` or `layout`, which opens on the canvas;
 *  - the generated file's `code`, which is the Code screen on the model file it comes from, with that file's tab;
 *  - a model file in All model files (`files`).
 *
 * A generated file is owned by the model file it is generated from. The editor does not read the manifest, so the owner is
 * what the generator says: `generate(model)` is what the module syncs, and each file it emits names its `source`.
 */

export type TargetKind = 'collection' | 'connection' | 'query' | 'action' | 'page' | 'component' | 'layout' | 'code' | 'files'

/** A route the target opens; the targets that open on the canvas have none. */
export interface TargetRoute {
  path: '/data' | '/code'
  query: Record<string, string>
}

export interface Target {
  kind: TargetKind
  /** The model id of an item, or the path of the file (the generated file of `code`, the model file of `files`). */
  id: string
  /** What the link says: "Open in Code", "Open Collection Post". */
  label: string
  to?: TargetRoute
}

/** A target's name in the DOM and in a test: `collection:ent_post`. */
export const targetKey = (target: Pick<Target, 'kind' | 'id'>): string => `${target.kind}:${target.id}`

// ── Whose is a generated file ────────────────────────────────────────────

const owned = new WeakMap<Model, Map<string, string>>()

/** Generated file → the model file it comes from, for what the model generates (empty when it does not: the generator refuses some models). */
const ownersOf = (model: Model): Map<string, string> => {
  let owners = owned.get(model)
  if (!owners) {
    owners = new Map()
    try {
      for (const file of generate(model)) if (file.source) owners.set(file.path, file.source)
    } catch {
      // A model the generator refuses (two collections with one plural) has no generated files to point at.
    }
    owned.set(model, owners)
  }
  return owners
}

// ── The item a model file holds ──────────────────────────────────────────

const dataItem = (kind: 'collection' | 'connection' | 'query' | 'action', id: string, label: string): Target =>
  ({ kind, id, label: `Open ${label}`, to: { path: '/data', query: { item: `${kind}:${id}` } } })

const collection = (model: Model, entityId: string | undefined): Target | undefined => {
  const entity = entityId ? entityById(model, entityId) : undefined
  return entity ? dataItem('collection', entity.id, `Collection ${entity.name}`) : undefined
}

/** The id the model file at `path` holds (`model.paths` is id → path; the sample data of a collection is `fixtures:<collection id>`). */
const idAt = (model: Model, path: string): string | undefined => Object.keys(model.paths).find(id => model.paths[id] === path)

/** The item of the editor that the model file at `path` is, or undefined when it has none (the project, the theme, a module, a sqlite storage, state). */
const itemAt = (model: Model, path: string): Target | undefined => {
  const id = idAt(model, path)
  if (!id) return undefined
  switch (kindOfPath(path)) {
    case 'entity': return collection(model, id)
    case 'repository': return collection(model, repositoryEntity(model, id))
    case 'fixtures': return collection(model, id.replace(/^fixtures:/, ''))
    case 'datasource': {
      const source = model.datasources.find(candidate => candidate.id === id)
      return source?.kind === 'rest' ? dataItem('connection', source.id, `Connection ${source.name}`) : undefined
    }
    case 'query': {
      const query = queriesOf(model).find(candidate => candidate.id === id)
      return query ? dataItem('query', query.id, `Query ${query.label}`) : undefined
    }
    case 'action': {
      const action = actionsOf(model).find(candidate => candidate.id === id)
      return action ? dataItem('action', action.id, `Action ${action.label}`) : undefined
    }
    case 'page': {
      const page = Object.values(model.modules).flatMap(mod => mod.pages).find(candidate => candidate.id === id)
      return page ? { kind: 'page', id: page.id, label: `Open Page ${page.name}` } : undefined
    }
    case 'component': {
      const component = Object.values(model.modules).flatMap(mod => mod.components).find(candidate => candidate.id === id)
      return component ? { kind: 'component', id: component.id, label: `Open Component ${component.name}` } : undefined
    }
    case 'layout': {
      const layout = model.layouts.find(candidate => candidate.id === id)
      return layout ? { kind: 'layout', id: layout.id, label: `Open Layout ${layout.name}` } : undefined
    }
    default: return undefined
  }
}

// ── Findings, drift and problems ─────────────────────────────────────────

/**
 * Where a finding leads: the generated `file` in Code, then the item it is generated from, when it has one. A drift item is a finding with
 * only its file; so is a lint or type error (`file:line`). Nothing for a file Code cannot show: one bildr does not generate (hand-written),
 * one generated from a whole folder (a schema, a seed), or any file while the model is not known.
 */
export function findingTarget(finding: Partial<CheckFinding>, model: Model | null): Target[] {
  if (!finding.file || !model) return []
  const file = finding.file.replace(/^\.\//, '')
  const owner = ownersOf(model).get(file)
  // Code lists the generated files of a model file; a folder is no model file.
  if (!owner || !kindOfPath(owner)) return []
  const item = itemAt(model, owner)
  return [{ kind: 'code', id: file, label: 'Open in Code', to: { path: '/code', query: { path: owner, file } } }, ...(item ? [item] : [])]
}

/**
 * Where a model problem leads: the item its file holds, when the model loads and the file has one (the Data workspace's items, a page,
 * a component, a layout), else the file in All model files, where it is fixed. Nothing for a path that is not a model file.
 */
export function problemTarget(problem: ModelProblem, model: Model | null): Target[] {
  if (!kindOfPath(problem.path)) return []
  const item = model ? itemAt(model, problem.path) : undefined
  if (item) return [item]
  return [{ kind: 'files', id: problem.path, label: 'Open in All model files', to: { path: '/data', query: { item: 'files', file: problem.path } } }]
}
