import { applyOperation } from './operations'
import type { Operation } from './operations'
import type { Collection, DocNode, Page, PageCollection, Project } from './schema'
import { createNode, createPage, slugify } from './factory'
import { pageKeyField, RECORD_ID_KEY } from '../runtime/detail'
import { uniqueName } from '../editor/names'

const TITLE_FIELDS = ['title', 'name']
const BODY_FIELDS = ['body', 'content', 'description', 'text', 'summary', 'excerpt']

const itemRef = (field: string) => `{{ item.${field} }}`

/**
 * The content of a new detail page of `collection` keyed by `field` (its
 * default URL key without one): a Heading bound to the `title` or `name`
 * text field (else the URL key), and a Text bound to the first long text
 * field (`body`, `content`, `description`, …, else the first other text
 * field), left out when there is none.
 */
export function detailPageContent(collection: Pick<Collection, 'slug' | 'fields'>, field?: string): DocNode[] {
  const text = collection.fields.filter(f => f.type === 'text')
  const key = pageKeyField({ collection: { slug: collection.slug, field } }, [collection])!
  const title = TITLE_FIELDS.map(k => text.find(f => f.key === k)).find(f => f)?.key ?? key
  const body = BODY_FIELDS.map(k => text.find(f => f.key === k)).find(f => f) ?? text.find(f => f.key !== title && f.key !== key)
  return [
    createNode('Heading', { text: itemRef(title) }),
    ...(body ? [createNode('Text', { text: itemRef(body.key) })] : [])
  ]
}

/**
 * A new detail page of `collection` (`page_create_detail`, the Data view's
 * "Create detail page"), bound to it with the URL key `field` (its default
 * one without it; checked when the page is added) and holding
 * `detailPageContent`. Without `name`, it is named after the collection with
 * a name no page in `pages` has; without `slug`, its slug is one of the name
 * that no page has.
 */
export function newDetailPage(collection: Pick<Collection, 'slug' | 'name' | 'fields'>, pages: Pick<Page, 'name' | 'slug'>[], given: { name?: string, slug?: string, field?: string } = {}): Page {
  const name = given.name ?? uniqueName(collection.name, pages.map(p => ({ id: p.slug, name: p.name })))
  let slug = given.slug
  if (!slug) {
    const base = slugify(name)
    slug = base
    for (let n = 2; pages.some(p => p.slug === slug); n++) slug = `${base}-${n}`
  }
  const page: Page = { ...createPage(name, slug), collection: given.field === undefined ? { slug: collection.slug } : { slug: collection.slug, field: given.field } }
  page.root.children = detailPageContent(collection, given.field)
  return page
}

/** Operations that can rename or remove a collection, or remove or retype its fields. */
const COLLECTION_OPS = new Set<Operation['op']>(['removeCollection', 'updateCollection', 'removeField', 'updateField', 'setSource'])

/**
 * The `updatePage` operations that keep detail pages valid after `ops` run
 * on `project`, for the same undo step (as `layout_delete` detaches its
 * pages): a renamed collection slug is followed, a removed collection makes
 * the page a plain page, and a URL key field that is removed or no longer
 * text is dropped, so the default key applies (`detailKeyField`); the
 * record id key (`RECORD_ID_KEY`) names no field, so it stays. Empty
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
    const keeps = field === undefined || field === RECORD_ID_KEY || current.fields.some(f => f.key === field && f.type === 'text')
    const next: PageCollection = keeps && field !== undefined ? { slug: current.slug, field } : { slug: current.slug }
    if (next.slug !== page.collection.slug || next.field !== field) cascade.push({ op: 'updatePage', pageId: page.id, collection: next })
  }
  return cascade
}
