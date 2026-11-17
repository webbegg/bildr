import { evaluateQuery } from '@bildr/codegen/query'
import type { QueryRun, Row } from '@bildr/codegen/query'
import type { QueryFile } from '@bildr/codegen/model'

/**
 * Runs a query in the editor (S10, DW-7b): the Data workspace's Query Results. The rows are the ones the collection's
 * Rows tab shows (the app's list route, or the Sample data), and the condition, ordering and limit are
 * `@bildr/codegen/query`'s `evaluateQuery`, the one the canvas already evaluates a page's queries with. It is checked
 * against the real TanStack DB live queries the generated `use<Name>` composable runs (`codegen/test/query/parity.test.ts`):
 * every operator (eq, ne, lt, lte, gt, gte, in, like), nulls, the ordering, the key order of a query without one and
 * the limit.
 *
 * What this adds is the parameters. Each has an input, typed by the parameter's type and prefilled with its default
 * (`paramDefaults`); `runQuery` turns the inputs into the arguments the composable would be called with.
 *
 * Where it differs from the generated composable, on purpose:
 * - The composable reads the app's client collection (every row, loaded eagerly up to the entity's `client.limit`);
 *   the editor reads the rows the Rows tab shows (at most 500, Live or Sample data), so a collection with more rows
 *   than that is evaluated over the first ones.
 * - A blank input is an argument that is not given: the parameter's default applies, as it does for the composable's
 *   default value; a parameter without one then matches nothing. The composable's TypeScript would not compile
 *   without it.
 * - An input that is not a value of the parameter's type (`many` for an integer) is a problem to show, not a value:
 *   no rows are returned. The composable can't be called with one.
 * - A `reactive` parameter is read once: nothing in the editor changes it while the query runs.
 * - `in` over a parameter reads the parameter as one value, which is never a list (a parameter has no list type), so
 *   it matches nothing; the generated `inArray` of a scalar would fail at run time.
 */

/** The text (or switch) of each parameter's input, by parameter name. */
export type ParamInputs = Record<string, string | boolean>

export interface QueryResult extends QueryRun {
  /** Why an input can't be read, by parameter name; when there is one, no rows are returned. */
  problems: Record<string, string>
}

type Param = QueryFile['params'][number]

/** The inputs a query starts with: each parameter's default (a switch for a boolean, else its text), or blank. */
export function paramDefaults(query: Pick<QueryFile, 'params'>): ParamInputs {
  return Object.fromEntries(query.params.map((param): [string, string | boolean] => {
    if (param.type === 'boolean') return [param.name, param.default === true]
    return [param.name, param.default === undefined || param.default === null ? '' : String(param.default)]
  }))
}

/** The argument an input stands for: undefined when it is blank (the default applies), a problem when it can't be read. */
function argument(param: Param, input: string | boolean | undefined): { value?: unknown, problem?: string } {
  if (param.type === 'boolean') return typeof input === 'boolean' ? { value: input } : input === 'true' || input === 'false' ? { value: input === 'true' } : {}
  const text = typeof input === 'string' ? input.trim() : ''
  if (text === '') return {}
  if (param.type === 'integer') return /^[+-]?\d+$/.test(text) ? { value: Number(text) } : { problem: 'Enter a whole number' }
  if (param.type === 'number') return Number.isFinite(Number(text)) ? { value: Number(text) } : { problem: 'Enter a number' }
  return { value: typeof input === 'string' ? input : text }
}

/** Runs `query` over `rows` with the parameters' `inputs`; the rows are not changed. */
export function runQuery(query: QueryFile, rows: readonly Row[], inputs: ParamInputs): QueryResult {
  const args: Record<string, unknown> = {}
  const problems: Record<string, string> = {}
  for (const param of query.params) {
    const { value, problem } = argument(param, inputs[param.name])
    if (problem) problems[param.name] = problem
    else if (value !== undefined) args[param.name] = value
  }
  if (Object.keys(problems).length) return { rows: [], total: 0, value: query.result === 'one' ? null : [], problems }
  return { ...evaluateQuery(query, rows, args), problems }
}
