/**
 * The editor side of detail pages (S34.7): which collection's record
 * `{{ item.* }}` reads at a node (`itemScope`), the link picker's
 * "Detail: <page>" entries, the insert-variable picker's item fields, the
 * URL key choices, the steps of "Create detail page", and the ⌘K commands.
 * Pure, so the panels pass in the project parts they show.
 */
import type { Collection, Page } from '../document/schema'
import { slugify } from '../document/factory'
import { findNode, pathTo } from '../document/tree'
import { detailKeyField, detailLink, detailLinkLabel, detailPath, pageKeyField, RECORD_ID_KEY } from '../runtime/detail'
import { LIST_TYPE, listQueryOf } from '../runtime/list'
import type { Command } from './commands'
import { uniqueName } from './names'

type Collections = Pick<Collection, 'slug' | 'name' | 'fields'>[]
interface DetailProject<C extends Pick<Collection, 'slug' | 'name' | 'fields'>> { pages: Pick<Page, 'slug' | 'name' | 'collection'>[], collections: C[] }

/**
 * The collection whose record `{{ item.* }}` reads at node `nodeId` of
 * `page`: the nearest List around it (a List's own item wins), else the
 * page's collection on a detail page; undefined elsewhere.
 */
export function itemScope<C extends Pick<Collection, 'slug' | 'name' | 'fields'>>(project: DetailProject<C>, page: Pick<Page, 'root' | 'collection'>, nodeId: string | null | undefined): C | undefined {
  if (!nodeId) return undefined
  const path = pathTo(page.root, nodeId)
  if (!path.length) return undefined
  // A List node itself is not inside its own item; its ancestors are.
  for (const id of path.slice(0, -1).reverse()) {
    const node = findNode(page.root, id)
    if (node?.type === LIST_TYPE) return project.collections.find(c => c.slug === listQueryOf(node.props).collection)
  }
  return page.collection ? project.collections.find(c => c.slug === page.collection!.slug) : undefined
}

/** A link picker entry of a detail page. */
export interface DetailLinkItem { label: string, value: string, disabled: boolean, description: string }

/**
 * The link picker's "Detail: <page>" entries, one per detail page, storing
 * `<page>/{{ item.<key field> }}`. Only where `scope` (see `itemScope`) is
 * the page's collection does that ref read the right record, so the others
 * are disabled with a hint saying where they work.
 */
export function detailLinkItems(project: DetailProject<Pick<Collection, 'slug' | 'name' | 'fields'>>, scope: Pick<Collection, 'slug'> | undefined): DetailLinkItem[] {
  return project.pages.flatMap((page) => {
    if (!page.collection) return []
    const field = pageKeyField(page, project.collections)!
    const collection = project.collections.find(c => c.slug === page.collection!.slug)
    const enabled = scope?.slug === page.collection.slug
    return [{
      label: detailLinkLabel(page),
      value: detailLink(page.slug, field),
      disabled: !enabled,
      description: enabled ? detailPath(page, project.collections) : `Put this inside a List of ${collection?.name ?? page.collection.slug}, or on ${page.name}`
    }]
  })
}

/** An entry of the insert-variable picker's record section. */
export interface ItemVariable { name: string, label: string, ref: string }

const itemRef = (field: string) => `{{ item.${field} }}`

/** The record's bindings the insert-variable picker lists: each field, then the id and timestamps. */
export function itemVariables(collection: Pick<Collection, 'fields'>): ItemVariable[] {
  const extra = [[RECORD_ID_KEY, 'Record id'], ['createdAt', 'Created'], ['updatedAt', 'Updated']] as const
  return [
    ...collection.fields.map(f => ({ name: `item.${f.key}`, label: f.label, ref: itemRef(f.key) })),
    ...extra.map(([key, label]) => ({ name: `item.${key}`, label, ref: itemRef(key) }))
  ]
}

