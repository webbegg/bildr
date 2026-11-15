import type { PageFile } from '@bildr/codegen/model'
import type { Row } from '@bildr/codegen/query'

/** The preview of a page: the app's URL for it, or why there is none (a detail page has no record to show). */
export type PagePreview = { url: string, hint: '' } | { url: '', hint: string }

/** Whether `path` has a route parameter (`/posts/:slug`). */
export const hasRouteParams = (path: string): boolean => /:[A-Za-z_]/.test(path)

/**
 * Where the app shows `page`: its path, and for a detail page that path with the
 * parameter filled from `record` (the picked one, else the first row). The route
 * pattern itself is never a preview URL: the app has nothing at `/posts/:slug`.
 */
export function previewOf(page: Pick<PageFile, 'path'> | null, detail: { field: string, param: string } | null, record: Row | undefined): PagePreview {
  if (!page) return { url: '', hint: 'There is no page to preview' }
  if (!hasRouteParams(page.path)) return { url: page.path, hint: '' }
  if (!detail) return { url: '', hint: 'This page\'s route has a parameter that no record fills: bind the page to a query by it to preview' }
  const key = record?.[detail.field]
  if (key === undefined || key === null || key === '') return { url: '', hint: 'Add a record to preview this detail page' }
  const url = page.path.replace(new RegExp(`:${detail.param}(?![A-Za-z0-9_])`, 'g'), () => encodeURIComponent(String(key)))
  return hasRouteParams(url) ? { url: '', hint: 'This page\'s route has more parameters than a record fills' } : { url, hint: '' }
}
