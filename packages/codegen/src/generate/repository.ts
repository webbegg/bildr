import type { EntityFile, RepositoryFile } from '../model/schemas.ts'
import { allFields, datasourceOf, entityNames, keyOf } from './context.ts'
import type { Field, ModuleContext } from './context.ts'
import { contractImport, listContractNames } from './contracts.ts'
import { answersResult, sourceNames } from './rest-source.ts'
import { importLine } from './imports.ts'
import { importPath } from './paths.ts'
import { sampleOf, VALUE_TYPES } from '../model/field-types.ts'
import { camel, docText, file, header, pascal, snake, tsLiteral, tsString } from './text.ts'

const OPERATION_ORDER = ['list', 'get', 'create', 'update', 'delete'] as const
const has = (repository: RepositoryFile, op: RepositoryFile['operations'][number]) => repository.operations.includes(op)
const finderFields = (entity: EntityFile, repository: RepositoryFile): Field[] =>
  (repository.finders ?? []).map(finder => allFields(entity).find(field => field.id === finder.by)!).filter(Boolean)
const tsType = (field: Field) => VALUE_TYPES[field.type].ts
const findBy = (field: Field) => `findBy${pascal(field.name)}`

/** A column is nullable when the field is, or when it is optional without a default. */
const nullableColumn = (field: Field) => field.nullable || (!field.required && field.default === undefined)

// ── Drizzle schema ─────────────────────────────────────────────────────

export const tableName = (context: ModuleContext, entity: EntityFile, repository: RepositoryFile) =>
  repository.table ?? `${snake(context.name)}_${snake(entity.plural)}`

const column = (field: Field, builders: Set<string>, isKey: boolean) => {
  const name = tsString(snake(field.name))
  let expression: string
  if (field.type === 'boolean') {
    builders.add('integer')
    expression = `integer(${name}, { mode: 'boolean' })`
  } else if (field.type === 'integer') {
    builders.add('integer')
    expression = `integer(${name})`
  } else if (field.type === 'number' || field.type === 'money' || field.type === 'percent') {
    builders.add('real')
    expression = `real(${name})`
  } else if (field.type === 'select') {
    // Typed as the union of its options, as the domain schema is (the column stays TEXT: no migration when the options change).
    builders.add('text')
    expression = `text(${name}, { enum: [${(field.options ?? []).map(tsString).join(', ')}] })`
  } else {
    builders.add('text')
    expression = `text(${name})`
  }
  if (isKey) return `${expression}.primaryKey()`
  if (!nullableColumn(field)) expression += '.notNull()'
  if (field.unique) expression += '.unique()'
  if (field.default !== undefined) expression += `.default(${tsLiteral(field.default)})`
  return expression
}

/** `server/infrastructure/db/schema.ts`: one Drizzle table per entity stored in the app database. */
export const drizzleSchemaFile = (context: ModuleContext, stored: Array<{ entity: EntityFile, repository: RepositoryFile }>) => {
  const builders = new Set<string>(['sqliteTable'])
  const tables = stored.map(({ entity, repository }) => {
    const key = keyOf(entity)
    const columns = allFields(entity).map(field => `  ${field.name}: ${column(field, builders, field.name === key.name)}`)
    return [`export const ${entity.plural} = sqliteTable(${tsString(tableName(context, entity, repository))}, {`, columns.join(',\n'), '})']
  })
  const source = `.bildr/modules/${context.name}/entities`
  return {
    path: context.paths.dbSchema,
    source,
    content: file([
      header(source),
      importLine('drizzle-orm/sqlite-core', [...builders]),
      ...tables.flatMap(table => ['', ...table])
    ])
  }
}

// ── Port ───────────────────────────────────────────────────────────────

