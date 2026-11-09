import type { Collection, CollectionSource, Field, Project, PublishedSnapshot } from '../document/schema'

/**
 * What visitors of a published app get from `/api/published/:slug`: the
 * snapshot without the source details of API collections (URL, items path,
 * field paths). The published app needs only the fields and the flags; its
 * reads go through the public endpoint, which resolves the URL server-side
 * from the stored snapshot.
 */

export type VisitorCollection = Omit<Collection, 'source' | 'fields'> & {
  source: { type: CollectionSource['type'] }
  fields: Omit<Field, 'path'>[]
}

export type VisitorProject = Omit<Project, 'collections'> & { collections: VisitorCollection[] }

export interface VisitorSnapshot {
  project: VisitorProject
  publishedAt: string
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
  return {
    ...snapshot,
    project: { ...snapshot.project, collections: snapshot.project.collections.map(visitorCollection) }
  }
}
