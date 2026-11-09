import type { H3Error } from 'h3'
import { ActionError } from '../actions/define'
import { createBildr } from '../actions/runtime'
import type { Bildr } from '../actions/runtime'
import type { KeyValueStorage } from './projectStore'

let instance: Bildr | undefined

/** The process-wide dispatcher, backed by Nitro's `data` storage (`.data/kv` in dev). */
export function useBildr(): Bildr {
  instance ??= createBildr(useStorage('data') as unknown as KeyValueStorage)
  return instance
}

const STATUS: Record<ActionError['code'], number> = {
  invalid_input: 400,
  invalid: 422,
  forbidden: 403,
  not_found: 404
}

/** Maps an action failure to an HTTP error; other errors stay 500s. */
export function toHttpError(error: unknown): H3Error | unknown {
  if (!(error instanceof ActionError)) return error
  return createError({
    statusCode: STATUS[error.code],
    statusMessage: error.message.split('\n')[0],
    data: { code: error.code, message: error.message, issues: error.issues }
  })
}
