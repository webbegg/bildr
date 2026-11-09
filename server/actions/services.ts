import { applyOperations } from '#shared/document/operations'
import type { Operation } from '#shared/document/operations'
import type { Project } from '#shared/document/schema'
import { createProjectStore } from '../utils/projectStore'
import type { KeyValueStorage } from '../utils/projectStore'
import { ActionError } from './define'
import type { ActionContext } from './define'

export interface HistoryEntry {
  label: string
  ops: Operation[]
  inverse: Operation[]
}

interface History {
  undo: HistoryEntry[]
  redo: HistoryEntry[]
}

const UNDO_LIMIT = 100

/**
 * Server-side state the actions share. Undo lives here, not in the editor,
 * so an agent can undo too and every tab sees the same history.
 */
export function createServices(storage: KeyValueStorage) {
  const projects = createProjectStore(storage)

  async function loadProject(projectId: string): Promise<Project> {
    return await projects.get(projectId) ?? Promise.reject(new ActionError('not_found', `Project "${projectId}" not found`))
  }

  async function loadHistory(projectId: string): Promise<History> {
    return await storage.getItem<History>(`history:${projectId}`) ?? { undo: [], redo: [] }
  }

  async function commit(ctx: ActionContext, project: Project, ops: Operation[]): Promise<{ project: Project, inverse: Operation[] }> {
    const inverse = applyOperations(project, ops)
    project.version += 1
    project.updatedAt = new Date().toISOString()
    await projects.save(project)
    ctx.notify(project.id, project.version)
    return { project, inverse }
  }

  return {
    projects,
    storage,
    loadProject,

    /** Applies `ops` atomically, saves, and records one undo step named `label`. */
    async mutate(ctx: ActionContext, projectId: string, label: string, ops: Operation[]): Promise<Project> {
      const { project, inverse } = await commit(ctx, await loadProject(projectId), ops)
      const history = await loadHistory(projectId)
      history.undo = [...history.undo, { label, ops, inverse }].slice(-UNDO_LIMIT)
      history.redo = []
      await storage.setItem(`history:${projectId}`, history)
      return project
    },

    async undo(ctx: ActionContext, projectId: string): Promise<{ project: Project, label: string }> {
      const history = await loadHistory(projectId)
      const entry = history.undo.pop()
      if (!entry) throw new ActionError('invalid', 'Nothing to undo')
      const { project } = await commit(ctx, await loadProject(projectId), entry.inverse)
      history.redo.push(entry)
      await storage.setItem(`history:${projectId}`, history)
      return { project, label: entry.label }
    },

    async redo(ctx: ActionContext, projectId: string): Promise<{ project: Project, label: string }> {
      const history = await loadHistory(projectId)
      const entry = history.redo.pop()
      if (!entry) throw new ActionError('invalid', 'Nothing to redo')
      const { project } = await commit(ctx, await loadProject(projectId), entry.ops)
      history.undo.push(entry)
      await storage.setItem(`history:${projectId}`, history)
      return { project, label: entry.label }
    },

    async historyState(projectId: string): Promise<{ undo: string | null, redo: string | null }> {
      const history = await loadHistory(projectId)
      return { undo: history.undo.at(-1)?.label ?? null, redo: history.redo.at(-1)?.label ?? null }
    }
  }
}

export type Services = ReturnType<typeof createServices>
