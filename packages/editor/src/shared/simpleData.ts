import type { Model } from '@bildr/codegen/model'

/**
 * What the simple Data section reads of the model besides its stores (`shared/stateModel.ts`): the remote APIs, the model's `api` data
 * sources, in the words of the section (an API has a name and a base URL, never a "data source"). Pure reads.
 */

export interface SimpleApi {
  id: string
  name: string
  baseUrl: string
  /** The base URL's host (`api.example.com`), what a list row says of it; the URL itself when it is not one. */
  host: string
}

/** The words of the model's code that a refusal of the module may use, in the words of the section (`plainWords`): [what it says, what the section says]. */
const PLAIN: Array<[RegExp, string | ((...found: string[]) => string)]> = [
  // The ids the module names an item by, and the generated names it gives: the user has neither.
  [/ \((?:st|fld|q|act|ent|ds|pg|cmp|lay)_[A-Za-z0-9_]+\)/g, ''],
  [/, which the app also names use[A-Za-z0-9]+/g, ''],
  [/`?([^`\s]+)`? would generate use[A-Za-z0-9]+, which [^:]+:/g, (_all, name) => `“${name}” is already used by the app:`],
  [/, like "[a-z]+[A-Z][A-Za-z0-9]*"/g, ''],
  // The things the section has no word for: it calls them what the user sees.
  [/already taken by the collection ([^:]+):/g, (_all, name) => `already taken by the data “${name}”:`],
  [/\bStates\b/g, 'Stores'],
  [/\bstates\b/g, 'stores'],
  [/\bState\b/g, 'Store'],
  [/\bstate\b/g, 'store'],
  [/\bcollections\b/gi, 'data'],
  [/\bcollection\b/gi, 'data'],
  [/\bcomposables?\b/gi, 'code'],
  [/\bentit(?:y|ies)\b/gi, 'data'],
  [/\bartifacts?\b/gi, 'item'],
  [/\bdata ?sources?\b/gi, 'API']
]

/**
 * What the module says (a refusal, a problem of the model) in the words of the simple section: a store is a store, never a "state"; no
 * ids, no generated names (`useBlogPreferences`), no "collection", "entity", "artifact" or "data source". The module's own messages
 * are for every screen, so the section says them its way where it shows them.
 */
export function plainWords(message: string): string {
  let said = message
  for (const [found, plain] of PLAIN) said = said.replace(found, plain as string)
  return said
}

/** The host of a base URL, or the text itself when it can't be read as a URL (the model checks it on save, a hand-written file may not). */
export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl
  } catch {
    return baseUrl
  }
}

/** Every API of the model, in the order the model has them. */
export const apisOf = (model: Model): SimpleApi[] =>
  model.datasources.filter(source => source.kind === 'api').map(source => ({ id: source.id, name: source.name, baseUrl: source.baseUrl ?? '', host: hostOf(source.baseUrl ?? '') }))
