import { ActionError } from '../../../actions/define'
import { publicCollection, publicRecords } from '../../../utils/publicData'

/**
 * Read-only records of a `publicRead` collection of a published app, e.g.
 * `?limit=10&sort=price&dir=asc&filter[vegan]=true&offset=0`. No same-origin
 * guard: published apps may be embedded on other sites. API collections are
 * fetched server-side through the SSRF guard and the 60 s cache.
 */
export default defineEventHandler(async (event) => {
  const { services } = useBildr()
  const snapshot = await services.getPublished(getRouterParam(event, 'projectSlug') ?? '')
  const collection = publicCollection(snapshot, getRouterParam(event, 'collectionSlug') ?? '')
  if (!snapshot || !collection) throw createError({ statusCode: 404, statusMessage: 'Collection not found' })
  let stored
  try {
    stored = await services.collectionRecords(snapshot.project.id, collection)
  } catch (error) {
    if (error instanceof ActionError) throw createError({ statusCode: 502, statusMessage: `Could not load the API data: ${error.message}` })
    throw error
  }
  const result = publicRecords(collection, stored, getQuery(event))
  if ('problem' in result) throw createError({ statusCode: 400, statusMessage: result.problem })
  return result
})
