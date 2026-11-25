import type { ApiSource } from '../edit/api.ts'
import { apiComposableName } from './names.ts'
import type { Model } from '../model/load.ts'
import { headerNameOf } from '../model/schemas.ts'
import type { ApiField } from '../model/schemas.ts'
import type { GeneratedFile } from '../sync/plan.ts'
import { apiPaths, importPath } from './paths.ts'
import { apiSources, browserApiSources, descriptionOf, dtoValue, fieldNote, fieldType, inputFields, inputType, isCallable, modelNames, namesOf, nestedModels, operationsOf, pathTemplate, propertyAccess, propertyKey, remoteKey, resultType, serverApiSources, wrapField } from './api-model.ts'
import type { Emitted, Operation, SourceNames } from './api-model.ts'
import { generateBrowserRuntime } from './api-browser.ts'
import { generateApiLayer, generateServerRuntime } from './api-server.ts'
import { apiTestFiles } from './api-tests.ts'
import { zodField } from './entity.ts'
import type { KernelName } from './entity.ts'
import { importLine } from './imports.ts'
import { docText, file, header, kebab, pascal, tsString } from './text.ts'

/**
 * The clean-architecture layers of the `api` data sources (simple data, SD-5). Every source, whatever its
 * runtime, generates into the one layer `layers/apis/`:
 *
 * - domain (`shared/domain/<source>/`): the entities and their zod schemas, the repository port, one use-case
 *   per query and action, the errors. No Nuxt, no fetch.
 * - data (`shared/data/<source>/`): the DTOs the remote sends, their zod schemas, the mappers between both,
 *   the HTTP repository and the `ApiClient` port it calls through.
 * - the runtime: the server one (api-server.ts: composition root, Nitro routes, composables) for `runtime: 'server'`, the browser
 *   one (api-browser.ts: composition in app/, client over fetch, composables) for `runtime: 'browser'`. The domain and the data above
 *   are the same for both.
 * - the generated tests (api-tests.ts).
 *
 * Pure and deterministic.
 */