export const portFile = (context: ModuleContext, entity: EntityFile, repository: RepositoryFile) => {
  const names = entityNames(entity)
  const key = keyOf(entity)
  const source = datasourceOf(context, repository)
  const writable = has(repository, 'create') || has(repository, 'update') || has(repository, 'delete')
  const doc = source.kind === 'sqlite'
    ? `Persistence port for ${names.type}. Use-cases depend on this, never on Drizzle.`
    : source.kind === 'memory'
      ? `${writable ? 'Persistence' : 'Read-only'} port for ${names.type} (memory data source).`
      : `${writable ? 'Persistence' : 'Read-only'} port for ${names.type} (REST data source).`
  const answer = portAnswer(context, repository)
  const finders = () => finderFields(entity, repository).map(field => `  ${findBy(field)}(${field.name}: ${tsType(field)}): Promise<${answer.of(`${names.type} | undefined`)}>`)
  const methods: string[] = []
  for (const op of OPERATION_ORDER) {
    if (!has(repository, op)) {
      if (op === 'get') methods.push(...finders())
      continue
    }
    if (op === 'list') methods.push(`  list(page: PageRequest): Promise<${answer.of(`Page<${names.type}>`)}>`)
    if (op === 'get') methods.push(`  get(id: ${key.type}): Promise<${answer.of(`${names.type} | undefined`)}>`, ...finders())
    if (op === 'create') methods.push(`  create(${names.variable}: ${names.type}): Promise<${answer.of(names.type)}>`)
    if (op === 'update') methods.push(`  update(id: ${key.type}, ${names.variable}: ${names.type}): Promise<${answer.of(names.type)}>`)
    if (op === 'delete') methods.push(`  delete(id: ${key.type}): Promise<${answer.of('void')}>`)
  }
  return {
    path: context.paths.port(names.portFile),
    source: context.source(repository.id),
    content: file([
      header(context.source(repository.id)),
      has(repository, 'list') && 'import type { Page, PageRequest } from \'#core/kernel/page\'',
      ...answer.imports,
      `import type { ${names.type} } from '#${context.name}/domain/${names.file}'`,
      ...answer.sourceImports,
      '',
      `/** ${doc} */`,
      `export interface ${names.port} {`,
      ...methods,
      '}'
    ])
  }
}

// ── Drizzle adapter ────────────────────────────────────────────────────

const orderExpression = (table: string, repository: RepositoryFile, drizzle: Set<string>) => (repository.list?.orderBy ?? [])
  .map((order) => {
    drizzle.add(order.direction)
    return `${order.direction}(${table}.${order.field})`
  })

/** The first of `name`, `nameSuffix`, `nameSuffixSuffix`… that isn't taken. */
const freeName = (name: string, suffix: string, taken: ReadonlySet<string>) => {
  let free = name
  while (taken.has(free)) free += suffix
  return free
}

/** What the Drizzle adapter's module scope and method parameters already bind, besides the entity. */
const ADAPTER_NAMES = ['asc', 'count', 'db', 'desc', 'eq', 'id', 'limit', 'offset']

export const drizzleRepositoryFile = (context: ModuleContext, entity: EntityFile, repository: RepositoryFile) => {
  const names = entityNames(entity)
  const drizzle = new Set<string>()
  const finders = finderFields(entity, repository)
  // Whatever the entity is called, its table and its row never share a name with an import, a parameter or each other.
  const taken = new Set([...ADAPTER_NAMES, ...finders.map(field => field.name)])
  const row = freeName(names.variable, 'Row', taken)
  const table = freeName(entity.plural, 'Table', new Set([...taken, row]))
  // An optional field that is not nullable has a nullable column (empty when unset), but the domain type has no null:
  // the rows read back turn an empty one into unset.
  const unsetWhenNull = entity.fields.filter(field => !field.nullable && nullableColumn(field))
  const fromRow = unsetWhenNull.length ? freeName('fromRow', 'Read', new Set([...taken, row, table])) : undefined
  const read = (rows: string) => fromRow ? `${rows}.map(${fromRow})` : rows
  const body: string[] = []
  if (has(repository, 'list')) {
    drizzle.add('count')
    const order = orderExpression(table, repository, drizzle)
    // The destructured names live only in the callback, where the table is not used.
    body.push(
      '  async list({ limit, offset }) {',
      '    return Promise.all([',
      `      db.select().from(${table})${order.length ? `.orderBy(${order.join(', ')})` : ''}.limit(limit).offset(offset),`,
      `      db.select({ value: count() }).from(${table})`,
      `    ]).then(([items, [total]]) => ({ ${fromRow ? `items: ${read('items')}` : 'items'}, total: total?.value ?? 0 }))`,
      '  }'
    )
  }
  const lookups = [...(has(repository, 'get') ? [{ method: 'get', column: 'id', arg: 'id' }] : []), ...finders.map(field => ({ method: findBy(field), column: field.name, arg: field.name }))]
  for (const lookup of lookups) {
    drizzle.add('eq')
    const found = `db.select().from(${table}).where(eq(${table}.${lookup.column}, ${lookup.arg})).get()`
    body.push(`  async ${lookup.method}(${lookup.arg}) {`, `    return ${fromRow ? `${found}.then(found => found && ${fromRow}(found))` : found}`, '  }')
  }
  if (has(repository, 'create')) {
    body.push(`  async create(${row}: ${names.type}) {`, `    await db.insert(${table}).values(${row})`, `    return ${row}`, '  }')
  }
  if (has(repository, 'update')) {
    drizzle.add('eq')
    body.push(`  async update(id, ${row}: ${names.type}) {`, `    await db.update(${table}).set(${row}).where(eq(${table}.id, id))`, `    return ${row}`, '  }')
  }
  if (has(repository, 'delete')) {
    drizzle.add('eq')
    body.push('  async delete(id) {', `    await db.delete(${table}).where(eq(${table}.id, id))`, '  }')
  }
  const reads = has(repository, 'list') || lookups.length > 0
  const mapper = fromRow && reads
    ? [
        `/** A row as ${names.type} has it: an empty column of an optional field is unset. */`,
        `const ${fromRow} = (row: typeof ${table}.$inferSelect): ${names.type} => ({ ...row, ${unsetWhenNull.map(field => `${field.name}: row.${field.name} ?? undefined`).join(', ')} })`,
        ''
      ]
    : []
  const usesType = has(repository, 'create') || has(repository, 'update') || mapper.length > 0
  const path = context.paths.repository(names.file, 'drizzle')
  return {
    path,
    source: context.source(repository.id),
    content: file([
      header(context.source(repository.id)),
      drizzle.size > 0 && importLine('drizzle-orm', [...drizzle]),
      'import type { LibSQLDatabase } from \'drizzle-orm/libsql\'',
      usesType && `import type { ${names.type} } from '#${context.name}/domain/${names.file}'`,
      `import type { ${names.port} } from '${importPath(path, context.paths.port(names.portFile))}'`,
      `import { ${table === entity.plural ? table : `${entity.plural} as ${table}`} } from '${importPath(path, context.paths.dbSchema)}'`,
      '',
      ...mapper,
      `/** ${names.port} over the app database (Drizzle + libSQL). */`,
      `export const drizzle${names.port} = (db: LibSQLDatabase): ${names.port} => ({`,
      joinMethods(body),
      '})'
    ])
  }
}

