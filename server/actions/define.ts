import type { z } from 'zod'
import type { Services } from './services'

/**
 * One action = one capability, shared by every surface (editor UI, HTTP,
 * MCP). Modelled on agent-native's `defineAction`: a zod input schema, a
 * description the agent reads, and a `run` that only the dispatcher calls.
 */

export type ActionCaller = 'ui' | 'http' | 'mcp'

export interface ActionContext {
  caller: ActionCaller
  /** Tab id of the editor that made the call; echoed on change events. */
  source?: string
  services: Services
  /** Records that `projectId` reached `version`; the dispatcher emits it on success. */
  notify: (projectId: string, version: number) => void
}

export interface ActionDef<I extends z.ZodType = z.ZodType, O = unknown> {
  name: string
  description: string
  input: I
  /** Read-only actions never emit change events. */
  readOnly?: boolean
  /** Hidden from agents (MCP); still callable by the editor. */
  uiOnly?: boolean
  run: (input: z.infer<I>, ctx: ActionContext) => Promise<O>
}

export function defineAction<I extends z.ZodType, O>(def: ActionDef<I, O>): ActionDef<I, O> {
  return def
}

export type ActionErrorCode = 'invalid_input' | 'not_found' | 'invalid' | 'forbidden'

export class ActionError extends Error {
  constructor(readonly code: ActionErrorCode, message: string, readonly issues: z.core.$ZodIssue[] = []) {
    super(message)
    this.name = 'ActionError'
  }
}