export const generateApis = (model: Model): GeneratedFile[] => {
  const sources = apiSources(model).filter(isCallable)
  if (!sources.length) return []
  const servers = serverApiSources(model).filter(isCallable)
  const browsers = browserApiSources(model).filter(isCallable)
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
    ...generateApiLayer(),
    ...(servers.length ? generateServerRuntime(model, servers) : []),
    ...(browsers.length ? generateBrowserRuntime(model, browsers) : [])
  ]
  return files.map(entry => ({ ...entry, owner: 'managed' as const })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

const sourceFiles = (model: Model, source: ApiSource): Emitted[] => {
  const names = namesOf(model, source)
  const paths = apiPaths(names.dir)
  const out: Emitted[] = []
  const add = (path: string, lines: Array<string | false | undefined>) => out.push({ path, source: names.source, content: file([header(names.source), ...lines]) })

  for (const apiModel of source.models) {
    const model = modelNames(apiModel.name)
    add(paths.entity(model.file), entityLines(apiModel.name, source))
    add(paths.dto(model.file), dtoLines(apiModel.name, source))
    add(paths.dtoSchema(model.file), dtoSchemaLines(apiModel.name, source))
    add(paths.mapper(model.file), mapperLines(apiModel.name, source))
  }
  add(paths.errors, errorLines(source, names))
  add(paths.port(names.portFile), portLines(source, names))
  for (const operation of operationsOf(source)) add(paths.useCase(kebab(operation.name)), useCaseLines(source, names, operation))
  add(paths.client, clientLines(names, importPath(paths.client, paths.errors)))
  add(paths.adapter(names.adapterFile), adapterLines(source, names))
  out.push(...apiTestFiles(source, names))
  return out
}

const modelOf = (source: ApiSource, name: string) => source.models.find(entry => entry.name === name)!

// ── Domain ─────────────────────────────────────────────────────────────

/** The types an entity checks as the entities of the other data sources do (`zodField`). */
const STORE_ALIKE = new Set<ApiField['type']>(['text', 'integer', 'number', 'boolean', 'date', 'uuid'])

/**
 * The zod expression of an entity field: the same scalars the entities of the other data sources use. A datetime, and a SaaS type
 * (email, money, select…), takes what the DTO takes. Its min/max (a text's length, a number's range) are checked here, on what the
 * app sends, and not on the DTO: an answer out of range still loads, but sending it back as it is is refused.
 */
const entityField = (field: ApiField, kernel: Set<KernelName>): string => {
  const base = field.type === 'model'
    ? modelNames(field.model!).schema
    : STORE_ALIKE.has(field.type)
      ? zodField({ id: 'fld_api', name: field.name, type: field.type as 'text', required: true }, kernel)
      : dtoValue(field)
  const ranged = `${base}${field.min !== undefined ? `.min(${field.min})` : ''}${field.max !== undefined ? `.max(${field.max})` : ''}`
  return wrapField(field, ranged)
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
  `/** Every expected failure of the "${source.name}" API: it answered with an error, it answered something unexpected, the input was not valid${source.auth ? ', or its secret is not set' : ''}. */`,
  `export type ${names.error} =`,
  '  | { type: \'remote_failed\', message: string, status: number }',
  '  | { type: \'invalid_answer\', message: string }',
  '  | { type: \'invalid_input\', message: string }',
  ...(source.auth ? ['  | { type: \'not_configured\', message: string }'] : []),
  '',
  `/** \`status\` is what the API answered, or 0 when it didn't answer; \`detail\` finishes "The API …". */`,
  `export const remoteFailed = (status: number, detail: string): ${names.error} => ({ type: 'remote_failed', message: \`The "${source.name}" API \${detail}.\`, status })`,
  '',
  // Where the detail of an invalid answer goes: the server log (the error reaches the browser) or, for a source that runs in the page, the console.
  source.runtime === 'browser'
    ? '/** The answer is not what the model says. The error has no detail: the UI shows it as it is, and the detail (field paths, what was expected) goes to console.warn. */'
    : '/** The answer is not what the model says. The error has no detail: it reaches the browser, and the detail (field paths, what was expected) is for the server log. */',
  `export const invalidAnswer = (): ${names.error} => ({ type: 'invalid_answer', message: ${tsString(`The "${source.name}" API answered something unexpected`)} })`,
  '',
  `export const invalidInput = (detail: string): ${names.error} => ({ type: 'invalid_input', message: \`The call to the "${source.name}" API is not valid: \${detail}\` })`
]

/** One line of the port: `products(input: { category?: string }): Promise<Product[]>`. */
const portMethod = (operation: Operation, errorName: string): string[] => {
  const fields = inputFields(operation)
  const about = descriptionOf(operation)
  const label = `${operation.kind === 'query' ? 'Query' : 'Action'} "${operation.name}"${about ? `: ${about}` : ''}`
  return [`  /** ${label} (${operation.method} ${docText(operation.path)}). */`, `  ${operation.name}(${fields.length ? `input: ${inputType(fields)}` : ''}): Promise<KernelResult<${resultType(operation)}, ${errorName}>>`]
}

/** `repositories/<s>-repository.ts`: the port, one method per query and action. */
const portLines = (source: ApiSource, names: SourceNames): string[] => {
  const operations = operationsOf(source)
  const models = [...new Set(operations.flatMap(operation => [operation.result?.model, operation.body]).filter((name): name is string => !!name))].sort()
  return [
    // Aliased: a model can be named Result.
    'import type { Result as KernelResult } from \'#core/kernel/result\'',
    ...models.map(name => importLine(`../entities/${modelNames(name).file}`, [{ name: modelNames(name).type, type: true }])),
    importLine('../errors', [{ name: names.error, type: true }]),
    '',
    `/** What the "${source.name}" API offers: one method per query and action, each answering its value or the ${names.error} of the call. */`,
    `export interface ${names.port} {`,
    operations.flatMap(operation => portMethod(operation, names.error)).join('\n'),
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
    fields.length > 0 && 'import { err } from \'#core/kernel/result\'',
    // Aliased: a model can be named Result.
    'import type { Result as KernelResult } from \'#core/kernel/result\'',
    ...[...byModel.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([model, entries]) => importLine(`../entities/${modelNames(model).file}`, entries)),
    importLine('../errors', [{ name: names.error, type: true }, ...(fields.length ? ['invalidInput'] : [])]),
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
    `    return ${call}`,
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
    model.fields.map((field) => {
      const note = fieldNote(field)
      return `${note ? `  /** ${docText(note)} */\n` : ''}  ${propertyKey(remoteKey(field))}${field.optional ? '?' : ''}: ${fieldType(field, nested => modelNames(nested).dto)}`
    }).join('\n'),
    '}'
  ]
}

const dtoSchemaLines = (name: string, source: ApiSource): string[] => {
  const model = modelOf(source, name)
  const names = modelNames(name)
  const fields = model.fields.map(field => `  ${propertyKey(remoteKey(field))}: ${wrapField(field, field.type === 'model' ? modelNames(field.model!).dtoSchema : dtoValue(field))}`)
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
    importLine(importPath(apiPaths(source.name).mapper(names.file), apiPaths(source.name).entity(names.file)), [{ name: names.type, type: true }]),
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

const clientLines = (names: SourceNames, errors: string): string[] => [
  // Aliased: a model can be named Result.
  'import type { Result as KernelResult } from \'#core/kernel/result\'',
  importLine(errors, [{ name: names.error, type: true }]),
  '',
  '/** One call to the API: the method, the query string and the headers (a value left undefined is not sent) and the JSON body. */',
  'export interface ApiRequest {',
  '  method: \'GET\' | \'POST\' | \'PUT\' | \'PATCH\' | \'DELETE\'',
  '  query?: Record<string, string | number | boolean | undefined>',
  '  headers?: Record<string, string | number | boolean | undefined>',
  '  body?: unknown',
  '}',
  '',
  '/** The port the HTTP repository calls through: the path under the API\'s base URL; the JSON answer (undefined when it is empty), or the error of the call. */',
  `export type ApiClient = (path: string, request: ApiRequest) => Promise<KernelResult<unknown, ${names.error}>>`
]

/** `repositories/<s>-repository.http.ts`: builds the paths and queries, reads `itemsPath`, validates with the DTO schemas, maps. */
const adapterLines = (source: ApiSource, names: SourceNames): Array<string | false> => {
  const operations = operationsOf(source)
  const results = operations.filter(operation => operation.result)
  const usesList = results.some(operation => operation.result!.many)
  const usesPath = results.some(operation => operation.result!.itemsPath)
  const usesSegment = operations.some(operation => pathTemplate(operation.path).dynamic)
  const usesHeaderText = operations.some(operation => operation.params.some(param => param.in === 'header' && param.type === 'text'))
  const unique = (names: Array<string | undefined>) => [...new Set(names.filter((name): name is string => !!name))].sort()
  const answered = unique(operations.map(operation => operation.result?.model))
  const sent = unique(operations.map(operation => operation.body))
  const adapter = apiPaths(source.name).adapter(names.adapterFile)
  const refuses = results.length > 0 || usesSegment || usesHeaderText
  return [
    results.length > 0 && importLine('zod', [{ name: 'ZodType', type: true }, ...(usesList ? ['z'] : [])]),
    operations.length > 0 && importLine('#core/kernel/result', [...(refuses ? ['err'] : []), 'ok']),
    // Aliased: a model can be named Result.
    refuses && 'import type { Result as KernelResult } from \'#core/kernel/result\'',
    ...answered.map(name => importLine(`../validations/${modelNames(name).file}.schema`, [modelNames(name).dtoSchema])),
    ...unique([...answered, ...sent]).map(name => importLine(`../mappers/${modelNames(name).file}.mapper`, [
      ...(answered.includes(name) ? [modelNames(name).to] : []),
      ...(sent.includes(name) ? [modelNames(name).from] : [])
    ])),
    // The errors the file makes: an invalid answer (a source with a result), and a path parameter that is not a segment or a header one that
    // is not one line. A source with none of them only passes the client's on.
    refuses && importLine(importPath(adapter, apiPaths(source.name).errors), [{ name: names.error, type: true }, ...(results.length ? ['invalidAnswer'] : []), ...(usesSegment || usesHeaderText ? ['invalidInput'] : [])]),
    importLine(importPath(adapter, apiPaths(source.name).port(names.portFile)), [{ name: names.port, type: true }]),
    importLine('../client', [{ name: 'ApiClient', type: true }]),
    '',
    ...(results.length
      ? [
          '/** The answer as `schema` reads it, or the error of an answer that is not what the model says: the error has no detail, `report` gets it. */',
          `const read = <T>(schema: ZodType<T>, answer: unknown, report?: (detail: string) => void): KernelResult<T, ${names.error}> => {`,
          '  const parsed = schema.safeParse(answer)',
          '  if (parsed.success) return ok(parsed.data)',
          '  report?.(parsed.error.message)',
          '  return err(invalidAnswer())',
          '}',
          ''
        ]
      : []),
    ...(usesSegment
      ? [
          '/** A path parameter as one segment of the path: encoded, and never empty, "." or ".." (the URL would resolve those to another path), nor with a "/" or a "\\" (that is two segments). */',
          `const segment = (value: string | number | boolean): KernelResult<string, ${names.error}> => {`,
          '  const text = String(value)',
          '  if (text === \'\' || text === \'.\' || text === \'..\') {',
          `    return err(invalidInput(\`a path parameter can't be \${text === '' ? 'empty' : \`"\${text}"\`}\`))`,
          '  }',
          `  if (/[/\\\\]/.test(text)) return err(invalidInput(${tsString('a path parameter is one segment of the path: it can\'t hold a "/" or a "\\"')}))`,
          '  return ok(encodeURIComponent(text))',
          '}',
          ''
        ]
      : []),
    ...(usesHeaderText
      ? [
          '/** A parameter sent in a header: one line of plain text (a line break would start another header), or undefined, which is not sent. */',
          `const headerValue = (value: string | undefined): KernelResult<string | undefined, ${names.error}> =>`,
          `  value !== undefined && !/^[\\x20-\\x7E]*$/.test(value) ? err(invalidInput(${tsString('a header parameter is one line of plain text')})) : ok(value)`,
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
    `/** ${names.port} over an ApiClient: builds each path and query, reads the answer where the model says it is, validates it and maps it to the domain. \`onInvalidAnswer\` gets the detail of an answer that is not valid (the error has none). */`,
    `export const ${names.adapter} = (http: ApiClient${results.length ? ', onInvalidAnswer?: (detail: string) => void' : ''}): ${names.port} => ({`,
    operations.map(operation => adapterMethod(operation)).join(',\n'),
    '})'
  ]
}

const adapterMethod = (operation: Operation): string => {
  const fields = inputFields(operation)
  const path = tsPath(operation)
  const query = operation.params.filter(param => param.in === 'query')
  const headers = [
    ...operation.headers.map(fixed => `${propertyKey(fixed.name)}: ${tsString(fixed.value)}`),
    ...operation.params.filter(param => param.in === 'header').map(param => `${propertyKey(headerNameOf(param))}: ${param.type === 'text' ? `${param.name}Header.value` : `input.${param.name}`}`)
  ]
  // A path or header parameter that can't be sent is refused before the call: each is checked first, into `<param>Segment` / `<param>Header`.
  const checks = [
    ...pathParams(operation.path).flatMap(name => [`    const ${name}Segment = segment(input.${name})`, `    if (!${name}Segment.ok) return ${name}Segment`]),
    ...operation.params.filter(param => param.in === 'header' && param.type === 'text')
      .flatMap(param => [`    const ${param.name}Header = headerValue(input.${param.name})`, `    if (!${param.name}Header.ok) return ${param.name}Header`])
  ]
  const request = [
    `method: ${tsString(operation.method)}`,
    ...(query.length ? [`query: { ${query.map(param => `${propertyKey(remoteKey(param))}: input.${param.name}`).join(', ')} }`] : []),
    ...(headers.length ? [`headers: { ${headers.join(', ')} }`] : []),
    ...(operation.body ? [`body: ${modelNames(operation.body).from}(input.body)`] : [])
  ]
  const call = `http(${path}, { ${request.join(', ')} })`
  const result = operation.result
  const head = `  async ${operation.name}(${fields.length ? 'input' : ''}) {`
  if (!result) return [head, ...checks, `    const answer = await ${call}`, '    return answer.ok ? ok(undefined) : answer', '  }'].join('\n')
  const names = modelNames(result.model)
  const answer = result.itemsPath ? `itemsAt(answer.value, [${result.itemsPath.split('.').map(tsString).join(', ')}])` : 'answer.value'
  const body = result.many
    ? [`    const dtos = read(z.array(${names.dtoSchema}), ${answer}, onInvalidAnswer)`, `    return dtos.ok ? ok(dtos.value.map(${names.to})) : dtos`]
    : [`    const dto = read(${names.dtoSchema}, ${answer}, onInvalidAnswer)`, `    return dto.ok ? ok(${names.to}(dto.value)) : dto`]
  return [head, ...checks, `    const answer = await ${call}`, '    if (!answer.ok) return answer', ...body, '  }'].join('\n')
}

/** The path parameters of an API path, in order, once each. */
const pathParams = (path: string): string[] => [...new Set([...path.matchAll(/:([a-z][A-Za-z0-9]*)/g)].map(match => match[1]!))]

const tsPath = (operation: Operation) => pathTemplate(operation.path, name => `${name}Segment.value`).code
