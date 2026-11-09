/** Public read of a published snapshot; drafts are never served here. */
export default defineEventHandler(async (event) => {
  const snapshot = await useBildr().services.getPublished(getRouterParam(event, 'slug') ?? '')
  if (!snapshot) throw createError({ statusCode: 404, statusMessage: 'Not published' })
  return snapshot
})
