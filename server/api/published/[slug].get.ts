import { visitorSnapshot } from '#shared/runtime/visitor'

/**
 * Public read of a published snapshot; drafts are never served here. API
 * collections come without their source details (see `visitorSnapshot`).
 */
export default defineEventHandler(async (event) => {
  const snapshot = await useBildr().services.getPublished(getRouterParam(event, 'slug') ?? '')
  if (!snapshot) throw createError({ statusCode: 404, statusMessage: 'Not published' })
  return visitorSnapshot(snapshot)
})
