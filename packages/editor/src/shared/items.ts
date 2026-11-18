import type { UseKind } from '@bildr/codegen/edit'
import type { ComponentFile, LayoutFile, Model, PageFile } from '@bildr/codegen/model'
import { entityById } from './dataModel.ts'

/**
 * The things the editor can open, and how to find them in the model: one vocabulary for every link that leads somewhere (the
 * "Used in" lists, the links of the Checks screen), so a kind is spelled one way. The kinds are the words of the workspace: a
 * `collection` is what the module calls an entity (`itemOfUse` maps one to the other, the one place that does).
 *
 * Pure reads of a model; opening an item is `editor/openItem.ts`.
 */

export type ItemKind = 'collection' | 'connection' | 'query' | 'action' | 'page' | 'component' | 'layout'

export interface Item {
  kind: ItemKind
  id: string
}

/** The kinds that open on the Canvas (the Design screen); the others are items of the Data workspace. */
export type CanvasKind = 'page' | 'component' | 'layout'
export const isCanvasKind = (kind: ItemKind): kind is CanvasKind => kind === 'page' || kind === 'component' || kind === 'layout'

const OF_USE: Record<UseKind, ItemKind> = { entity: 'collection', page: 'page', component: 'component', layout: 'layout', action: 'action', query: 'query' }

/** The item a use of the usage index (`UseEntry`, where a collection is an `entity`) is in. */
export const itemOfUse = (use: { kind: UseKind, id: string }): Item => ({ kind: OF_USE[use.kind], id: use.id })

// ── Looking things up ────────────────────────────────────────────────────

export type Owner = PageFile | ComponentFile | LayoutFile

/** The page, component or layout with this id: what holds a node, and so what a use is in. */
export const findOwner = (model: Model, id: string): { kind: CanvasKind, file: Owner } | undefined => {
  const modules = Object.values(model.modules)
  const page = modules.flatMap(mod => mod.pages).find(entry => entry.id === id)
  if (page) return { kind: 'page', file: page }
  const component = modules.flatMap(mod => mod.components).find(entry => entry.id === id)
  if (component) return { kind: 'component', file: component }
  const layout = model.layouts.find(entry => entry.id === id)
  return layout ? { kind: 'layout', file: layout } : undefined
}

/** The query or action with this id. */
export const findArtifact = (model: Model, id: string) => {
  const modules = Object.values(model.modules)
  return [...modules.flatMap(mod => mod.queries), ...modules.flatMap(mod => mod.actions)].find(entry => entry.id === id)
}

/** What a person calls a query or an action: its label, else its name; the id when there is none such, and `''` for no id. */
export const labelOf = (model: Model, id: string | undefined): string => {
  if (!id) return ''
  const item = findArtifact(model, id)
  return item ? item.label || item.name : id
}

const NAMES: Record<ItemKind, (model: Model, id: string) => string | undefined> = {
  collection: (model, id) => entityById(model, id)?.name,
  // Only a REST source is a connection: the other storages have no item of their own.
  connection: (model, id) => model.datasources.find(source => source.id === id && source.kind === 'rest')?.name,
  query: (model, id) => {
    const found = Object.values(model.modules).flatMap(mod => mod.queries).find(entry => entry.id === id)
    return found && (found.label || found.name)
  },
  action: (model, id) => {
    const found = Object.values(model.modules).flatMap(mod => mod.actions).find(entry => entry.id === id)
    return found && (found.label || found.name)
  },
  page: (model, id) => nameOfOwner(model, 'page', id),
  component: (model, id) => nameOfOwner(model, 'component', id),
  layout: (model, id) => nameOfOwner(model, 'layout', id)
}

function nameOfOwner(model: Model, kind: CanvasKind, id: string): string | undefined {
  const owner = findOwner(model, id)
  return owner?.kind === kind ? owner.file.name : undefined
}

/** The name `item` has in `model` (what a link to it says), or undefined when the model has no such item (it was deleted since the link was made). */
export const nameOfItem = (model: Model, item: Item): string | undefined => NAMES[item.kind](model, item.id)
