import { ActionError } from '../../../actions/define'
import { PUBLIC_BODY_MAX_BYTES } from '../../../utils/publicData'
import type { PublicWriteResult } from '../../../utils/publicData'

/**
 * Adds a record to a `publicCreate` internal collection of a published app,
 * from JSON `{ values }`; answers 201 `{ id }`. No same-origin guard:
 * published apps may be embedded, so any website can post here, which is
 * what `publicCreate` opts into. The limits are the per-client rate limit,
 * the body size, and the record checks of `createPublicRecord`. Errors are
 * generic; details only go to the server log.
 */
export default defineEventHandler(async (event) => {
  const projectSlug = getRouterParam(event, 'projectSlug') ?? ''
  const collectionSlug = getRouterParam(event, 'collectionSlug') ?? ''
  limitPublicRequest(event, 'write', projectSlug)

  const tooLarge = () => createError({ statusCode: 413, statusMessage: `The body can be at most ${PUBLIC_BODY_MAX_BYTES / 1024} KB` })
  if (Number(getHeader(event, 'content-length') ?? 0) > PUBLIC_BODY_MAX_BYTES) throw tooLarge()
  const raw = await readRawBody(event, 'utf8') ?? ''
  if (new TextEncoder().encode(raw).length > PUBLIC_BODY_MAX_BYTES) throw tooLarge()
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    body = undefined
  }

  const bildr = useBildr()
  const snapshot = await bildr.services.getPublished(projectSlug)
  if (!snapshot) throw createError({ statusCode: 404, statusMessage: 'Collection not found' })
  let result: PublicWriteResult
  try {
    result = await bildr.call<PublicWriteResult>('public_record_create', { projectId: snapshot.project.id, collection: collectionSlug, body }, { caller: 'public', source: 'public' })
  } catch (error) {
    if (error instanceof ActionError && error.code === 'invalid_input') throw createError({ statusCode: 404, statusMessage: 'Collection not found' })
    console.warn(`[bildr] public write to ${projectSlug}/${collectionSlug} failed:`, error)
    throw createError({ statusCode: 500, statusMessage: 'Could not save the record' })
  }
  if (!result.ok) throw createError({ statusCode: result.status, statusMessage: result.message })
  setResponseStatus(event, 201)
  return { id: result.record.id }
})
