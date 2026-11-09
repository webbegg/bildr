import { ActionError } from '../../../actions/define'
import { publicCollection, publicRecords } from '../../../utils/publicData'

/**
 * Read-only records of a `publicRead` collection of a published app, e.g.
 * `?limit=10&sort=price&dir=asc&filter[vegan]=true&offset=0`. No same-origin
 * guard: published apps may be embedded on other sites. API collections are
 * fetched server-side through the SSRF guard and the 60 s cache. Reads are
 * rate-limited per client and published project (unpublished slugs share
 * one budget); a failed API fetch answers a generic 502 and logs the
 * reason, which may name resolved addresses. HEAD is not served (405).
 */
export default defineEventHandler(async (event) => {
  const projectSlug = getRouterParam(event, 'projectSlug') ?? ''
  const { services } = useBildr()
  const snapshot = await services.getPublished(projectSlug)
  limitPublicRequest(event, 'read', snapshot && projectSlug)
  const collection = publicCollection(snapshot, getRouterParam(event, 'collectionSlug') ?? '')
  if (!snapshot || !collection) throw createError({ statusCode: 404, statusMessage: 'Collection not found' })
  let stored
  try {
    stored = await services.collectionRecords(snapshot.project.id, collection)
  } catch (error) {
    console.warn(`[bildr] public read of ${projectSlug}/${collection.slug} failed:`, error instanceof ActionError ? error.message : error)
    throw createError({ statusCode: 502, statusMessage: 'Could not load the data' })
  }
  const result = publicRecords(collection, stored, getQuery(event))
  if ('problem' in result) throw createError({ statusCode: 400, statusMessage: result.problem })
  return result
})
