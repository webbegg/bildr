import type { ArtifactUse } from '@bildr/codegen/edit'
import type { Model, ModelNode } from '@bildr/codegen/model'
import { findNode } from '../design/tree.ts'
import { findOwner, labelOf } from './items.ts'
import { layerName } from './layers.ts'

/**
 * One way a place uses a collection, a field, a query, an action or a state (or one of its fields), as a sentence (`useSentence`): the
 * words of the Data workspace's Used in lists and of the warnings before a delete or a rename. One table for all of them, so a way of
 * using something says the same thing wherever it is read: `thing` is what is used, and decides the few sentences that differ ("Reads it
 * as “featured”" for a query, "A Text shows “post.title”" for a field).
 *
 * Nobody here reads an id: a node is its layer name (`layerName`, as the layers panel and the canvas label it) or its type
 * ("a Text", "the list"), a query or an action its label.
 */

export type UsedThing = { kind: 'collection' | 'query' | 'action' | 'state' } | { kind: 'field' | 'stateField', name: string }

/** A name in the quotes the workspace uses for names (`“Post”`): the sentences here and the links that open the thing named. */
export const quoted = (name: string) => `“${name}”`
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const article = (word: string) => /^[aeiou]/i.test(word) ? 'an' : 'a'

const isAction = (model: Model, id: string | undefined): boolean => !!id && Object.values(model.modules).some(mod => mod.actions.some(action => action.id === id))

/** The node a use is on, in words, and its type: `a Text`, `the list`, `the form`, or its own name when it has one (`“Hero title”`). */
const nodeOf = (model: Model, use: ArtifactUse): { words: string, node?: ModelNode } => {
  const owner = use.node ? findOwner(model, use.id)?.file : undefined
  const node = owner && use.node ? findNode(owner.root, use.node) : undefined
  if (!owner || !node) return { words: 'a part of it' }
  const components = Object.values(model.modules).flatMap(mod => mod.components)
  const name = layerName(owner, node, { components, layouts: model.layouts })
  if (name !== node.type) return { words: quoted(name), node }
  if (node.type === 'List') return { words: 'the list', node }
  if (node.type === 'Form') return { words: 'the form', node }
  return { words: `${article(node.type)} ${node.type}`, node }
}

/** Whether page `pageId` reads query `queryId` with a route parameter: it shows one row per route, a detail page. */
const readsByRoute = (model: Model, pageId: string, queryId: string | undefined): boolean => {
  const page = Object.values(model.modules).flatMap(mod => mod.pages).find(entry => entry.id === pageId)
  return !!page?.params?.length && (page.uses?.queries ?? []).some(use => use.query === queryId
    && Object.values(use.args ?? {}).some(value => typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).$route === 'string'))
}

/** The sentence for one way `use` uses `thing`. */
export function useSentence(model: Model, use: ArtifactUse, thing: UsedThing): string {
  const as = use.as ? ` as ${quoted(use.as)}` : ''
  const where = nodeOf(model, use)
  const here = capital(where.words)
  const through = labelOf(model, use.by)
  switch (use.via) {
    case 'uses':
      if (thing.kind === 'query') return `Reads it${as || ' as a value'}`
      if (thing.kind === 'action') return `Runs it${as || ' as an action'}`
      if (thing.kind === 'state') return `Reads it${as || ' as a value'}`
      if (!use.by) return `Uses it${as}`
      return `${isAction(model, use.by) ? 'Runs' : readsByRoute(model, use.id, use.by) ? 'Detail page: reads' : 'Reads'} ${quoted(through)}${as}`
    case 'bind': {
      // A field is read through the name its row has (`post.title`); a query or an action, and a collection, by that name.
      const named = thing.kind === 'field' || thing.kind === 'stateField'
      const path = use.as ? (named ? `${use.as}.${thing.name}` : use.as) : named ? thing.name : undefined
      const value = path ? quoted(path) : 'it'
      if (use.where === 'queries' && (thing.kind === 'state' || thing.kind === 'stateField')) return `A query argument reads ${value}`
      return use.where === 'computed' ? `A computed value reads ${value}` : use.where === 'seo' ? `The SEO fields show ${value}` : `${here} shows ${value}`
    }
    case 'list': return `${here} shows its rows${as}`
    case 'form': return `${here} runs ${through ? quoted(through) : 'it'}`
    // A step that writes a state is on the node: for the state it changes it, for one of its fields it sets it.
    case 'interaction':
      if (thing.kind === 'state') return `${here} changes it on an interaction`
      if (thing.kind === 'stateField') return `${here} sets it on an interaction`
      return `${here} runs ${through ? quoted(through) : 'it'} on an interaction`
    case 'field': return where.node?.type === 'Form' ? `${here} holds it among its fields` : `${here} is a form field for it`
    case 'props': return `${here} has it in its properties`
    case 'properties': return 'Has a property for it'
    case 'param': return 'Checks a route parameter with it'
    case 'input':
    case 'pick': return 'Takes it as its input'
    case 'output': return 'Returns it'
    // One meaning: the steps work with it, which may read it, check it or write it. `set` is the one that writes.
    case 'step': return 'Uses it in its steps'
    case 'set': return 'Sets it in its steps'
    case 'errors': return 'Names it in an error message'
    case 'client': return 'Updates its list in the app'
    case 'where': return 'Filters by it'
    case 'orderBy': return use.kind === 'entity' ? 'Sorts its list by it' : 'Sorts by it'
    case 'finder': return 'Looks its rows up by it'
    case 'relation': return 'Points to it'
    default: return `Mentions it in its ${use.where}`
  }
}