/** Method blocks separated by commas: `  }` lines that close a method become `  },` except the last. */
const joinMethods = (lines: string[]) => lines
  .map((line, index) => line === '  }' && index < lines.length - 1 ? '  },' : line)
  .join('\n')

// ── Memory adapter (tests) ─────────────────────────────────────────────

const comparator = (entity: EntityFile, repository: RepositoryFile) => {
  const parts = (repository.list?.orderBy ?? []).map((order) => {
    const field = allFields(entity).find(entry => entry.name === order.field)
    const [x, y] = order.direction === 'desc' ? ['b', 'a'] : ['a', 'b']
    const type = field ? tsType(field) : 'string'
    const nullable = field ? nullableColumn(field) : false
    if (type === 'number') return `${nullable ? `(${x}.${order.field} ?? 0)` : `${x}.${order.field}`} - ${nullable ? `(${y}.${order.field} ?? 0)` : `${y}.${order.field}`}`
    if (type === 'boolean') return `Number(${x}.${order.field}) - Number(${y}.${order.field})`
    return nullable
      ? `(${x}.${order.field} ?? '').localeCompare(${y}.${order.field} ?? '')`
      : `${x}.${order.field}.localeCompare(${y}.${order.field})`
  })
  return parts.length ? `.sort((a, b) => ${parts.join(' || ')})` : ''
}

const memoryDoc = (context: ModuleContext, repository: RepositoryFile, port: string) => {
  const source = datasourceOf(context, repository)
  if (source.kind === 'memory') return `/** ${port} over the "${docText(source.name)}" memory data source: rows live in the server process, from its seed until it stops. Also used by use-case tests. */`
  return `/** In-memory ${port} for use-case tests. Same contract as the ${source.kind === 'sqlite' ? 'Drizzle' : 'REST'} one. */`
}

export const memoryRepositoryFile = (context: ModuleContext, entity: EntityFile, repository: RepositoryFile) => {
  const names = entityNames(entity)
  const row = names.variable
  // The twin of a REST repository answers as its port says: a Result, always ok (R1').
  const results = answersResult(context, repository)
  const answer = (value: string) => results ? `ok(${value})` : value
  const body: string[] = []
  if (has(repository, 'list')) body.push('    async list({ limit, offset }) {', `      return ${answer('{ items: sorted().slice(offset, offset + limit), total: rows.size }')}`, '    }')
  if (has(repository, 'get')) body.push('    async get(id) {', `      return ${answer('rows.get(id)')}`, '    }')
  for (const field of finderFields(entity, repository)) {
    body.push(`    async ${findBy(field)}(${field.name}) {`, `      return ${answer(`[...rows.values()].find(${row} => ${row}.${field.name} === ${field.name})`)}`, '    }')
  }
  if (has(repository, 'create')) body.push(`    async create(${row}) {`, `      rows.set(${row}.id, ${row})`, `      return ${answer(row)}`, '    }')
  if (has(repository, 'update')) body.push(`    async update(id, ${row}) {`, `      rows.set(id, ${row})`, `      return ${answer(row)}`, '    }')
  if (has(repository, 'delete')) body.push('    async delete(id) {', '      rows.delete(id)', ...(results ? ['      return ok(undefined)'] : []), '    }')
  const methods = body.map((line, index) => line === '    }' && index < body.length - 1 ? '    },' : line)
  const path = context.paths.repository(names.file, 'memory')
  return {
    path,
    source: context.source(repository.id),
    content: file([
      header(context.source(repository.id)),
      results && 'import { ok } from \'#core/kernel/result\'',
      `import type { ${names.type} } from '#${context.name}/domain/${names.file}'`,
      `import type { ${names.port} } from '${importPath(path, context.paths.port(names.portFile))}'`,
      '',
      memoryDoc(context, repository, names.port),
      `export const memory${names.port} = (seed: ${names.type}[] = []): ${names.port} => {`,
      `  const rows = new Map(seed.map(${row} => [${row}.id, ${row}]))`,
      has(repository, 'list') && `  const sorted = () => [...rows.values()]${comparator(entity, repository)}`,
      '  return {',
      ...methods,
      '  }',
      '}'
    ])
  }
}

