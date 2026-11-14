import type { EntityFile, RepositoryFile } from '../model/schemas.ts'
import { allFields, datasourceOf, entityNames, keyOf } from './context.ts'
import type { Field, ModuleContext } from './context.ts'
import { importLine } from './imports.ts'
import { docText, file, header, pascal, snake, tsLiteral, tsString } from './text.ts'

const OPERATION_ORDER = ['list', 'get', 'create', 'update', 'delete'] as const
const has = (repository: RepositoryFile, op: RepositoryFile['operations'][number]) => repository.operations.includes(op)
const finderFields = (entity: EntityFile, repository: RepositoryFile): Field[] =>
  (repository.finders ?? []).map(finder => allFields(entity).find(field => field.id === finder.by)!).filter(Boolean)
const tsType = (field: Field) => field.type === 'integer' || field.type === 'number' ? 'number' : field.type === 'boolean' ? 'boolean' : 'string'
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
  } else if (field.type === 'number') {
    builders.add('real')
    expression = `real(${name})`
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
    path: `layers/${context.name}/server/infrastructure/db/schema.ts`,
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
  const methods: string[] = []
  for (const op of OPERATION_ORDER) {
    if (!has(repository, op)) {
      if (op === 'get') methods.push(...finderFields(entity, repository).map(field => `  ${findBy(field)}(${field.name}: ${tsType(field)}): Promise<${names.type} | undefined>`))
      continue
    }
    if (op === 'list') methods.push(`  list(page: PageRequest): Promise<Page<${names.type}>>`)
    if (op === 'get') {
      methods.push(`  get(id: ${key.type}): Promise<${names.type} | undefined>`)
      methods.push(...finderFields(entity, repository).map(field => `  ${findBy(field)}(${field.name}: ${tsType(field)}): Promise<${names.type} | undefined>`))
    }
    if (op === 'create') methods.push(`  create(${names.variable}: ${names.type}): Promise<${names.type}>`)
    if (op === 'update') methods.push(`  update(id: ${key.type}, ${names.variable}: ${names.type}): Promise<${names.type}>`)
    if (op === 'delete') methods.push(`  delete(id: ${key.type}): Promise<void>`)
  }
  return {
    path: `layers/${context.name}/server/application/ports/${names.portFile}.ts`,
    source: context.source(repository.id),
    content: file([
      header(context.source(repository.id)),
      has(repository, 'list') && 'import type { Page, PageRequest } from \'#core/kernel/page\'',
      `import type { ${names.type} } from '#${context.name}/domain/${names.file}'`,
      '',
      `/** ${doc} */`,
      `export interface ${names.port} {`,
      ...methods,
      '}'
    ])
  }
}

// ── Drizzle adapter ────────────────────────────────────────────────────

const orderExpression = (entity: EntityFile, repository: RepositoryFile, drizzle: Set<string>) => (repository.list?.orderBy ?? [])
  .map((order) => {
    drizzle.add(order.direction)
    return `${order.direction}(${entity.plural}.${order.field})`
  })

