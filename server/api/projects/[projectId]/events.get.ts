/**
 * Live sync for open editors: a server-sent event per change (`kind:
 * 'change'`, with the new version and the caller's source) or navigate
 * request (`kind: 'navigate'`) on this project.
 */
export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId') ?? ''
  const bildr = useBildr()
  try {
    await bildr.call('project_get', { projectId }, { caller: 'http' })
  } catch (error) {
    throw toHttpError(error)
  }

  const stream = createEventStream(event)
  const push = (data: Record<string, unknown>) => {
    if (data.projectId === projectId) void stream.push(JSON.stringify(data))
  }
  const unsubscribe = [
    bildr.onChange(change => push({ kind: 'change', ...change })),
    bildr.onNavigate(navigate => push({ kind: 'navigate', ...navigate }))
  ]
  stream.onClosed(async () => {
    unsubscribe.forEach(off => off())
    await stream.close()
  })
  return stream.send()
})
