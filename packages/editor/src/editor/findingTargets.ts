import { generate } from '@bildr/codegen/generate'
import type { Model } from '@bildr/codegen/model'
import { kindOfPath } from '../model.ts'
import { ADVANCED_PATH } from './dataRoutes.ts'
import type { FileKind } from '../model.ts'
import { repositoryEntity } from '../shared/dataModel.ts'
import { nameOfItem } from '../shared/items.ts'
import type { Item, ItemKind } from '../shared/items.ts'
import { quoted } from '../shared/usageSentences.ts'
import type { CheckFinding, ModelProblem } from '../types.ts'

/**
 * Where a Health finding, a drift item or a model problem leads (S8): pure reads, no router and no editor
 * (`editor/openTarget.ts` opens a target). A target is one place in the editor:
 *
 *  - an item (`shared/items.ts`: a collection, a connection, a query, an action, a page, a component or a layout), which opens as any
 *    link to an item does (`editor/openItem.ts`);
 *  - the generated file's `code`, which is the Code screen on the model file it comes from, with that file's tab;
 *  - a model file in All model files (`files`).
 *
 * A generated file is owned by the model file it is generated from. The editor does not read the manifest, so the owner is
 * what the generator says: `generate(model)` is what the module syncs, and each file it emits names its `source`.
 */

export type TargetKind = ItemKind | 'code' | 'files'

/** A route the target opens: the targets that are not an item (`code`, `files`) are places of their own. */
export interface TargetRoute {
  path: typeof ADVANCED_PATH | '/code'
  query: Record<string, string>
}

/** An item: `openItem` knows where each kind is opened. */
export interface ItemTarget extends Item {
  /** What the link says: "Open collection “Post”". */
  label: string
  to?: undefined
}

/** A generated file in Code, or a model file in All model files: a place of its own, which `to` is the route of. */
export interface FileTarget {
  kind: 'code' | 'files'
  /** The path of the file: the generated file of `code`, the model file of `files`. */
  id: string
  /** What the link says: "Open file in Code". */
  label: string
  to: TargetRoute
}

export type Target = ItemTarget | FileTarget

export const isFileTarget = (target: Target): target is FileTarget => target.kind === 'code' || target.kind === 'files'

/** A target's name in the DOM and in a test: `collection:ent_post`. */
export const targetKey = (target: Pick<Target, 'kind' | 'id'>): string => `${target.kind}:${target.id}`

// ── Whose is a generated file ────────────────────────────────────────────

export interface GeneratedOwners {
  /** Generated file → the model file it comes from. */
  owners: ReadonlyMap<string, string>
  /** Why there are none, when the generator refuses the model (two collections with one plural): what a screen says instead of silent, empty links. */
  error: string | null
}

const NONE: GeneratedOwners = { owners: new Map(), error: null }
const owned = new WeakMap<Model, GeneratedOwners>()

/**
 * What `model` generates, for each generated file the model file it comes from. The generator is the expensive part of every link, so it runs once for a
 * model, however many files ask (and is not asked again for a model it refused). A new model is a new object, so a change of the model asks again.
 */
export function generatedOwners(model: Model | null): GeneratedOwners {
  if (!model) return NONE
  let found = owned.get(model)
  if (!found) {
    const owners = new Map<string, string>()
    try {
      for (const file of generate(model)) if (file.source) owners.set(file.path, file.source)
      found = { owners, error: null }
    } catch (caught) {
      found = { owners: new Map(), error: caught instanceof Error ? caught.message : String(caught) }
    }
    owned.set(model, found)
  }
  return found
}

// ── The item a model file holds ──────────────────────────────────────────

/** The id the model file at `path` holds (`model.paths` is id → path; the sample data of a collection is `fixtures:<collection id>`). */
const idAt = (model: Model, path: string): string | undefined => Object.keys(model.paths).find(id => model.paths[id] === path)

const sameKind = (kind: ItemKind) => (_model: Model, id: string): Item => ({ kind, id })

/** The item each kind of model file holds, by the id the file has: a collection's repository and sample data are the collection's own files. */
const HOLDS: Partial<Record<FileKind, (model: Model, id: string) => Item | undefined>> = {
  entity: sameKind('collection'),
  repository: (model, id) => {
    const entity = repositoryEntity(model, id)
    return entity ? { kind: 'collection', id: entity } : undefined
  },
  fixtures: (_model, id) => ({ kind: 'collection', id: id.replace(/^fixtures:/, '') }),
  datasource: sameKind('connection'),
  query: sameKind('query'),
  action: sameKind('action'),
  page: sameKind('page'),
  component: sameKind('component'),
  layout: sameKind('layout')
}

/** The item of the editor that the model file at `path` is, or undefined when it has none (the project, the theme, a module, a sqlite storage, state) or the model holds none by that id. */
function itemAt(model: Model, path: string): ItemTarget | undefined {
  const id = idAt(model, path)
  const kind = kindOfPath(path)
  const item = id && kind ? HOLDS[kind]?.(model, id) : undefined
  const name = item && nameOfItem(model, item)
  return item && name !== undefined ? { kind: item.kind, id: item.id, label: `Open ${item.kind} ${quoted(name)}` } : undefined
}

// ── Findings, drift and problems ─────────────────────────────────────────

/**
 * Where a generated file leads: it in Code, then the item it is generated from, when it has one. A drift item is a file; so is a lint or
 * type error (`file:line`). Nothing for a file Code cannot show: one bildr does not generate (hand-written), one generated from a whole
 * folder (a schema, a seed), or any file while the model is not known or the generator refuses it (`generatedOwners` says why).
 */
export function targetsOfFile(file: string, model: Model | null): Target[] {
  const path = file.replace(/^\.\//, '')
  const owner = generatedOwners(model).owners.get(path)
  // Code lists the generated files of a model file; a folder is no model file.
  if (!model || !owner || !kindOfPath(owner)) return []
  const item = itemAt(model, owner)
  return [{ kind: 'code', id: path, label: 'Open file in Code', to: { path: '/code', query: { path: owner, file: path } } }, ...(item ? [item] : [])]
}

/** Where a Health finding leads: where its file does (`targetsOfFile`), and nothing when it names none (a failed build). */
export const targetsOfFinding = (finding: Pick<CheckFinding, 'file'>, model: Model | null): Target[] => finding.file ? targetsOfFile(finding.file, model) : []

/**
 * Where a model problem leads: the item its file holds, when the model loads and the file has one (the Data workspace's items, a page,
 * a component, a layout), else the file in All model files, where it is fixed. Nothing for a path that is not a model file.
 */
export function targetsOfProblem(problem: ModelProblem, model: Model | null): Target[] {
  if (!kindOfPath(problem.path)) return []
  const item = model ? itemAt(model, problem.path) : undefined
  if (item) return [item]
  return [{ kind: 'files', id: problem.path, label: 'Open in All model files', to: { path: ADVANCED_PATH, query: { item: 'files', file: problem.path } } }]
}
