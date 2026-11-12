import { ActionError } from '../../../../actions/define'
import { publicCollection, publicRecordByKey } from '../../../../utils/publicData'

/**
 * One record of a `publicRead` collection of a published app, by its URL key,
 * for detail pages: `/api/public/<project>/<collection>/record?key=<key>&field=slug`
 * (`key`: the URL key, URL-encoded; `field`: a text field or `id`; the
 * collection's default URL key without one). The key is a query value, not a
 * path segment, so `?`, `#`, `&` and `/` in it reach the lookup as they are.
 * Answers `{ record }` with the declared fields only, never source details.
 * Internal collections are looked up in their records, connection
 * collections by id through the PUBLISHED connection's get endpoint (other
 * keys from its list, within the paging caps), API collections from their
 * list. Rate-limited with the list reads; a failed fetch answers a generic
 * 502 and logs the reason. GET only: other methods answer 405 (`record.ts`).
 */
export default defineEventHandler(async (event) => {
  const projectSlug = getRouterParam(event, 'projectSlug') ?? ''
  const { services } = useBildr()
  const snapshot = await services.getPublished(projectSlug)
  limitPublicRequest(event, 'read', snapshot && projectSlug)
  const collection = publicCollection(snapshot, getRouterParam(event, 'collectionSlug') ?? '')
  if (!snapshot || !collection) throw createError({ statusCode: 404, statusMessage: 'Collection not found' })
  const { project } = snapshot
  let result
  try {
    result = await publicRecordByKey(collection, getQuery(event), (field, value) => services.recordByKey(project.id, collection, project.connections, field, value))
  } catch (error) {
    console.warn(`[bildr] public record read of ${projectSlug}/${collection.slug} failed:`, error instanceof ActionError ? error.message : error)
    throw createError({ statusCode: 502, statusMessage: 'Could not load the data' })
  }
  if (!result.ok) throw createError({ statusCode: result.status, statusMessage: result.message })
  return { record: result.record }
})