// ── REST adapter ───────────────────────────────────────────────────────

interface RestEndpoint { method?: string, path: string }

interface RestConfig {
  list?: { method?: string, path: string, itemsPath: string, totalPath?: string }
  paging?: { style: string, limitParam?: string, offsetParam?: string }
  fieldMap?: Record<string, string>
  get?: RestEndpoint
  create?: RestEndpoint
  update?: RestEndpoint
  delete?: RestEndpoint
}

/** The operations a REST repository maps to one endpoint each, with their default HTTP method. */
const REST_ENDPOINTS = { get: 'GET', create: 'POST', update: 'PUT', delete: 'DELETE' } as const
type RestEndpointOp = keyof typeof REST_ENDPOINTS

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
const member = (object: string, key: string) => IDENTIFIER.test(key) ? `${object}.${key}` : `${object}[${tsString(key)}]`
const property = (key: string) => IDENTIFIER.test(key) ? key : tsString(key)

const restConfig = (repository: RepositoryFile): RestConfig & { paging: { style: string, limitParam: string, offsetParam: string } } => {
  const rest = (repository.rest ?? {}) as RestConfig
  if (repository.finders?.length) throw new Error(`${repository.id}: REST finders are not generated yet`)
  if (has(repository, 'list') && !rest.list) throw new Error(`${repository.id}: a REST repository needs rest.list`)
  for (const op of Object.keys(REST_ENDPOINTS) as RestEndpointOp[]) {
    if (!has(repository, op)) continue
    const endpoint = rest[op]
    if (!endpoint) throw new Error(`${repository.id}: the REST operation "${op}" needs rest.${op} (its endpoint, like {"path": "/items"})`)
    const params = endpoint.path.split('/').filter(segment => segment.startsWith(':'))
    if (op !== 'create' && !params.includes(':id')) throw new Error(`${repository.id}: rest.${op}.path needs an :id segment (like "/items/:id")`)
    if (params.filter(param => param === ':id').length > 1) throw new Error(`${repository.id}: rest.${op}.path has :id more than once`)
    if (params.some(param => param !== ':id')) throw new Error(`${repository.id}: rest.${op}.path: only the :id parameter is generated yet`)
  }
  const paging = rest.paging?.style ?? 'offset'
  if (paging !== 'offset') throw new Error(`${repository.id}: REST paging style "${paging}" is not generated yet (supported: offset)`)
  for (const key of [rest.list?.itemsPath, rest.list?.totalPath].filter(Boolean) as string[]) {
    if (!IDENTIFIER.test(key)) throw new Error(`${repository.id}: nested response paths ("${key}") are not generated yet`)
  }
  return { ...rest, paging: { style: paging, limitParam: rest.paging?.limitParam ?? 'limit', offsetParam: rest.paging?.offsetParam ?? 'offset' } }
}

/** Whether a REST repository does more than list: then it gets the full adapter and an in-memory twin for use-case tests. */
export const restDoesMoreThanList = (repository: RepositoryFile) => repository.operations.some(op => op !== 'list')

/** Model field → remote key, in the field map's order (all entity fields when no map is given). */
const remoteFields = (entity: EntityFile, rest: RestConfig) => {
  const map = rest.fieldMap ?? Object.fromEntries(allFields(entity).map(field => [field.name, field.name]))
  return Object.entries(map).map(([name, remote]) => ({ field: allFields(entity).find(entry => entry.name === name)!, remote }))
}

/** `name` when the remote parameter is named like the local variable, `remote: name` otherwise. */
const shorthand = (remote: string, variable: string) => remote === variable ? variable : `${property(remote)}: ${variable}`

const pagingQuery = (rest: ReturnType<typeof restConfig>) =>
  `{ ${shorthand(rest.paging.limitParam!, 'limit')}, ${shorthand(rest.paging.offsetParam!, 'offset')} }`

/**
 * The REST adapter (codegen-architecture R1'): it calls through an ApiClient, so a failed call is the source's error, and it reads every
 * answer through one schema that maps the remote names and then checks the result with the entity's own schema (its defaults applied).
 * An answer that isn't what the model says is invalid_answer, its detail to `onInvalidAnswer` (the server log), never in the error.
 */
