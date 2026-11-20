import type { ApiSource } from '../edit/api.ts'
import type { Model } from '../model/load.ts'
import { apiNameProblem, apiSourceIdentifiers } from '../edit/generated-names.ts'
import { API_PATH } from '../model/schemas.ts'
import type { ApiAction, ApiField, ApiModel, ApiParam, ApiQuery } from '../model/schemas.ts'
import type { GeneratedFile } from '../sync/plan.ts'
import { docText, identifier, kebab, tsString } from './text.ts'

/** A generated file before its owner is set (every API file is managed). */
export type Emitted = Omit<GeneratedFile, 'owner'>

/**
 * What the API emitters (api.ts, api-server.ts, api-tests.ts) share: which sources they generate, the names
 * derived from a source and its operations, the type and zod expressions of a field or parameter, and the
 * sample values the generated tests use.
 */

/**
 * The API data sources that run on the server. Sources with `runtime: 'browser'` are not generated yet
 * (their domain and data are the same, but the client calls the API itself: slice P3), so they are skipped here.
 */
export const serverApiSources = (model: Pick<Model, 'datasources'>): ApiSource[] =>
  model.datasources.filter((source): source is ApiSource => source.kind === 'api' && source.runtime === 'server')

/** A source with no query and no action has nothing to call: it generates no code (only its runtimeConfig entry). */
export const isCallable = (source: ApiSource) => source.queries.length + source.actions.length > 0

export type ApiResult = NonNullable<ApiAction['result']>

/** A query or an action, as the emitters see them. */
export interface Operation {
  kind: 'query' | 'action'
  name: string
  description?: string
  method: 'GET' | ApiAction['method']
  path: string
  params: ApiParam[]
  /** The model the body is (actions only). */
  body?: string
  result?: ApiResult
}

/** The operation's description for a doc comment: one line, no closing comment, no final period (the sentence goes on). */
export const descriptionOf = (operation: Operation): string | undefined =>
  operation.description ? docText(operation.description).replace(/[.\s]+$/, '') || undefined : undefined

export const operationsOf = (source: ApiSource): Operation[] => [
  ...source.queries.map((query: ApiQuery): Operation => ({ kind: 'query', name: query.name, description: query.description, method: 'GET', path: query.path, params: query.params, result: query.result })),
  ...source.actions.map((action: ApiAction): Operation => ({ kind: 'action', name: action.name, description: action.description, method: action.method, path: action.path, params: action.params, body: action.body?.model, result: action.result }))
]

export interface SourceNames {
  /** `catalog`: the folder, the route segment. */
  dir: string
  /** `catalog`, `shopApi`: the runtimeConfig key and the deps key. */
  camel: string
  /** `Catalog`, `ShopApi`. */
  pascal: string
  /** The model file of the source: where the generated headers point. */
  source: string
  port: string
  portFile: string
  adapter: string
  adapterFile: string
  error: string
  failure: string
  root: string
  status: string
  client: string
  fake: string
}

/**
 * The names of a source's generated code. Throws (naming the source's file) for a source or a name the generated code can't take: the
 * `api_*` edits refuse the same names (edit/generated-names.ts), this is for a hand-written file.
 */
export const namesOf = (model: Pick<Model, 'paths'>, source: ApiSource): SourceNames => {
  const ids = apiSourceIdentifiers(source.name)
  const names: SourceNames = {
    dir: source.name,
    camel: ids.camel,
    pascal: ids.pascal,
    source: model.paths[source.id] ?? `.bildr/datasources/${source.name}.json`,
    port: ids.port,
    portFile: `${source.name}-repository`,
    adapter: ids.adapter,
    adapterFile: `${source.name}-repository.http`,
    error: ids.error,
    failure: ids.failure,
    root: ids.root,
    status: ids.status,
    client: ids.client,
    fake: ids.fake
  }
  const problem = apiNameProblem(source)
  if (problem) throw new Error(`${names.source}: ${problem}`)
  for (const operation of operationsOf(source)) {
    identifier(operation.name, `API "${source.name}", ${operation.kind} "${operation.name}"`)
    if (operation.params.some(param => param.name === 'body') && operation.body) throw new Error(`${names.source}: API "${source.name}": ${operation.kind} "${operation.name}" sends a body, so no parameter can be named "body"`)
  }
  return names
}

/** Where a model's files live. */
export const modelNames = (model: string) => ({
  type: model,
  schema: `${model}Schema`,
  dto: `${model}Dto`,
  dtoSchema: `${model}DtoSchema`,
  file: kebab(model),
  to: `to${model}`,
  from: `from${model}`
})

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

