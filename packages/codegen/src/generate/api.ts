import type { ApiSource } from '../edit/api.ts'
import { apiComposableName } from '../edit/generated-names.ts'
import type { Model } from '../model/load.ts'
import type { ApiField } from '../model/schemas.ts'
import type { GeneratedFile } from '../sync/plan.ts'
import { descriptionOf, DTO_VALUE, fieldType, inputFields, inputType, isCallable, modelNames, namesOf, nestedModels, operationsOf, pathTemplate, propertyAccess, propertyKey, remoteKey, resultType, serverApiSources, wrapField } from './api-model.ts'
import type { Emitted, Operation, SourceNames } from './api-model.ts'
import { generateApiRuntime } from './api-server.ts'
import { apiTestFiles } from './api-tests.ts'
import { zodField } from './entity.ts'
import type { KernelName } from './entity.ts'
import { importLine } from './imports.ts'
import { docText, file, header, kebab, pascal, tsString } from './text.ts'

/**
 * The clean-architecture layers of the `api` data sources (simple data, SD-5). Every server-runtime source
 * generates into the one layer `layers/apis/`:
 *
 * - domain (`shared/domain/<source>/`): the entities and their zod schemas, the repository port, one use-case
 *   per query and action, the errors. No Nuxt, no fetch.
 * - data (`shared/data/<source>/`): the DTOs the remote sends, their zod schemas, the mappers between both,
 *   the HTTP repository and the `ApiClient` port it calls through.
 * - the server runtime (api-server.ts), the generated tests (api-tests.ts).
 *
 * Sources with `runtime: 'browser'` generate nothing yet (slice P3). Pure and deterministic.
 */