export const restRepositoryFile = (context: ModuleContext, entity: EntityFile, repository: RepositoryFile) => {
  const names = entityNames(entity)
  const rest = restConfig(repository)
  const source = datasourceOf(context, repository)
  const fields = remoteFields(entity, rest)
  const errors = sourceNames(context, source)
  const variable = names.variable
  // The adapter's own locals, named so a variable of the entity's name can't shadow them.
  const answer = freeName('answer', '_', new Set([variable]))
  const itemSchema = `${names.type}AnswerSchema`
  const pageSchema = `${names.type}PageAnswerSchema`
  const writes = has(repository, 'create') || has(repository, 'update')
  const byId = has(repository, 'get') || has(repository, 'update') || has(repository, 'delete')
  const call = (op: RestEndpointOp, extra: string[] = []) =>
    `const ${answer} = await http(${op === 'create' ? tsString(rest.create!.path) : idPath(rest[op]!.path)}, { ${[`method: ${tsString(methodOf(rest, op))}`, ...extra].join(', ')} })`
  const body: string[] = []
  if (has(repository, 'list')) {
    const list = rest.list!
    body.push(
      '  async list({ limit, offset }) {',
      `    const ${answer} = await http(${tsString(list.path)}, { method: 'GET', query: ${pagingQuery(rest)} })`,
      `    if (!${answer}.ok) return ${answer}`,
      `    const page = read(${pageSchema}, ${answer}.value)`,
      `    return page.ok ? ok({ items: ${member('page.value', list.itemsPath)}, total: ${list.totalPath ? member('page.value', list.totalPath) : `${member('page.value', list.itemsPath)}.length`} }) : page`,
      '  }'
    )
  }
  if (has(repository, 'get')) {
    body.push(
      '  async get(id) {',
      `    ${call('get')}`,
      '    // The source has no such row: it answered 404, or nothing.',
      `    if (!${answer}.ok) return ${answer}.error.type === 'not_found' ? ok(undefined) : ${answer}`,
      `    return ${answer}.value === undefined ? ok(undefined) : read(${itemSchema}, ${answer}.value)`,
      '  }'
    )
  }
  for (const op of ['create', 'update'] as const) {
    if (!has(repository, op)) continue
    body.push(
      `  async ${op}(${op === 'update' ? 'id, ' : ''}${variable}: ${names.type}) {`,
      `    ${call(op, [`body: toRow(${variable})`])}`,
      `    if (!${answer}.ok) return ${answer}`,
      '    // A source that answers nothing took the row as it was sent.',
      `    return ${answer}.value === undefined ? ok(${variable}) : read(${itemSchema}, ${answer}.value)`,
      '  }'
    )
  }
  if (has(repository, 'delete')) {
    body.push(
      '  async delete(id) {',
      `    ${call('delete')}`,
      '    // A row the source has no longer (404) is deleted already, as the in-memory twin says.',
      `    return ${answer}.ok || ${answer}.error.type === 'not_found' ? ok(undefined) : ${answer}`,
      '  }'
    )
  }
  const path = context.paths.repository(names.file, 'rest')
  const paging = has(repository, 'list') ? ` Paging style: offset (${docText(String(rest.paging.offsetParam))}/${docText(String(rest.paging.limitParam))}).` : ''
  return {
    path,
    source: context.source(repository.id),
    content: file([
      header(context.source(repository.id)),
      'import { z } from \'zod\'',
      'import type { ApiClient } from \'#core/http/api-client\'',
      'import { type Result, err, ok } from \'#core/kernel/result\'',
      importLine(`#${context.name}/domain/${names.file}`, [...(writes ? [{ name: names.type, type: true }] : []), `${names.type}Schema`]),
      importLine(errors.from, [{ name: errors.error, type: true }, errors.invalidAnswer]),
      `import type { ${names.port} } from '${importPath(path, context.paths.port(names.portFile))}'`,
      '',
      `/** A ${names.type} as the "${docText(source.name)}" source sends it: its remote names mapped, then checked with ${names.type}'s own rules. */`,
      `const ${itemSchema} = z.record(z.string(), z.unknown())`,
      // Typed as what the entity's schema takes: the pipe checks it right after.
      `  .transform(row => ({ ${fields.map(({ field, remote }) => `${field.name}: ${member('row', remote)}`).join(', ')} }) as z.input<typeof ${names.type}Schema>)`,
      `  .pipe(${names.type}Schema)`,
      ...(has(repository, 'list')
        ? [
            '',
            `/** A page of ${entity.plural} as the source sends it. */`,
            `const ${pageSchema} = z.object({ ${property(rest.list!.itemsPath)}: z.array(${itemSchema})${rest.list!.totalPath ? `, ${property(rest.list!.totalPath)}: z.number()` : ''} })`
          ]
        : []),
      writes && '',
      writes && `const toRow = (${variable}: ${names.type}) => ({ ${fields.map(({ field, remote }) => `${property(remote)}: ${variable}.${field.name}`).join(', ')} })`,
      byId && '',
      byId && SEGMENT_HELPER,
      '',
      `/** ${names.port} over the "${docText(source.name)}" REST data source.${paging} A failed call answers its error; an answer that is not what the model says answers invalid_answer, its detail to \`onInvalidAnswer\`. */`,
      `export const rest${names.port} = (http: ApiClient<${errors.error}>, onInvalidAnswer?: (detail: string) => void): ${names.port} => {`,
      '  /** The answer as `schema` reads it, or invalid_answer. */',
      `  const read = <S extends z.ZodType>(schema: S, value: unknown): Result<z.output<S>, ${errors.error}> => {`,
      '    const checked = schema.safeParse(value)',
      '    if (checked.success) return ok(checked.data)',
      '    onInvalidAnswer?.(checked.error.message)',
      `    return err(${errors.invalidAnswer}())`,
      '  }',
      '  return {',
      joinMethods(body).split('\n').map(line => line ? `  ${line}` : line).join('\n'),
      '  }',
      '}'
    ])
  }
}