/** An object key in code: bare when it can be, quoted otherwise (remote keys can be `created-at`). */
export const propertyKey = (key: string) => IDENTIFIER.test(key) ? key : tsString(key)

/** A property read in code: `dto.created_at` or `dto['created-at']`. */
export const propertyAccess = (target: string, key: string) => IDENTIFIER.test(key) ? `${target}.${key}` : `${target}[${tsString(key)}]`

export const remoteKey = (item: ApiField | ApiParam) => item.key ?? item.name

export const modelOf = (source: ApiSource, name: string): ApiModel => {
  const model = source.models.find(entry => entry.name === name)
  if (!model) throw new Error(`API "${source.name}": unknown model "${name}"`)
  return model
}

/** The models a model's fields refer to, once each, in field order. */
export const nestedModels = (model: ApiModel): string[] => [...new Set(model.fields.flatMap(field => field.model ? [field.model] : []))]

// ── Types and zod expressions ──────────────────────────────────────────

const TS_VALUE: Record<ApiField['type'], string> = { text: 'string', integer: 'number', number: 'number', boolean: 'boolean', datetime: 'string', date: 'string', uuid: 'string', model: 'string' }

/** The TS type of a field's value, with `list` and `nullable` applied (`optional` is the property's `?`). */
export const fieldType = (field: ApiField, modelType: (name: string) => string): string => {
  const base = field.type === 'model' ? modelType(field.model!) : TS_VALUE[field.type]
  return `${field.list ? `${base}[]` : base}${field.nullable ? ' | null' : ''}`
}

/** The zod expression of a field's value over `base`: list, then nullable, then optional. */
export const wrapField = (field: ApiField, base: string): string =>
  `${field.list ? `z.array(${base})` : base}${field.nullable ? '.nullable()' : ''}${field.optional ? '.optional()' : ''}`

/** What a remote value is checked as: dates are strings the remote may write with an offset. */
export const DTO_VALUE: Record<ApiField['type'], string> = {
  text: 'z.string()',
  integer: 'z.number().int()',
  number: 'z.number()',
  boolean: 'z.boolean()',
  datetime: 'z.iso.datetime({ offset: true })',
  date: 'z.iso.date()',
  uuid: 'z.uuid()',
  model: ''
}

/** One value of a call's input: a parameter, or the body. */
export interface InputField {
  name: string
  ts: string
  /** The zod expression of the input (the use-case's check). */
  zod: string
  /** The zod expression of the same value read from a URL query string, where everything is text. */
  query: string
  optional: boolean
  /** The model of a body. */
  model?: string
}

const PARAM_TS: Record<ApiParam['type'], string> = { text: 'string', integer: 'number', number: 'number', boolean: 'boolean' }
const PARAM_ZOD: Record<ApiParam['type'], string> = { text: 'z.string()', integer: 'z.number().int()', number: 'z.number()', boolean: 'z.boolean()' }
const PARAM_QUERY: Record<ApiParam['type'], string> = { text: 'z.string()', integer: 'z.coerce.number().int()', number: 'z.coerce.number()', boolean: 'z.stringbool()' }

/** A call's input: its parameters (a path parameter is always required), then the body. */
export const inputFields = (operation: Operation): InputField[] => [
  ...operation.params.map((param): InputField => {
    const optional = param.in === 'query' && !param.required
    return {
      name: identifier(param.name, `parameter "${param.name}" of "${operation.name}"`),
      ts: PARAM_TS[param.type],
      zod: `${PARAM_ZOD[param.type]}${optional ? '.optional()' : ''}`,
      query: `${PARAM_QUERY[param.type]}${optional ? '.optional()' : ''}`,
      optional
    }
  }),
  ...(operation.body ? [{ name: 'body', ts: operation.body, zod: modelNames(operation.body).schema, query: '', optional: false, model: operation.body }] : [])
]

/** `{ id: number, category?: string }`: the type of a call's input. */
export const inputType = (fields: InputField[]) => `{ ${fields.map(field => `${field.name}${field.optional ? '?' : ''}: ${field.ts}`).join(', ')} }`

/** What a call returns, as a TS type. */
export const resultType = (operation: Operation) => operation.result ? `${operation.result.model}${operation.result.many ? '[]' : ''}` : 'void'

/**
 * `/products/:id` as a template literal over `target` (`input`): each path parameter through `segment` (the adapter's helper: encoded, and
 * never "", "." or "..", which the URL would resolve to another path). A path the model schema refuses is an error.
 */
