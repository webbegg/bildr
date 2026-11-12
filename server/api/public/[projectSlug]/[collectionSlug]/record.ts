/**
 * Every method but GET (`record.get.ts`): a published app's records cannot be
 * changed or deleted from outside. HEAD is not served either, so a HEAD
 * never starts an API fetch.
 */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'allow', 'GET')
  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