export const drizzleRepositoryFile = (context: ModuleContext, entity: EntityFile, repository: RepositoryFile) => {
  const names = entityNames(entity)
  const drizzle = new Set<string>()
  const table = entity.plural
  const body: string[] = []
  if (has(repository, 'list')) {
    drizzle.add('count')
    const order = orderExpression(entity, repository, drizzle)
    body.push(
      '  async list({ limit, offset }) {',
      '    const [items, [total]] = await Promise.all([',
      `      db.select().from(${table})${order.length ? `.orderBy(${order.join(', ')})` : ''}.limit(limit).offset(offset),`,
      `      db.select({ value: count() }).from(${table})`,
      '    ])',
      '    return { items, total: total?.value ?? 0 }',
      '  }'
    )
  }
  const finders = finderFields(entity, repository)
  const lookups = [...(has(repository, 'get') ? [{ method: 'get', column: 'id', arg: 'id' }] : []), ...finders.map(field => ({ method: findBy(field), column: field.name, arg: field.name }))]
  for (const lookup of lookups) {
    drizzle.add('eq')
    body.push(`  async ${lookup.method}(${lookup.arg}) {`, `    return db.select().from(${table}).where(eq(${table}.${lookup.column}, ${lookup.arg})).get()`, '  }')
  }
  if (has(repository, 'create')) {
    body.push(`  async create(${names.variable}: ${names.type}) {`, `    await db.insert(${table}).values(${names.variable})`, `    return ${names.variable}`, '  }')
  }
  if (has(repository, 'update')) {
    drizzle.add('eq')
    body.push(`  async update(id, ${names.variable}: ${names.type}) {`, `    await db.update(${table}).set(${names.variable}).where(eq(${table}.id, id))`, `    return ${names.variable}`, '  }')
  }
  if (has(repository, 'delete')) {
    drizzle.add('eq')
    body.push('  async delete(id) {', `    await db.delete(${table}).where(eq(${table}.id, id))`, '  }')
  }
  const usesType = has(repository, 'create') || has(repository, 'update')
  return {
    path: `layers/${context.name}/server/infrastructure/repositories/${names.file}.drizzle.ts`,
    source: context.source(repository.id),
    content: file([
      header(context.source(repository.id)),
      drizzle.size > 0 && importLine('drizzle-orm', [...drizzle]),
      'import type { LibSQLDatabase } from \'drizzle-orm/libsql\'',
      usesType && `import type { ${names.type} } from '#${context.name}/domain/${names.file}'`,
      `import type { ${names.port} } from '../../application/ports/${names.portFile}'`,
      `import { ${table} } from '../db/schema'`,
      '',
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
  const body: string[] = []
  if (has(repository, 'list')) body.push('    async list({ limit, offset }) {', '      return { items: sorted().slice(offset, offset + limit), total: rows.size }', '    }')
  if (has(repository, 'get')) body.push('    async get(id) {', '      return rows.get(id)', '    }')
  for (const field of finderFields(entity, repository)) {
    body.push(`    async ${findBy(field)}(${field.name}) {`, `      return [...rows.values()].find(${row} => ${row}.${field.name} === ${field.name})`, '    }')
  }
  if (has(repository, 'create')) body.push(`    async create(${row}) {`, `      rows.set(${row}.id, ${row})`, `      return ${row}`, '    }')
  if (has(repository, 'update')) body.push(`    async update(id, ${row}) {`, `      rows.set(id, ${row})`, `      return ${row}`, '    }')
  if (has(repository, 'delete')) body.push('    async delete(id) {', '      rows.delete(id)', '    }')
  const methods = body.map((line, index) => line === '    }' && index < body.length - 1 ? '    },' : line)
  return {
    path: `layers/${context.name}/server/infrastructure/repositories/${names.file}.memory.ts`,
    source: context.source(repository.id),
    content: file([
      header(context.source(repository.id)),
      `import type { ${names.type} } from '#${context.name}/domain/${names.file}'`,
      `import type { ${names.port} } from '../../application/ports/${names.portFile}'`,
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

/** The REST config of a repository that only lists (the read-only shape, T5). */
const listRestConfig = (repository: RepositoryFile) => {
  const rest = restConfig(repository)
  return { ...rest, list: rest.list! }
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

export const restRepositoryFile = (context: ModuleContext, entity: EntityFile, repository: RepositoryFile) => {
  if (restDoesMoreThanList(repository)) return restCrudRepositoryFile(context, entity, repository)
  const names = entityNames(entity)
  const rest = listRestConfig(repository)
  const source = datasourceOf(context, repository)
  const response = `${pascal(entity.plural)}Response`
  const fields = remoteFields(entity, rest)
  const items = rest.list.itemsPath
  const total = rest.list.totalPath
  return {
    path: `layers/${context.name}/server/infrastructure/repositories/${names.file}.rest.ts`,
    source: context.source(repository.id),
    content: file([
      header(context.source(repository.id)),
      `import { ${names.type}Schema } from '#${context.name}/domain/${names.file}'`,
      `import type { ${names.port} } from '../../application/ports/${names.portFile}'`,
      '',
      '/** The minimal HTTP client this adapter needs (core\'s useRemote provides it). */',
      `export type ${names.type}Http = <T>(path: string, options?: { query?: Record<string, string | number | undefined> }) => Promise<T>`,
      '',
      `interface ${response} {`,
      `  ${property(items)}: Array<{ ${fields.map(({ field, remote }) => `${property(remote)}: ${tsType(field)}`).join(', ')} }>`,
      total && `  ${property(total)}: number`,
      '}',
      '',
      `/** ${names.port} over the "${source.name}" REST data source. Paging style: offset (${docText(String(rest.paging.offsetParam))}/${docText(String(rest.paging.limitParam))}). */`,
      `export const rest${names.port} = (http: ${names.type}Http): ${names.port} => ({`,
      '  async list({ limit, offset }) {',
      `    const response = await http<${response}>(${tsString(rest.list.path)}, { query: ${pagingQuery(rest)} })`,
      '    return {',
      `      items: ${member('response', items)}.map(row => ${names.type}Schema.parse({ ${fields.map(({ field, remote }) => `${field.name}: ${member('row', remote)}`).join(', ')} })),`,
      `      total: ${total ? member('response', total) : `${member('response', items)}.length`}`,
      '    }',
      '  }',
      '})'
    ])
  }
}

const sample = (field: Field) => field.type === 'integer' || field.type === 'number' ? 1 : field.type === 'boolean' ? true : field.name

/** A generated adapter test: fields and paging map to the REST source as modeled. */
export const restRepositoryTestFile = (context: ModuleContext, entity: EntityFile, repository: RepositoryFile) => {
  if (restDoesMoreThanList(repository)) return restCrudRepositoryTestFile(context, entity, repository)
  const names = entityNames(entity)
  const rest = listRestConfig(repository)
  const fields = remoteFields(entity, rest)
  const items = rest.list.itemsPath
  const total = rest.list.totalPath
  const remoteRow = `{ ${fields.map(({ field, remote }) => `${property(remote)}: ${tsLiteral(sample(field))}`).join(', ')} }`
  const modelRow = `{ ${fields.map(({ field }) => `${field.name}: ${tsLiteral(sample(field))}`).join(', ')} }`
  const query = `{ ${property(rest.paging.limitParam!)}: 10, ${property(rest.paging.offsetParam!)}: 20 }`
  return {
    path: `layers/${context.name}/test/infrastructure/${names.file}.rest.test.ts`,
    source: context.source(repository.id),
    content: file([
      header(context.source(repository.id)),
      'import { describe, expect, it } from \'vitest\'',
      `import { type ${names.type}Http, rest${names.port} } from '../../server/infrastructure/repositories/${names.file}.rest'`,
      '',
      `describe('rest${names.port}', () => {`,
      '  it(\'maps fields and offset paging to the REST source\', async () => {',
      '    const calls: unknown[] = []',
      `    const http: ${names.type}Http = async <T>(path: string, options?: unknown) => {`,
      '      calls.push({ path, options })',
      `      return { ${property(items)}: [${remoteRow}]${total ? `, ${property(total)}: 40` : ''} } as T`,
      '    }',
      `    const page = await rest${names.port}(http).list({ limit: 10, offset: 20 })`,
      `    expect(calls).toEqual([{ path: ${tsString(rest.list.path)}, options: { query: ${query} } }])`,
      `    expect(page).toEqual({ items: [${modelRow}], total: ${total ? 40 : 1} })`,
      '  })',
      '})'
    ])
  }
}

// ── REST adapter with lookups and writes (V7: API-only projects) ───────

const HTTP_OPTIONS = '{ method?: \'GET\' | \'POST\' | \'PUT\' | \'PATCH\' | \'DELETE\', query?: Record<string, string | number | undefined>, body?: unknown, optional?: boolean }'

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

/** Options of one call: `method` only when it isn't GET. */
const callOptions = (method: string, extra: string[]) => {
  const entries = [...(method === 'GET' ? [] : [`method: ${tsString(method)}`]), ...extra]
  return entries.length ? `, { ${entries.join(', ')} }` : ''
}

const restCrudRepositoryFile = (context: ModuleContext, entity: EntityFile, repository: RepositoryFile) => {
  const names = entityNames(entity)
  const rest = restConfig(repository)
  const source = datasourceOf(context, repository)
  const fields = remoteFields(entity, rest)
  const row = `${names.type}Row`
  const response = `${pascal(entity.plural)}Response`
  const variable = names.variable
  const readsRows = has(repository, 'list') || has(repository, 'get') || has(repository, 'create') || has(repository, 'update')
  const writesRows = has(repository, 'create') || has(repository, 'update')
  const byId = has(repository, 'get') || has(repository, 'update') || has(repository, 'delete')
  const body: string[] = []
  if (has(repository, 'list')) {
    const list = rest.list!
    body.push(
      '  async list({ limit, offset }) {',
      `    const response = await http<${response}>(${tsString(list.path)}, { query: ${pagingQuery(rest)} })`,
      '    return {',
      `      items: ${member('response', list.itemsPath)}.map(fromRow),`,
      `      total: ${list.totalPath ? member('response', list.totalPath) : `${member('response', list.itemsPath)}.length`}`,
      '    }',
      '  }'
    )
  }
  if (has(repository, 'get')) {
    body.push(
      '  async get(id) {',
      `    const row = await http<${row} | undefined>(${idPath(rest.get!.path)}${callOptions(methodOf(rest, 'get'), ['optional: true'])})`,
      '    return row === undefined ? undefined : fromRow(row)',
      '  }'
    )
  }
  if (has(repository, 'create')) {
    body.push(
      `  async create(${variable}: ${names.type}) {`,
      `    const row = await http<${row} | undefined>(${tsString(rest.create!.path)}${callOptions(methodOf(rest, 'create'), [`body: toRow(${variable})`])})`,
      `    return row === undefined ? ${variable} : fromRow(row)`,
      '  }'
    )
  }
  if (has(repository, 'update')) {
    body.push(
      `  async update(id, ${variable}: ${names.type}) {`,
      `    const row = await http<${row} | undefined>(${idPath(rest.update!.path)}${callOptions(methodOf(rest, 'update'), [`body: toRow(${variable})`])})`,
      `    return row === undefined ? ${variable} : fromRow(row)`,
      '  }'
    )
  }
  if (has(repository, 'delete')) {
    body.push('  async delete(id) {', `    await http<unknown>(${idPath(rest.delete!.path)}${callOptions(methodOf(rest, 'delete'), [])})`, '  }')
  }
  return {
    path: `layers/${context.name}/server/infrastructure/repositories/${names.file}.rest.ts`,
    source: context.source(repository.id),
    content: file([
      header(context.source(repository.id)),
      importLine(`#${context.name}/domain/${names.file}`, [{ name: names.type, type: true }, ...(readsRows ? [`${names.type}Schema`] : [])]),
      `import type { ${names.port} } from '../../application/ports/${names.portFile}'`,
      '',
      '/** The minimal HTTP client this adapter needs (core\'s useRemote provides it). With `optional`, a 404 resolves to undefined. */',
      `export type ${names.type}Http = <T>(path: string, options?: ${HTTP_OPTIONS}) => Promise<T>`,
      '',
      `/** A ${names.type} as the "${docText(source.name)}" source sends and takes it. */`,
      `interface ${row} {`,
      ...fields.map(({ field, remote }) => `  ${property(remote)}: ${tsType(field)}`),
      '}',
      ...(has(repository, 'list')
        ? ['', `interface ${response} {`, `  ${property(rest.list!.itemsPath)}: ${row}[]`, ...(rest.list!.totalPath ? [`  ${property(rest.list!.totalPath)}: number`] : []), '}']
        : []),
      '',
      readsRows && `const fromRow = (row: ${row}): ${names.type} => ${names.type}Schema.parse({ ${fields.map(({ field, remote }) => `${field.name}: ${member('row', remote)}`).join(', ')} })`,
      writesRows && `const toRow = (${variable}: ${names.type}): ${row} => ({ ${fields.map(({ field, remote }) => `${property(remote)}: ${variable}.${field.name}`).join(', ')} })`,
      byId && SEGMENT_HELPER,
      '',
      `/** ${names.port} over the "${docText(source.name)}" REST data source.${has(repository, 'list') ? ` Paging style: offset (${docText(String(rest.paging.offsetParam))}/${docText(String(rest.paging.limitParam))}).` : ''} */`,
      `export const rest${names.port} = (http: ${names.type}Http): ${names.port} => ({`,
      joinMethods(body),
      '})'
    ])
  }
}

const SAMPLE_UUID = '00000000-0000-4000-8000-000000000001'
const crudSample = (field: Field) => field.type === 'uuid'
  ? SAMPLE_UUID
  : field.type === 'datetime' ? '2026-01-01T00:00:00.000Z' : field.type === 'date' ? '2026-01-01' : sample(field)

/** Generated adapter tests: each declared operation calls its endpoint with the remote field names. */
const restCrudRepositoryTestFile = (context: ModuleContext, entity: EntityFile, repository: RepositoryFile) => {
  const names = entityNames(entity)
  const rest = restConfig(repository)
  const fields = remoteFields(entity, rest)
  const key = fields.find(({ field }) => field.name === keyOf(entity).name)
  const id = key ? crudSample(key.field) : SAMPLE_UUID
  const at = (path: string) => tsString(path.replace(':id', encodeURIComponent(String(id))))
  const options = (op: RestEndpointOp, extra: string[]) => {
    const method = methodOf(rest, op)
    const entries = [...(method === 'GET' ? [] : [`method: ${tsString(method)}`]), ...extra]
    return `{ ${entries.join(', ')} }`
  }
  const factory = `rest${names.port}`
  const tests: string[][] = []
  if (has(repository, 'list')) {
    const list = rest.list!
    const query = `{ ${property(rest.paging.limitParam)}: 10, ${property(rest.paging.offsetParam)}: 20 }`
    tests.push([
      '  it(\'maps fields and offset paging to the REST source\', async () => {',
      `    const { calls, repository } = fake({ ${property(list.itemsPath)}: [row]${list.totalPath ? `, ${property(list.totalPath)}: 40` : ''} })`,
      '    const page = await repository.list({ limit: 10, offset: 20 })',
      `    expect(calls).toEqual([{ path: ${tsString(list.path)}, options: { query: ${query} } }])`,
      `    expect(page).toEqual({ items: [${names.variable}], total: ${list.totalPath ? 40 : 1} })`,
      '  })'
    ])
  }
  if (has(repository, 'get')) {
    tests.push([
      '  it(\'gets one by id, and undefined when the source has none\', async () => {',
      '    const found = fake(row)',
      `    expect(await found.repository.get(${tsLiteral(id)})).toEqual(${names.variable})`,
      `    expect(found.calls).toEqual([{ path: ${at(rest.get!.path)}, options: ${options('get', ['optional: true'])} }])`,
      `    expect(await fake(undefined).repository.get(${tsLiteral(id)})).toBeUndefined()`,
      '  })'
    ])
  }
  for (const op of ['create', 'update'] as const) {
    if (!has(repository, op)) continue
    tests.push([
      `  it('${op === 'create' ? 'creates' : 'updates'} with the remote field names', async () => {`,
      '    const { calls, repository } = fake(row)',
      `    expect(await repository.${op}(${op === 'update' ? `${tsLiteral(id)}, ` : ''}${names.variable})).toEqual(${names.variable})`,
      `    expect(calls).toEqual([{ path: ${op === 'create' ? tsString(rest.create!.path) : at(rest.update!.path)}, options: ${options(op, ['body: row'])} }])`,
      '  })'
    ])
  }
  if (has(repository, 'delete')) {
    tests.push([
      '  it(\'deletes by id\', async () => {',
      '    const { calls, repository } = fake(undefined)',
      `    await repository.delete(${tsLiteral(id)})`,
      `    expect(calls).toEqual([{ path: ${at(rest.delete!.path)}, options: ${options('delete', [])} }])`,
      '  })'
    ])
  }
  const lookup = (['get', 'update', 'delete'] as const).find(op => has(repository, op))
  // Only text keys can be "." or ".." (a numeric key can't, and passing one wouldn't typecheck).
  if (lookup && typeof id === 'string') {
    tests.push([
      '  it(\'refuses ids that would change the path\', async () => {',
      '    const { calls, repository } = fake(row)',
      ...['..', '.', ''].map(bad => `    await expect(repository.${lookup}(${tsLiteral(bad)}${lookup === 'update' ? `, ${names.variable}` : ''})).rejects.toThrow('Not a valid id for a REST path')`),
      '    expect(calls).toEqual([])',
      '  })'
    ])
  }
  return {
    path: `layers/${context.name}/test/infrastructure/${names.file}.rest.test.ts`,
    source: context.source(repository.id),
    content: file([
      header(context.source(repository.id)),
      'import { describe, expect, it } from \'vitest\'',
      `import { type ${names.type}Http, ${factory} } from '../../server/infrastructure/repositories/${names.file}.rest'`,
      '',
      `const row = { ${fields.map(({ field, remote }) => `${property(remote)}: ${tsLiteral(crudSample(field))}`).join(', ')} }`,
      `const ${names.variable} = { ${fields.map(({ field }) => `${field.name}: ${tsLiteral(crudSample(field))}`).join(', ')} }`,
      '',
      '/** A fake REST source that answers every call with `answer` and records the calls. */',
      'const fake = (answer: unknown) => {',
      '  const calls: unknown[] = []',
      `  const http: ${names.type}Http = async <T>(path: string, options?: unknown) => {`,
      '    calls.push({ path, options })',
      '    return answer as T',
      '  }',
      `  return { calls, repository: ${factory}(http) }`,
      '}',
      '',
      `describe('${factory}', () => {`,
      tests.map(test => test.join('\n')).join('\n\n'),
      '})'
    ])
  }
}

// ── List use-case and route ────────────────────────────────────────────

export const listUseCaseFile = (context: ModuleContext, entity: EntityFile, repository: RepositoryFile) => {
  const names = entityNames(entity)
  const useCase = `list${pascal(entity.plural)}`
  return {
    path: `layers/${context.name}/server/application/queries/list-${snake(entity.plural).replace(/_/g, '-')}.ts`,
    source: context.source(repository.id),
    content: file([
      header(context.source(repository.id)),
      'import type { Page, PageRequest } from \'#core/kernel/page\'',
      `import type { ${names.type} } from '#${context.name}/domain/${names.file}'`,
      `import type { ${names.port} } from '../ports/${names.portFile}'`,
      '',
      `export interface ${pascal(useCase)}Deps {`,
      `  ${names.plural}: ${names.port}`,
      '}',
      '',
      `/** Read use-case behind the ${names.type} collection sync. */`,
      `export const ${useCase} = ({ ${names.plural} }: ${pascal(useCase)}Deps) =>`,
      `  (page: PageRequest): Promise<Page<${names.type}>> => ${names.plural}.list(page)`
    ])
  }
}

export const listRouteFile = (context: ModuleContext, entity: EntityFile, repository: RepositoryFile) => ({
  path: `layers/${context.name}/server/api/${context.name}/${snake(entity.plural).replace(/_/g, '-')}/index.get.ts`,
  source: context.source(repository.id),
  content: file([
    header(context.source(repository.id)),
    'import { defineEventHandler, getValidatedQuery } from \'nuxt/server\'',
    'import { PageRequestSchema } from \'#core/kernel/page\'',
    '',
    'export default defineEventHandler(async (event) => {',
    '  const page = await getValidatedQuery(event, PageRequestSchema)',
    `  return ${context.root}().list${pascal(entity.plural)}(page)`,
    '})'
  ])
})
