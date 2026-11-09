/**
 * HTTP surface of the action registry. The editor sends `x-bildr-source`
 * (its tab id) so it can ignore change events caused by its own calls.
 */
export default defineEventHandler(async (event) => {
  guardRequest(event)
  const name = getRouterParam(event, 'name') ?? ''
  const body = await readBody(event).catch(() => undefined)
  const source = getHeader(event, 'x-bildr-source')
  try {
    return await useBildr().call(name, body ?? {}, { caller: source ? 'ui' : 'http', source })
  } catch (error) {
    throw toHttpError(error)
  }
})