/**
 * The URL key choices: the collection's text fields, then the record id.
 * A page's key names a text field or none (the default key), so the record
 * id is only a choice where it is the default: without a text `slug` field.
 */
export function keyFieldItems(collection: Pick<Collection, 'fields'> | undefined): { label: string, value: string, disabled?: boolean, description?: string }[] {
  const byId = detailKeyField(collection) === RECORD_ID_KEY
  return [
    ...(collection?.fields.filter(f => f.type === 'text').map(f => ({ label: `${f.label} (${f.key})`, value: f.key })) ?? []),
    byId ? { label: 'Record id', value: RECORD_ID_KEY } : { label: 'Record id', value: RECORD_ID_KEY, disabled: true, description: 'Only without a text field named slug' }
  ]
}

const TITLE_FIELDS = ['title', 'name']
const BODY_FIELDS = ['body', 'content', 'description', 'text', 'summary', 'excerpt']

/** A node `node_insert` takes in `nodes`. */
export interface DetailNodeSpec { type: string, props: Record<string, string> }

/**
 * "Create detail page" for `collection`: the page to add (named after the
 * collection, with a name and slug no page in `pages` has, bound to it with
 * its default URL key) and the nodes to put on it: a Heading bound to the
 * `title` or `name` text field (else the URL key), and a Text bound to the
 * first long text field (`body`, `content`, `description`, …, else the
 * first other text field), left out when there is none.
 */
export function detailPageSteps(collection: Pick<Collection, 'slug' | 'name' | 'fields'>, pages: Pick<Page, 'name' | 'slug'>[]): { page: { name: string, slug: string, collection: { slug: string } }, nodes: DetailNodeSpec[] } {
  const name = uniqueName(collection.name, pages.map(p => ({ id: p.slug, name: p.name })))
  const base = slugify(name)
  let slug = base
  for (let n = 2; pages.some(p => p.slug === slug); n++) slug = `${base}-${n}`
  const text = collection.fields.filter(f => f.type === 'text')
  const key = pageKeyField({ collection: { slug: collection.slug } }, [collection])!
  const title = TITLE_FIELDS.map(k => text.find(f => f.key === k)).find(f => f)?.key ?? key
  const body = BODY_FIELDS.map(k => text.find(f => f.key === k)).find(f => f) ?? text.find(f => f.key !== title && f.key !== key)
  return {
    page: { name, slug, collection: { slug: collection.slug } },
    nodes: [
      { type: 'Heading', props: { text: itemRef(title) } },
      ...(body ? [{ type: 'Text', props: { text: itemRef(body.key) } }] : [])
    ]
  }
}

export interface DetailCommandActions {
  create: (collectionSlug: string) => unknown
  setCollection: (collectionSlug: string | null) => unknown
}

/**
 * The ⌘K commands: "Create detail page for <collection>" for each
 * collection, and "Set page collection › <None | collection>" for the
 * current page (`onPage`: a page shows on the Canvas), but its current one.
 */
export function detailCommands<C>(collections: Collections, state: { pageCollection: string | undefined, onPage: boolean }, actions: DetailCommandActions): Command<C>[] {
  const icon = 'i-lucide-file-text'
  const choices = [{ slug: null, name: 'None' }, ...collections]
  return [
    ...collections.map((collection): Command<C> => ({
      id: `detail:create:${collection.slug}`,
      group: 'actions',
      label: `Create detail page for ${collection.name}`,
      icon,
      keywords: ['detail', 'page', 'collection', 'template', 'cms'],
      enabled: () => true,
      run: () => actions.create(collection.slug)
    })),
    ...choices.map((choice): Command<C> => ({
      id: `detail:set:${choice.slug ?? 'none'}`,
      group: 'actions',
      label: `Set page collection › ${choice.name}`,
      icon,
      keywords: ['detail', 'page', 'collection', 'cms'],
      enabled: () => state.onPage && (state.pageCollection ?? null) !== choice.slug,
      run: () => actions.setCollection(choice.slug)
    }))
  ]
}