/**
 * A value a field's own rules take, for a test whose adapter checks them: the catalogue's sample of its type, within its bounds. With a
 * pattern, its default when that matches (a value for any pattern is not generated yet).
 */
const validSample = (field: Field): string | number | boolean => {
  if (field.pattern !== undefined && typeof field.default === 'string' && new RegExp(field.pattern).test(field.default)) return field.default
  const value = sampleOf(field)
  if (typeof value === 'number') return Math.min(Math.max(value, field.min ?? value), field.max ?? value)
  if (typeof value === 'string' && field.type === 'text') {
    const long = field.min !== undefined && value.length < field.min ? value.padEnd(field.min, 'x') : value
    return field.max !== undefined ? long.slice(0, field.max) : long
  }
  return value
}

/** A generated adapter test: fields and paging map to the REST source as modeled. */
/** A row of the entity as the adapter answers it: each mapped field's sample, and an unmapped one's default (its schema applies it). */
const modelSample = (entity: EntityFile, fields: Array<{ field: Field, remote: string }>) => allFields(entity).flatMap((field) => {
  if (fields.some(entry => entry.field.name === field.name)) return [`${field.name}: ${tsLiteral(validSample(field))}`]
  if (field.default !== undefined) return [`${field.name}: ${tsLiteral(field.default)}`]
  return field.nullable ? [`${field.name}: null`] : []
})

