import type { H3Event } from 'h3'
import { ActionError } from '../../../actions/define'
import { PUBLIC_BODY_MAX_BYTES, readCappedBody } from '../../../utils/publicData'
import type { PublicWriteResult } from '../../../utils/publicData'

/** The request body as a stream that reads only as fast as it is consumed and stops reading when cancelled. */
function bodyStream(req: H3Event['node']['req']): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // Node delivers Buffers, which are Uint8Arrays.
      req.on('data', (chunk: Uint8Array) => {
        controller.enqueue(chunk)
        if ((controller.desiredSize ?? 0) <= 0) req.pause()
      })
      req.once('end', () => controller.close())
      req.once('error', (error: unknown) => controller.error(error))
    },
    pull() {
      req.resume()
    },
    cancel() {
      req.removeAllListeners('data')
      req.pause()
    }
  }, { highWaterMark: 0 })
}

/**
 * Adds a record to a `publicCreate` internal collection of a published app,
 * from JSON `{ values }`; answers 201 `{ id }`. No same-origin guard:
 * published apps may be embedded, so any website can post here, which is
 * what `publicCreate` opts into. The limits are the per-client rate limit
 * (unpublished slugs share one budget), the body size (counted while
 * streaming, so a chunked body is not read past it; the connection is then
 * closed), and the record checks of `createPublicRecord`. Errors are
 * generic; details only go to the server log.
 */
export default defineEventHandler(async (event) => {
  const projectSlug = getRouterParam(event, 'projectSlug') ?? ''
  const collectionSlug = getRouterParam(event, 'collectionSlug') ?? ''
  const bildr = useBildr()
  const snapshot = await bildr.services.getPublished(projectSlug)
  limitPublicRequest(event, 'write', snapshot && projectSlug)

  const tooLarge = () => {
    setResponseHeader(event, 'connection', 'close')
    return createError({ statusCode: 413, statusMessage: `The body can be at most ${PUBLIC_BODY_MAX_BYTES / 1024} KB` })
  }
  if (Number(getHeader(event, 'content-length') ?? 0) > PUBLIC_BODY_MAX_BYTES) throw tooLarge()
  const raw = await readCappedBody(bodyStream(event.node.req), PUBLIC_BODY_MAX_BYTES)
  if (raw === undefined) throw tooLarge()
  if (!snapshot) throw createError({ statusCode: 404, statusMessage: 'Collection not found' })
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    body = undefined
  }

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
