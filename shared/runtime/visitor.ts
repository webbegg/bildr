import type { Collection, CollectionSource, Field, Project, PublishedSnapshot } from '../document/schema'

/**
 * What visitors of a published app get from `/api/published/:slug`: the
 * snapshot without the connections (base URLs, headers) and without the
 * source details of API and connection collections (URL, headers, items
 * path, endpoints, id path, field paths). The published app needs only the
 * fields and the flags; its reads and form creates go through the public
 * endpoint, which resolves them server-side from the stored snapshot. `env`
 * holds the public variables only (the snapshot never has secrets).
 */

export type VisitorCollection = Omit<Collection, 'source' | 'fields'> & {
  source: { type: CollectionSource['type'] }
  fields: Omit<Field, 'path'>[]
}

export type VisitorProject = Omit<Project, 'collections' | 'connections'> & { collections: VisitorCollection[] }

export interface VisitorSnapshot {
  project: VisitorProject
  publishedAt: string
  env?: Record<string, string>
}

function visitorCollection(collection: Collection): VisitorCollection {
  if (collection.source.type === 'internal') return collection
  return {
    ...collection,
    source: { type: collection.source.type },
    fields: collection.fields.map(({ path: _path, ...field }) => field)
  }
}

export function visitorSnapshot(snapshot: PublishedSnapshot): VisitorSnapshot {
  const { connections: _connections, ...project } = snapshot.project
  return {
    ...snapshot,
    project: { ...project, collections: snapshot.project.collections.map(visitorCollection) }
  }
}
