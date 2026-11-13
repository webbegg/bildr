import { z } from 'zod'
import { ActionError } from './define.ts'
import type { ActionContext, ActionDef } from './define.ts'
import { ACTIONS } from './registry.ts'

export interface ActionInfo {
  name: string
  description: string
  readOnly: boolean
  inputSchema: Record<string, unknown>
}

/**
 * The single dispatcher every surface goes through: look up, validate the
 * input, run. Nothing else calls an action's `run`.
 */
export const createActions = (ctx: ActionContext, actions: readonly ActionDef[] = ACTIONS) => {
  const byName = new Map(actions.map(action => [action.name, action]))
  return {
    async call(name: string, rawInput: unknown): Promise<unknown> {
      const action = byName.get(name)
      if (!action) throw new ActionError('not_found', `Unknown action "${name}"`)
      const parsed = action.input.safeParse(rawInput ?? {})
      if (!parsed.success) throw new ActionError('invalid_input', z.prettifyError(parsed.error))
      return await action.run(parsed.data, ctx)
    },

    list(): ActionInfo[] {
      return actions.map(action => ({
        name: action.name,
        description: action.description,
        readOnly: action.readOnly === true,
        inputSchema: z.toJSONSchema(action.input, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
      }))
    }
  }
}

export type Actions = ReturnType<typeof createActions>