export const generateApis = (model: Model): GeneratedFile[] => {
  const sources = serverApiSources(model).filter(isCallable)
  if (!sources.length) return []
  // A composable is auto-imported by its name: two sources must not generate one name (`a-b` + `c` and `a` + `bC` are both useABC).
  const composables = new Map<string, string>()
  for (const source of sources) {
    for (const operation of operationsOf(source)) {
      const name = apiComposableName(source.name, operation.name)
      const other = composables.get(name)
      if (other) throw new Error(`${namesOf(model, source).source}: the ${operation.kind} "${operation.name}" of "${source.name}" and ${other} would both generate the composable ${name}: pick another name`)
      composables.set(name, `the operation "${operation.name}" of "${source.name}"`)
    }
  }
  const files = [
    ...sources.flatMap(source => sourceFiles(model, source)),
    ...generateApiRuntime(model, sources)
  ]
  return files.map(entry => ({ ...entry, owner: 'managed' as const })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

const sourceFiles = (model: Model, source: ApiSource): Emitted[] => {
  const names = namesOf(model, source)
  const domain = `layers/apis/shared/domain/${names.dir}`
  const data = `layers/apis/shared/data/${names.dir}`
  const out: Emitted[] = []
  const add = (path: string, lines: Array<string | false | undefined>) => out.push({ path, source: names.source, content: file([header(names.source), ...lines]) })

  for (const apiModel of source.models) {
    const model = modelNames(apiModel.name)
    add(`${domain}/entities/${model.file}.ts`, entityLines(apiModel.name, source))
    add(`${data}/models/${model.file}.dto.ts`, dtoLines(apiModel.name, source))
    add(`${data}/validations/${model.file}.schema.ts`, dtoSchemaLines(apiModel.name, source))
    add(`${data}/mappers/${model.file}.mapper.ts`, mapperLines(apiModel.name, source))
  }
  add(`${domain}/errors.ts`, errorLines(source, names))
  add(`${domain}/repositories/${names.portFile}.ts`, portLines(source, names))
  for (const operation of operationsOf(source)) add(`${domain}/use-cases/${kebab(operation.name)}.ts`, useCaseLines(source, names, operation))
  add(`${data}/client.ts`, clientLines())
  add(`${data}/repositories/${names.adapterFile}.ts`, adapterLines(source, names))
  out.push(...apiTestFiles(source, names))
  return out
}

const modelOf = (source: ApiSource, name: string) => source.models.find(entry => entry.name === name)!

// ── Domain ─────────────────────────────────────────────────────────────

/**
 * The zod expression of an entity field: the same scalars the entities of the other data sources use. A datetime takes what the
 * DTO takes (an offset too), so an entity fetched from the API is a valid body to send back.
 */
const entityField = (field: ApiField, kernel: Set<KernelName>): string => {
  const base = field.type === 'model'
    ? modelNames(field.model!).schema
    : field.type === 'datetime'
      ? DTO_VALUE.datetime
      : zodField({ id: 'fld_api', name: field.name, type: field.type, required: true }, kernel)
  return wrapField(field, base)
}

/** `entities/<m>.ts`: the entity type `<Model>` (camelCase fields) and its zod schema. */
const entityLines = (name: string, source: ApiSource): Array<string | false> => {
  const kernel = new Set<KernelName>()
  const fields = modelOf(source, name).fields.map(field => `  ${field.name}: ${entityField(field, kernel)}`)
  const names = modelNames(name)
  return [
    'import { z } from \'zod\'',
    kernel.size > 0 && importLine('#core/kernel/ids', [...kernel]),
    ...nestedModels(modelOf(source, name)).map(nested => importLine(`./${modelNames(nested).file}`, [modelNames(nested).schema])),
    '',
    `export const ${names.schema} = z.object({`,
    fields.join(',\n'),
    '})',
    `export type ${names.type} = z.infer<typeof ${names.schema}>`
  ]
}

const errorLines = (source: ApiSource, names: SourceNames): string[] => [
  `/** Every expected failure of the "${source.name}" API: it answered with an error, it answered something unexpected, or the input was not valid. */`,
  `export type ${names.error} =`,
  '  | { type: \'remote_failed\', message: string, status: number }',
  '  | { type: \'invalid_answer\', message: string }',
  '  | { type: \'invalid_input\', message: string }',
  '',
  `/** \`status\` is what the API answered, or 0 when it didn't answer; \`detail\` finishes "The API …". */`,
  `export const remoteFailed = (status: number, detail: string): ${names.error} => ({ type: 'remote_failed', message: \`The "${source.name}" API \${detail}.\`, status })`,
  '',
  `export const invalidAnswer = (detail: string): ${names.error} => ({ type: 'invalid_answer', message: \`The "${source.name}" API answered something unexpected: \${detail}\` })`,
  '',
  `export const invalidInput = (detail: string): ${names.error} => ({ type: 'invalid_input', message: \`The call to the "${source.name}" API is not valid: \${detail}\` })`,
  '',
  `/** Thrown by the repository and the client, caught by the use-cases: they return it as the error of their Result. */`,
  `export class ${names.failure} extends Error {`,
  `  readonly error: ${names.error}`,
  '',
  `  constructor(error: ${names.error}) {`,
  '    super(error.message)',
  `    this.name = '${names.failure}'`,
  '    this.error = error',
  '  }',
  '}'
]

/** One line of the port: `products(input: { category?: string }): Promise<Product[]>`. */
const portMethod = (operation: Operation): string[] => {
  const fields = inputFields(operation)
  const about = descriptionOf(operation)
  const label = `${operation.kind === 'query' ? 'Query' : 'Action'} "${operation.name}"${about ? `: ${about}` : ''}`
  return [`  /** ${label} (${operation.method} ${docText(operation.path)}). */`, `  ${operation.name}(${fields.length ? `input: ${inputType(fields)}` : ''}): Promise<${resultType(operation)}>`]
}

/** `repositories/<s>-repository.ts`: the port, one method per query and action. */
const portLines = (source: ApiSource, names: SourceNames): string[] => {
  const operations = operationsOf(source)
  const models = [...new Set(operations.flatMap(operation => [operation.result?.model, operation.body]).filter((name): name is string => !!name))].sort()
  return [
    ...models.map(name => importLine(`../entities/${modelNames(name).file}`, [{ name: modelNames(name).type, type: true }])),
    '',
    `/** What the "${source.name}" API offers: one method per query and action. A failure is thrown as ${names.failure}. */`,
    `export interface ${names.port} {`,
    operations.flatMap(portMethod).join('\n'),
    '}'
  ]
}

/** `use-cases/<op>.ts`: validates the input with the params schema, calls the repository, answers a Result. */
const useCaseLines = (source: ApiSource, names: SourceNames, operation: Operation): Array<string | false> => {
  const fields = inputFields(operation)
  const type = pascal(operation.name)
  const result = resultType(operation)
  // The entity types and schemas the use-case names, by model (one import per entity file).
  const byModel = new Map<string, Array<{ name: string, type?: boolean }>>()
  if (operation.result) byModel.set(operation.result.model, [{ name: operation.result.model, type: true }])
  if (operation.body) byModel.set(operation.body, [...byModel.get(operation.body) ?? [], { name: modelNames(operation.body).schema }])
  const about = descriptionOf(operation)
  const label = `${operation.kind === 'query' ? 'Query' : 'Action'} "${operation.name}" of the "${source.name}" API${about ? `: ${about}` : ''}`
  const call = `deps.${names.camel}.${operation.name}(${fields.length ? 'parsed.data' : ''})`
  return [
    fields.length > 0 && 'import { z } from \'zod\'',
    'import { err, ok } from \'#core/kernel/result\'',
    // Aliased: a model can be named Result.
    'import type { Result as KernelResult } from \'#core/kernel/result\'',
    ...[...byModel.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([model, entries]) => importLine(`../entities/${modelNames(model).file}`, entries)),
    importLine('../errors', [{ name: names.error, type: true }, names.failure, ...(fields.length ? ['invalidInput'] : [])]),
    importLine(`../repositories/${names.portFile}`, [{ name: names.port, type: true }]),
    '',
    ...(fields.length
      ? [
          `export const ${type}InputSchema = z.object({`,
          fields.map(field => `  ${field.name}: ${field.zod}`).join(',\n'),
          '})',
          `export type ${type}Input = z.infer<typeof ${type}InputSchema>`,
          ''
        ]
      : []),
    `export interface ${type}Deps {`,
    `  ${names.camel}: ${names.port}`,
    '}',
    '',
    `/** ${label}. */`,
    `export const ${operation.name} = (deps: ${type}Deps) =>`,
    `  async (${fields.length ? `input: ${type}Input` : ''}): Promise<KernelResult<${result}, ${names.error}>> => {`,
    ...(fields.length
      ? [
          `    const parsed = ${type}InputSchema.safeParse(input)`,
          '    if (!parsed.success) return err(invalidInput(parsed.error.message))'
        ]
      : []),
    '    try {',
    operation.result ? `      return ok(await ${call})` : `      await ${call}\n      return ok(undefined)`,
    '    } catch (cause) {',
    `      if (cause instanceof ${names.failure}) return err(cause.error)`,
    '      throw cause',
    '    }',
    '  }'
  ]
}

// ── Data ───────────────────────────────────────────────────────────────

const dtoLines = (name: string, source: ApiSource): string[] => {
  const model = modelOf(source, name)
  const names = modelNames(name)
  return [
    ...nestedModels(model).map(nested => importLine(`./${modelNames(nested).file}.dto`, [{ name: modelNames(nested).dto, type: true }])),
    ...(nestedModels(model).length ? [''] : []),
    `/** The JSON of a ${name} as the "${source.name}" API sends it and takes it: its keys, its dates as strings. */`,
    `export interface ${names.dto} {`,
    model.fields.map(field => `  ${propertyKey(remoteKey(field))}${field.optional ? '?' : ''}: ${fieldType(field, nested => modelNames(nested).dto)}`).join('\n'),
    '}'
  ]
}

const dtoSchemaLines = (name: string, source: ApiSource): string[] => {
  const model = modelOf(source, name)
  const names = modelNames(name)
  const fields = model.fields.map(field => `  ${propertyKey(remoteKey(field))}: ${wrapField(field, field.type === 'model' ? modelNames(field.model!).dtoSchema : DTO_VALUE[field.type])}`)
  return [
    'import { z } from \'zod\'',
    ...nestedModels(model).map(nested => importLine(`./${modelNames(nested).file}.schema`, [modelNames(nested).dtoSchema])),
    importLine(`../models/${names.file}.dto`, [{ name: names.dto, type: true }]),
    '',
    `/** Checks the JSON of a ${name} the "${source.name}" API answered. */`,
    `export const ${names.dtoSchema}: z.ZodType<${names.dto}> = z.object({`,
    fields.join(',\n'),
    '})'
  ]
}

/** `value` converted with `convert` (a mapper function), keeping a missing or null value as it is. */
const mapped = (value: string, field: ApiField, convert: string): string => {
  const guards = [...(field.optional ? [`${value} === undefined`] : []), ...(field.nullable ? [`${value} === null`] : [])]
  const core = field.list ? `${value}.map(${convert})` : `${convert}(${value})`
  return guards.length ? `${guards.join(' || ')} ? ${value} : ${core}` : core
}

const mapperLines = (name: string, source: ApiSource): string[] => {
  const model = modelOf(source, name)
  const names = modelNames(name)
  const nested = nestedModels(model)
  const entries = (direction: 'to' | 'from') => model.fields.map((field) => {
    const read = direction === 'to' ? propertyAccess('dto', remoteKey(field)) : `entity.${field.name}`
    const key = direction === 'to' ? field.name : propertyKey(remoteKey(field))
    const convert = field.type === 'model' ? modelNames(field.model!)[direction === 'to' ? 'to' : 'from'] : undefined
    return `  ${key}: ${convert ? mapped(read, field, convert) : read}`
  })
  return [
    ...nested.map(model => importLine(`./${modelNames(model).file}.mapper`, [modelNames(model).to, modelNames(model).from])),
    importLine(`../../../domain/${source.name}/entities/${names.file}`, [{ name: names.type, type: true }]),
    importLine(`../models/${names.file}.dto`, [{ name: names.dto, type: true }]),
    '',
    `/** The ${name} of the domain, from what the API sent. */`,
    `export const ${names.to} = (dto: ${names.dto}): ${names.type} => ({`,
    entries('to').join(',\n'),
    '})',
    '',
    `/** What the API takes for a ${name}, from the one of the domain (a request body). */`,
    `export const ${names.from} = (entity: ${names.type}): ${names.dto} => ({`,
    entries('from').join(',\n'),
    '})'
  ]
}

const clientLines = (): string[] => [
  '/** One call to the API: the method, the query string (a value left undefined is not sent) and the JSON body. */',
  'export interface ApiRequest {',
  '  method: \'GET\' | \'POST\' | \'PUT\' | \'PATCH\' | \'DELETE\'',
  '  query?: Record<string, string | number | boolean | undefined>',
  '  body?: unknown',
  '}',
  '',
  '/** The port the HTTP repository calls through: the path under the API\'s base URL, the JSON answer (undefined when it is empty). */',
  'export type ApiClient = (path: string, request: ApiRequest) => Promise<unknown>'
]

/** `repositories/<s>-repository.http.ts`: builds the paths and queries, reads `itemsPath`, validates with the DTO schemas, maps. */
const adapterLines = (source: ApiSource, names: SourceNames): Array<string | false> => {
  const operations = operationsOf(source)
  const results = operations.filter(operation => operation.result)
  const usesList = results.some(operation => operation.result!.many)
  const usesPath = results.some(operation => operation.result!.itemsPath)
  const usesSegment = operations.some(operation => pathTemplate(operation.path).dynamic)
  const unique = (names: Array<string | undefined>) => [...new Set(names.filter((name): name is string => !!name))].sort()
  const answered = unique(operations.map(operation => operation.result?.model))
  const sent = unique(operations.map(operation => operation.body))
  return [
    results.length > 0 && importLine('zod', [{ name: 'ZodType', type: true }, ...(usesList ? ['z'] : [])]),
    ...answered.map(name => importLine(`../validations/${modelNames(name).file}.schema`, [modelNames(name).dtoSchema])),
    ...unique([...answered, ...sent]).map(name => importLine(`../mappers/${modelNames(name).file}.mapper`, [
      ...(answered.includes(name) ? [modelNames(name).to] : []),
      ...(sent.includes(name) ? [modelNames(name).from] : [])
    ])),
    importLine(`../../../domain/${source.name}/errors`, [names.failure, ...(results.length ? ['invalidAnswer'] : []), ...(usesSegment ? ['invalidInput'] : [])]),
    importLine(`../../../domain/${source.name}/repositories/${names.portFile}`, [{ name: names.port, type: true }]),
    importLine('../client', [{ name: 'ApiClient', type: true }]),
    '',
    ...(results.length
      ? [
          '/** The answer as `schema` reads it, or the failure of an answer that is not what the model says. */',
          'const read = <T>(schema: ZodType<T>, answer: unknown): T => {',
          '  const parsed = schema.safeParse(answer)',
          `  if (!parsed.success) throw new ${names.failure}(invalidAnswer(parsed.error.message))`,
          '  return parsed.data',
          '}',
          ''
        ]
      : []),
    ...(usesSegment
      ? [
          '/** A path parameter as one segment of the path: encoded, and never empty, "." or ".." (the URL would resolve those to another path). */',
          'const segment = (value: string | number | boolean): string => {',
          '  const text = String(value)',
          '  if (text === \'\' || text === \'.\' || text === \'..\') {',
          `    throw new ${names.failure}(invalidInput(\`a path parameter can't be \${text === '' ? 'empty' : \`"\${text}"\`}\`))`,
          '  }',
          '  return encodeURIComponent(text)',
          '}',
          ''
        ]
      : []),
    ...(usesPath
      ? [
          '/** The value under `path` (property names) of the answer: undefined where the answer has no such property. */',
          'const itemsAt = (answer: unknown, path: string[]): unknown =>',
          '  path.reduce<unknown>((value, key) => typeof value === \'object\' && value !== null && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined, answer)',
          ''
        ]
      : []),
    `/** ${names.port} over an ApiClient: builds each path and query, reads the answer where the model says it is, validates it and maps it to the domain. */`,
    `export const ${names.adapter} = (http: ApiClient): ${names.port} => ({`,
    operations.map(operation => adapterMethod(operation)).join(',\n'),
    '})'
  ]
}

const adapterMethod = (operation: Operation): string => {
  const fields = inputFields(operation)
  const path = tsPath(operation)
  const query = operation.params.filter(param => param.in === 'query')
  const request = [
    `method: ${tsString(operation.method)}`,
    ...(query.length ? [`query: { ${query.map(param => `${propertyKey(remoteKey(param))}: input.${param.name}`).join(', ')} }`] : []),
    ...(operation.body ? [`body: ${modelNames(operation.body).from}(input.body)`] : [])
  ]
  const call = `http(${path}, { ${request.join(', ')} })`
  const result = operation.result
  const head = `  async ${operation.name}(${fields.length ? 'input' : ''}) {`
  if (!result) return [head, `    await ${call}`, '  }'].join('\n')
  const names = modelNames(result.model)
  const answer = result.itemsPath ? `itemsAt(answer, [${result.itemsPath.split('.').map(tsString).join(', ')}])` : 'answer'
  const body = result.many
    ? `    return read(z.array(${names.dtoSchema}), ${answer}).map(${names.to})`
    : `    return ${names.to}(read(${names.dtoSchema}, ${answer}))`
  return [head, `    const answer = await ${call}`, body, '  }'].join('\n')
}

const tsPath = (operation: Operation) => pathTemplate(operation.path).code
