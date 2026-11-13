import type { z } from 'zod'
import type { ModelProblem } from '@bildr/codegen/model'
import type { CheckName, CheckResult } from '../node/health.ts'
import type { MigrationOutcome } from '../node/regenerate.ts'

/**
 * One action = one editor operation, shared by every surface (the editor UI
 * through HTTP, agents through MCP), like the hosted app's registry
 * (`server/actions/define.ts`) but local to one project on disk (D12, S11).
 */

/** What the module gives the actions: the project and its one-at-a-time runners. */
export interface ActionContext {
  /** Project root. */
  root: string
  /** Runs the pending destructive migration whose hash the user confirmed (through the module's one-at-a-time regenerator). */
  confirmMigration?: (hash: string) => Promise<MigrationOutcome>
  /** Runs Health checks on demand (through the module's one-at-a-time runner) and returns their results. */
  runHealth?: (checks: CheckName[]) => Promise<CheckResult[]>
}

export interface ActionDef<I extends z.ZodType = z.ZodType, O = unknown> {
  name: string
  /** What the action does, for the agent that reads the MCP tool list. */
  description: string
  input: I
  /** Changes nothing on disk. */
  readOnly?: boolean
  run: (input: z.infer<I>, ctx: ActionContext) => Promise<O> | O
}

export const defineAction = <I extends z.ZodType, O>(def: ActionDef<I, O>): ActionDef<I, O> => def

export type ActionErrorCode = 'invalid_input' | 'not_found' | 'invalid' | 'forbidden' | 'unavailable'

/** HTTP status of each error code (the action contract of T10). */
export const ERROR_STATUS: Record<ActionErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  invalid: 422,
  forbidden: 403,
  unavailable: 501
}

export class ActionError extends Error {
  readonly code: ActionErrorCode
  readonly problems: ModelProblem[] | undefined

  // Plain fields, not parameter properties: Node's type stripping can't run those.
  constructor(code: ActionErrorCode, message: string, problems?: ModelProblem[]) {
    super(message)
    this.name = 'ActionError'
    this.code = code
    this.problems = problems
  }
}
