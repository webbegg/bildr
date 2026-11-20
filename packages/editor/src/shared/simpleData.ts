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
