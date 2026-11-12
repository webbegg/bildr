import type { z } from 'zod'
import type { Services } from './services'

/**
 * One action = one capability, shared by every surface (editor UI, HTTP,
 * MCP). Modelled on agent-native's `defineAction`: a zod input schema, a
 * description the agent reads, and a `run` that only the dispatcher calls.
 */

/** `public`: an anonymous visitor of a published app, through the public data endpoint. */
export type ActionCaller = 'ui' | 'http' | 'mcp' | 'public'

export interface ActionContext {
  caller: ActionCaller
  /** Tab id of the editor that made the call; echoed on change events. */
  source?: string
  services: Services
  /** Records that `projectId` reached `version`; the dispatcher emits it on success. */
  notify: (projectId: string, version: number) => void
  /** Records that `collectionId`'s records changed; a `scope: 'data'` event, the document version stays `version`. */
  notifyData: (projectId: string, version: number, collectionId: string) => void
  /** Asks open editors of `projectId` to show a page (and node, or on a detail page a record to preview); emitted on success, never stored. */
  navigate: (projectId: string, pageId: string, nodeId: string | null, recordId?: string) => void
}

export interface ActionDef<I extends z.ZodType = z.ZodType, O = unknown> {
  name: string
  description: string
  input: I
  /** Read-only actions never emit change events. */
  readOnly?: boolean
  /** Hidden from agents (MCP); still callable by the editor. */
  uiOnly?: boolean
  /**
   * Server-only: callable by `public` callers alone, and never listed (so not
   * on MCP or `/api/actions`). Public callers can call nothing else.
   */
  publicOnly?: boolean
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