/** A generated adapter test: each operation calls its endpoint with the remote names, and answers the source's errors (R1'). */
export const restRepositoryTestFile = (context: ModuleContext, entity: EntityFile, repository: RepositoryFile) => {
  const names = entityNames(entity)
  const rest = restConfig(repository)
  const fields = remoteFields(entity, rest)
  const errors = sourceNames(context, datasourceOf(context, repository))
  const adapter = `rest${names.port}`
  const key = fields.find(({ field }) => field.name === keyOf(entity).name)
  const id = key ? validSample(key.field) : SAMPLE_UUID
  const at = (path: string) => tsString(path.replace(':id', encodeURIComponent(String(id))))
  const request = (op: RestEndpointOp, extra: string[]) => `{ ${[`method: ${tsString(methodOf(rest, op))}`, ...extra].join(', ')} }`
  const page = (rows: string) => `{ ${property(rest.list!.itemsPath)}: ${rows}${rest.list!.totalPath ? `, ${property(rest.list!.totalPath)}: 40` : ''} }`
  // The first operation is the one the failure tests call; one that reads an answer, the invalid-answer test.
  const first = OPERATION_ORDER.find(op => has(repository, op))!
  const callOf = (op: typeof first) => op === 'list'
    ? 'list({ limit: 10, offset: 0 })'
    : op === 'create' ? `create(${names.variable})` : op === 'update' ? `update(${tsLiteral(id)}, ${names.variable})` : `${op}(${tsLiteral(id)})`
  const reads = OPERATION_ORDER.find(op => op !== 'delete' && has(repository, op))
  const tests: string[][] = []
  if (has(repository, 'list')) {
    tests.push([
      '  it(\'maps fields and offset paging to the REST source\', async () => {',
      `    const { calls, repository } = fake(ok(${page('[row]')}))`,
      `    expect(await repository.list({ limit: 10, offset: 20 })).toEqual(ok({ items: [${names.variable}], total: ${rest.list!.totalPath ? 40 : 1} }))`,
      `    expect(calls).toEqual([{ path: ${tsString(rest.list!.path)}, request: { method: 'GET', query: { ${property(rest.paging.limitParam)}: 10, ${property(rest.paging.offsetParam)}: 20 } } }])`,
      '  })'
    ])
  }
  if (has(repository, 'get')) {
    tests.push([
      '  it(\'gets one by id, and undefined when the source has none (404, or nothing)\', async () => {',
      '    const found = fake(ok(row))',
      `    expect(await found.repository.get(${tsLiteral(id)})).toEqual(ok(${names.variable}))`,
      `    expect(found.calls).toEqual([{ path: ${at(rest.get!.path)}, request: ${request('get', [])} }])`,
      `    expect(await fake(err(${errors.failed}('not_found', 404, 'answered 404'))).repository.get(${tsLiteral(id)})).toEqual(ok(undefined))`,
      `    expect(await fake(ok(undefined)).repository.get(${tsLiteral(id)})).toEqual(ok(undefined))`,
      '  })'
    ])
  }
  for (const op of ['create', 'update'] as const) {
    if (!has(repository, op)) continue
    tests.push([
      `  it('${op === 'create' ? 'creates' : 'updates'} with the remote names, and answers the row sent when the source answers nothing', async () => {`,
      '    const { calls, repository } = fake(ok(row))',
      `    expect(await repository.${callOf(op)}).toEqual(ok(${names.variable}))`,
      `    expect(calls).toEqual([{ path: ${op === 'create' ? tsString(rest.create!.path) : at(rest.update!.path)}, request: ${request(op, ['body: row'])} }])`,
      `    expect(await fake(ok(undefined)).repository.${callOf(op)}).toEqual(ok(${names.variable}))`,
      '  })'
    ])
  }
  if (has(repository, 'delete')) {
    tests.push([
      '  it(\'deletes by id, and a row the source has no longer is deleted already (404)\', async () => {',
      '    const { calls, repository } = fake(ok(undefined))',
      `    expect(await repository.delete(${tsLiteral(id)})).toEqual(ok(undefined))`,
      `    expect(calls).toEqual([{ path: ${at(rest.delete!.path)}, request: ${request('delete', [])} }])`,
      `    expect(await fake(err(${errors.failed}('not_found', 404, 'answered 404'))).repository.delete(${tsLiteral(id)})).toEqual(ok(undefined))`,
      '  })'
    ])
  }
  tests.push([
    '  it(\'answers the error of a failed call\', async () => {',
    `    const failed = ${errors.failed}('unavailable', 503, 'answered 503')`,
    `    expect(await fake(err(failed)).repository.${callOf(first)}).toEqual(err(failed))`,
    '  })'
  ])
  if (reads) {
    tests.push([
      '  it(\'answers invalid_answer for an answer that is not what the model says, its detail to onInvalidAnswer\', async () => {',
      '    const details: string[] = []',
      `    const answer = await ${adapter}(async () => ok(${reads === 'list' ? page('\'not a list\'') : '\'not a row\''}), (detail) => {`,
      '      details.push(detail)',
      `    }).${callOf(reads)}`,
      `    expect(answer).toEqual(err(${errors.invalidAnswer}()))`,
      '    expect(details).toHaveLength(1)',
      '  })'
    ])
  }
  const lookup = (['get', 'update', 'delete'] as const).find(op => has(repository, op))
  // Only text keys can be "." or ".." (a numeric key can't, and passing one wouldn't typecheck).
  if (lookup && typeof id === 'string') {
    tests.push([
      '  it(\'refuses ids that would change the path\', async () => {',
      '    const { calls, repository } = fake(ok(row))',
      ...['..', '.', ''].map(bad => `    await expect(repository.${lookup}(${tsLiteral(bad)}${lookup === 'update' ? `, ${names.variable}` : ''})).rejects.toThrow('Not a valid id for a REST path')`),
      '    expect(calls).toEqual([])',
      '  })'
    ])
  }
  const path = context.paths.test(`infrastructure/${names.file}.rest.test.ts`)
  return {
    path,
    source: context.source(repository.id),
    content: file([
      header(context.source(repository.id)),
      'import { describe, expect, it } from \'vitest\'',
      'import type { ApiClient } from \'#core/http/api-client\'',
      'import { type Result, err, ok } from \'#core/kernel/result\'',
      importLine(errors.from, [{ name: errors.error, type: true }, errors.failed, ...(reads ? [errors.invalidAnswer] : [])]),
      `import { ${adapter} } from '${importPath(path, context.paths.repository(names.file, 'rest'))}'`,
      '',
      // The adapter checks each row with the entity's rules, so the samples meet them.
      `const row = { ${fields.map(({ field, remote }) => `${property(remote)}: ${tsLiteral(validSample(field))}`).join(', ')} }`,
      `const ${names.variable} = { ${modelSample(entity, fields).join(', ')} }`,
      '',
      '/** A fake REST source that answers every call with `answer` and records the calls. */',
      `const fake = (answer: Result<unknown, ${errors.error}>) => {`,
      '  const calls: unknown[] = []',
      `  const http: ApiClient<${errors.error}> = async (path, request) => {`,
      '    calls.push({ path, request })',
      '    return answer',
      '  }',
      `  return { calls, repository: ${adapter}(http) }`,
      '}',
      '',
      `describe('${adapter}', () => {`,
      tests.map(test => test.join('\n')).join('\n\n'),
      '})'
    ])
  }
}

