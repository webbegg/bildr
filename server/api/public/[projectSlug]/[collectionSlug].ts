/**
 * Every method but GET and POST (which have their own handlers): records of
 * a published app cannot be changed or deleted from outside. HEAD is not
 * served either, so a HEAD never starts an API fetch.
 */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'allow', 'GET, POST')
  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
