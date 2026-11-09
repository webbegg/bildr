/**
 * Every method but GET and POST (which have their own handlers): records of
 * a published app cannot be changed or deleted from outside.
 */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'allow', 'GET, HEAD, POST')
  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
