import { z } from 'zod'
import { OperationError } from '#shared/document/operations'
import type { KeyValueStorage } from '../utils/projectStore'
import { ActionError } from './define'
import type { ActionCaller, ActionContext, ActionDef } from './define'
import { ACTIONS } from './registry'
import { createServices } from './services'
import type { ServicesOptions } from './services'

export interface ChangeEvent {
  projectId: string
  version: number
  action: string
  source?: string
  /** `data`: only `collectionId`'s records changed; the document (and `version`) did not. */
  scope?: 'data'
  collectionId?: string
}

/** One-shot request for open editors to switch page; not document state. */
export interface NavigateEvent {
  projectId: string
  pageId: string
  nodeId: string | null
  source?: string
}

export interface ActionInfo {
  name: string
  description: string
  readOnly: boolean
  uiOnly: boolean
  inputSchema: Record<string, unknown>
}

export interface CallOptions {
  caller: ActionCaller
  source?: string
}

/**
 * The single dispatcher every surface goes through: look up, validate,
 * serialize per project, run, then emit change and navigate events. Nothing else may call
 * an action's `run`.
 */
export function createBildr(storage: KeyValueStorage, actions: ActionDef[] = ACTIONS, options: ServicesOptions = {}) {
  const services = createServices(storage, options)
  const byName = new Map(actions.map(a => [a.name, a]))
  const listeners = new Set<(event: ChangeEvent) => void>()
  const navigateListeners = new Set<(event: NavigateEvent) => void>()
  const locks = new Map<string, Promise<unknown>>()

  function withLock<T>(key: string | undefined, task: () => Promise<T>): Promise<T> {
    if (!key) return task()
    const previous = locks.get(key) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(task)
    locks.set(key, next)
    void next.catch(() => {}).finally(() => {
      if (locks.get(key) === next) locks.delete(key)
    })
    return next
  }

  async function call<T = unknown>(name: string, rawInput: unknown, options: CallOptions): Promise<T> {
    const action = byName.get(name)
    if (!action || (action.uiOnly && options.caller === 'mcp')) throw new ActionError('not_found', `Unknown action "${name}"`)

    const parsed = action.input.safeParse(rawInput ?? {})
    if (!parsed.success) throw new ActionError('invalid_input', z.prettifyError(parsed.error), parsed.error.issues)
    const input = parsed.data as Record<string, unknown>

    const changes: ChangeEvent[] = []
    const navigations: NavigateEvent[] = []
    const ctx: ActionContext = {
      caller: options.caller,
      source: options.source,
      services,
      notify: (projectId, version) => changes.push({ projectId, version, action: name, source: options.source }),
      notifyData: (projectId, version, collectionId) => changes.push({ projectId, version, action: name, source: options.source, scope: 'data', collectionId }),
      navigate: (projectId, pageId, nodeId) => navigations.push({ projectId, pageId, nodeId, source: options.source })
    }

    try {
      const projectId = typeof input.projectId === 'string' ? input.projectId : undefined
      const result = await withLock(action.readOnly ? undefined : projectId, () => action.run(input, ctx))
      if (!action.readOnly) for (const event of changes) listeners.forEach(listener => listener(event))
      for (const event of navigations) navigateListeners.forEach(listener => listener(event))
      return result as T
    } catch (error) {
      if (error instanceof OperationError) throw new ActionError(error.code, error.message)
      if (error instanceof z.ZodError) throw new ActionError('invalid', z.prettifyError(error), error.issues)
      throw error
    }
  }

  return {
    call,
    services,

    list(): ActionInfo[] {
      return actions.map(a => ({
        name: a.name,
        description: a.description,
        readOnly: a.readOnly === true,
        uiOnly: a.uiOnly === true,
        inputSchema: z.toJSONSchema(a.input, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
      }))
    },

    onChange(listener: (event: ChangeEvent) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    onNavigate(listener: (event: NavigateEvent) => void): () => void {
      navigateListeners.add(listener)
      return () => navigateListeners.delete(listener)
    }
  }
}

export type Bildr = ReturnType<typeof createBildr>
