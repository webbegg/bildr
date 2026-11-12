import { applyOperation } from './operations'
import type { Operation } from './operations'
import type { PageCollection, Project } from './schema'

/** Operations that can rename or remove a collection, or remove or retype its fields. */
const COLLECTION_OPS = new Set<Operation['op']>(['removeCollection', 'updateCollection', 'removeField', 'updateField', 'setSource'])

/**
 * The `updatePage` operations that keep detail pages valid after `ops` run
 * on `project`, for the same undo step (as `layout_delete` detaches its
 * pages): a renamed collection slug is followed, a removed collection makes
 * the page a plain page, and a URL key field that is removed or no longer
 * text is dropped, so the default key applies (`detailKeyField`). Empty
 * when `ops` touch no collection or would fail anyway (they then fail on
 * their own).
 */
export function detailCascade(project: Project, ops: Operation[]): Operation[] {
  if (!ops.some(op => COLLECTION_OPS.has(op.op)) || !project.pages.some(p => p.collection)) return []
  const after = structuredClone(project)
  try {
    for (const op of ops) applyOperation(after, op)
  } catch {
    return []
  }
  const cascade: Operation[] = []
  for (const page of project.pages) {
    if (!page.collection) continue
    const before = project.collections.find(c => c.slug === page.collection!.slug)
    // Unknown already, so not this batch's doing.
    if (!before) continue
    const current = after.collections.find(c => c.id === before.id)
    if (!current) {
      cascade.push({ op: 'updatePage', pageId: page.id, collection: null })
      continue
    }
    const { field } = page.collection
    const keeps = field === undefined || current.fields.some(f => f.key === field && f.type === 'text')
    const next: PageCollection = keeps && field !== undefined ? { slug: current.slug, field } : { slug: current.slug }
    if (next.slug !== page.collection.slug || next.field !== field) cascade.push({ op: 'updatePage', pageId: page.id, collection: next })
  }
  return cascade
}