export const pathTemplate = (path: string, target = 'input'): { code: string, dynamic: boolean } => {
  if (!API_PATH.test(path)) throw new Error(`"${path}" is not an API path`)
  const dynamic = path.includes(':')
  if (!dynamic) return { code: tsString(path), dynamic }
  // A path is made of \w, -, ~, ., / and :name: nothing in it needs escaping inside a template literal.
  return { code: `\`${path.replace(/:([a-z][A-Za-z0-9]*)/g, (_, name: string) => `\${segment(${target}.${name})}`)}\``, dynamic }
}

/** The route file name of an operation: `create-product.post.ts`. */
export const routeFile = (operation: Operation) => `${kebab(operation.name)}.${operation.method.toLowerCase()}.ts`

// ── Sample values (generated tests) ────────────────────────────────────

const SAMPLE: Record<ApiField['type'], (name: string) => string | number | boolean> = {
  text: name => `${name} 1`,
  integer: () => 1,
  number: () => 1.5,
  boolean: () => true,
  datetime: () => '2024-01-02T03:04:05.000Z',
  date: () => '2024-01-02',
  uuid: () => '00000000-0000-4000-8000-000000000001',
  model: () => ''
}

/**
 * How a sample model fills its fields. `full`: every field has a value. `absent`: an optional field is left out, a nullable one is
 * null, a list is empty. `empty`: a nullable field is null (an optional one too: null is not absent), a list is empty.
 */
export type SampleVariant = 'full' | 'absent' | 'empty'

/** A model's value as the API sends it (`remote: true`, remote keys) or as the domain has it (camelCase names). */
export const sampleModel = (source: ApiSource, name: string, remote: boolean, variant: SampleVariant = 'full'): Record<string, unknown> =>
  Object.fromEntries(modelOf(source, name).fields.flatMap((field): Array<[string, unknown]> => {
    const key = remote ? remoteKey(field) : field.name
    if (variant === 'absent' && field.optional) return []
    if (variant === 'absent' && field.nullable) return [[key, null]]
    if (variant !== 'full' && field.list) return [[key, []]]
    if (variant === 'empty' && field.nullable) return [[key, null]]
    const value = field.type === 'model' ? sampleModel(source, field.model!, remote) : SAMPLE[field.type](field.name)
    return [[key, field.list ? [value] : value]]
  }))

/** The variants of `name`'s sample that differ from each other: `full`, then the ones that leave out, null or empty something. */
export const sampleVariants = (source: ApiSource, name: string): Array<{ variant: SampleVariant, label: string }> => {
  const fields = modelOf(source, name).fields
  // What each variant does to the fields, as the sample above does it.
  const kinds = (variant: 'absent' | 'empty') => variant === 'absent'
    ? [
        ...(fields.some(field => field.optional) ? ['optional fields absent'] : []),
        ...(fields.some(field => field.nullable && !field.optional) ? ['nullable fields null'] : []),
        ...(fields.some(field => field.list && !field.nullable && !field.optional) ? ['lists empty'] : [])
      ].join(', ')
    : [
        ...(fields.some(field => field.nullable && !field.list) ? ['nullable fields null'] : []),
        ...(fields.some(field => field.list) ? ['lists empty'] : [])
      ].join(', ')
  const absent = kinds('absent')
  const empty = kinds('empty')
  return [
    { variant: 'full', label: 'every field has a value' },
    ...(absent ? [{ variant: 'absent' as const, label: absent }] : []),
    // The same sample as `absent` when no optional field is also nullable or a list.
    ...(empty && JSON.stringify(sampleModel(source, name, true, 'empty')) !== JSON.stringify(sampleModel(source, name, true, 'absent')) ? [{ variant: 'empty' as const, label: empty }] : [])
  ]
}

/** A call's input with a value for every parameter (optional ones too) and the body. */
export const sampleInput = (source: ApiSource, operation: Operation): Record<string, unknown> => ({
  ...Object.fromEntries(operation.params.map(param => [param.name, SAMPLE[param.type](param.name)])),
  ...(operation.body ? { body: sampleModel(source, operation.body, false) } : {})
})

/** What the API answers to `operation`: its result's model, in a list and under its `itemsPath` when it has them. */
export const sampleAnswer = (source: ApiSource, operation: Operation): unknown => {
  const result = operation.result
  if (!result) return undefined
  const one = sampleModel(source, result.model, true)
  if (!result.many) return one
  return (result.itemsPath ?? '').split('.').filter(Boolean).reduceRight<unknown>((value, key) => ({ [key]: value }), [one])
}
