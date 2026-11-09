import { publicCollection, publicRecords } from '../../../utils/publicData'

/**
 * Read-only records of a `publicRead` collection of a published app, e.g.
 * `?limit=10&sort=price&dir=asc&filter[vegan]=true&offset=0`. No same-origin
 * guard: published apps may be embedded on other sites.
 */
export default defineEventHandler(async (event) => {
  const { services } = useBildr()
  const snapshot = await services.getPublished(getRouterParam(event, 'projectSlug') ?? '')
  const collection = publicCollection(snapshot, getRouterParam(event, 'collectionSlug') ?? '')
  if (!snapshot || !collection) throw createError({ statusCode: 404, statusMessage: 'Collection not found' })
  const result = publicRecords(collection, await services.records.list(snapshot.project.id, collection.id), getQuery(event))
  if ('problem' in result) throw createError({ statusCode: 400, statusMessage: result.problem })
  return result
})
