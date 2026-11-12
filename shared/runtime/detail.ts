import type { DataRecord } from '../data/records'
import type { Collection, Page } from '../document/schema'
import type { BindingItem } from './bindings'

/**
 * Detail pages (Framer CMS-style): a page with a `collection` is a template
 * rendered once per record, at `<page>/<key>`, where the key is the value of
 * its URL key field. These helpers are shared by the published app, the
 * draft preview, the server and the editor (link picker, page outline).
 */

/** The key field that means the record id. */
export const RECORD_ID_KEY = 'id'

/** Longest URL key accepted (a slug or title value, or a remote id). */
export const DETAIL_KEY_MAX = 500

/** The URL key field: the chosen one, else a text field named `slug`, else the record id. */
export function detailKeyField(collection: Pick<Collection, 'fields'> | undefined, field?: string): string {
  if (field) return field
  return collection?.fields.some(f => f.key === 'slug' && f.type === 'text') ? 'slug' : RECORD_ID_KEY
}

/** The key field of a detail page, or undefined for a plain page. */
export function pageKeyField(page: Pick<Page, 'collection'>, collections: Pick<Collection, 'slug' | 'fields'>[]): string | undefined {
  if (!page.collection) return undefined
  return detailKeyField(collections.find(c => c.slug === page.collection!.slug), page.collection.field)
}

/** Whether `record` has `key` as its id (`field` "id") or as the value of `field`, compared as text. */
export function keyMatches(record: Pick<DataRecord, 'id' | 'values'>, field: string, key: string): boolean {
  if (field === RECORD_ID_KEY) return record.id === key
  const value = Object.hasOwn(record.values, field) ? record.values[field] : null
  return value !== null && value !== undefined && String(value) === key
}

/**
 * The page a URL shows: `pageSlug` (the first page without one) with `key`
 * for a detail page. A detail page without a key, a plain page with one and
 * an unknown page are not found (undefined).
 */
export function resolvePageRoute<P extends Pick<Page, 'slug' | 'collection'>>(pages: P[], pageSlug: string | undefined, key: string | undefined): { page: P, key?: string } | undefined {
  const page = pageSlug ? pages.find(p => p.slug === pageSlug) : pages[0]
  if (!page) return undefined
  if (page.collection) return key ? { page, key } : undefined
  return key === undefined ? { page } : undefined
}

/** The link a detail page's entry stores: `<page>/{{ item.<key field> }}`, resolved per record. */
export function detailLink(pageSlug: string, keyField: string): string {
  return `${pageSlug}/{{ item.${keyField} }}`
}

const DETAIL_LINK = /^\/?([a-z0-9]+(?:-[a-z0-9]+)*)\/\{\{\s*item\.([A-Za-z_]\w*)\s*\}\}$/

/** A stored link read back as the detail link of a detail page (shown as "Detail: <page>"); undefined for any other link. */
export function parseDetailLink<P extends Pick<Page, 'slug' | 'collection'>>(to: string, pages: P[]): { page: P, field: string } | undefined {
  const match = DETAIL_LINK.exec(to.trim())
  if (!match) return undefined
  const page = pages.find(p => p.slug === match[1] && p.collection)
  return page ? { page, field: match[2]! } : undefined
}

/** The link picker's label of a detail page's entry. */
export function detailLinkLabel(page: Pick<Page, 'name'>): string {
  return `Detail: ${page.name}`
}

/** The page's path pattern, e.g. `/blog/:slug` for a detail page and `/about` for a plain one. */
export function detailPath(page: Pick<Page, 'slug' | 'collection'>, collections: Pick<Collection, 'slug' | 'fields'>[]): string {
  const field = pageKeyField(page, collections)
  return field ? `/${page.slug}/:${field}` : `/${page.slug}`
}

/** A record's title on its detail page: its `title` field, else its `name` field, else the key. */
export function detailTitle(item: BindingItem | null | undefined, key: string): string {
  for (const field of ['title', 'name']) {
    const value = item?.[field]
    if (typeof value === 'string' && value.trim()) return value
  }
  return key
}
