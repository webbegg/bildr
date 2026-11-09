import type { Project } from '#shared/document/schema'

/** Poll fallback for live sync: the editor refetches when this moves past its copy. */
export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId') ?? ''
  try {
    const project = await useBildr().call<Project>('project_get', { projectId }, { caller: 'http' })
    return { version: project.version }
  } catch (error) {
    throw toHttpError(error)
  }
})