// ── REST paths ─────────────────────────────────────────────────────────

/** `/posts/:id` → a template literal with the key as one URL-encoded segment. */
const idPath = (path: string) => `\`${path.replace(':id', '${segment(id)}')}\``

/** The generated guard: encoding keeps "/" inside the segment, but "." and ".." are resolved away by URL parsing. */
const SEGMENT_HELPER = [
  '/** The key as one path segment. "." and ".." would move the request to another path, so they are refused. */',
  'const segment = (id: unknown) => {',
  '  const value = String(id)',
  '  if (value === \'\' || value === \'.\' || value === \'..\') throw new Error(`Not a valid id for a REST path: ${JSON.stringify(value)}`)',
  '  return encodeURIComponent(value)',
  '}'
].join('\n')

const methodOf = (rest: RestConfig, op: RestEndpointOp) => rest[op]?.method ?? REST_ENDPOINTS[op]

/** The key of a test row when the field map leaves it out. */
const SAMPLE_UUID = '00000000-0000-4000-8000-000000000001'

/** What a repository's operations answer: the value, or (from a REST source, R1') the value or the source's error. */
const portAnswer = (context: ModuleContext, repository: RepositoryFile) => {
  if (!answersResult(context, repository)) return { of: (type: string) => type, imports: [], sourceImports: [] }
  const source = sourceNames(context, datasourceOf(context, repository))
  return {
    of: (type: string) => `Result<${type === 'void' ? 'undefined' : type}, ${source.error}>`,
    imports: ['import type { Result } from \'#core/kernel/result\''],
    sourceImports: [`import type { ${source.error} } from '${source.from}'`]
  }
}

/** What listing answers: the page, or the page or the source's error. */
const listAnswer = (context: ModuleContext, entity: EntityFile, repository: RepositoryFile) => {
  const answer = portAnswer(context, repository)
  return { ...answer, type: answer.of(`Page<${entityNames(entity).type}>`) }
}

// ── List use-case and route ────────────────────────────────────────────

export const listUseCaseFile = (context: ModuleContext, entity: EntityFile, repository: RepositoryFile) => {
  const names = entityNames(entity)
  const useCase = `list${pascal(entity.plural)}`
  const path = context.paths.query(`list-${names.pluralFile}`)
  return {
    path,
    source: context.source(repository.id),
    content: file([
      header(context.source(repository.id)),
      'import type { Page, PageRequest } from \'#core/kernel/page\'',
      ...listAnswer(context, entity, repository).imports,
      `import type { ${names.type} } from '#${context.name}/domain/${names.file}'`,
      ...listAnswer(context, entity, repository).sourceImports,
      `import type { ${names.port} } from '${importPath(path, context.paths.port(names.portFile))}'`,
      '',
      `export interface ${pascal(useCase)}Deps {`,
      `  ${names.plural}: ${names.port}`,
      '}',
      '',
      `/** Read use-case behind the ${names.type} collection sync. */`,
      `export const ${useCase} = ({ ${names.plural} }: ${pascal(useCase)}Deps) =>`,
      `  (page: PageRequest): Promise<${listAnswer(context, entity, repository).type}> => ${names.plural}.list(page)`
    ])
  }
}

/** The list route: it reads its page request and answers one page, as its contract says (T4b). */
export const listRouteFile = (context: ModuleContext, entity: EntityFile, repository: RepositoryFile) => {
  const contract = listContractNames(context, entity)
  return {
    path: context.paths.apiRoute(`${entityNames(entity).pluralFile}/index.get.ts`),
    source: context.source(repository.id),
    content: file([
      header(context.source(repository.id)),
      'import { defineEventHandler, getValidatedQuery } from \'nuxt/server\'',
      contractImport(contract),
      '',
      `export default defineEventHandler(async (event): Promise<${contract.response}> => {`,
      `  const page = await getValidatedQuery(event, ${contract.value}.query)`,
      // From a REST source it answers a Result: the page, or the source's error thrown with its status (R1').
      answersResult(context, repository)
        ? `  return unwrapOrThrow(await ${context.root}().list${pascal(entity.plural)}(page), ${camel(context.name)}ErrorStatus, event)`
        : `  return ${context.root}().list${pascal(entity.plural)}(page)`,
      '})'
    ])
  }
}
