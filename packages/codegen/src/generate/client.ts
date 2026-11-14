import type { EntityFile, QueryFile, RepositoryFile, StateFile, Value } from '../model/schemas.ts'
import { datasourceOf, entityById, entityNames, isWritable, keyOf } from './context.ts'
import type { ModuleContext } from './context.ts'
import { zodField } from './entity.ts'
import type { KernelName } from './entity.ts'
import { importLine } from './imports.ts'
import { camel, docText, file, header, kebab, pascal, tsDuration, tsLiteral, tsString } from './text.ts'

/**
 * The client side of the data layer (decision D7): one TanStack DB collection
 * per listed entity, one live-query composable per Query, one local
 * collection plus composable per State.
 */

// ── Entity collections ─────────────────────────────────────────────────

export const collectionFile = (context: ModuleContext, entity: EntityFile, repository: RepositoryFile) => {
  const names = entityNames(entity)
  const source = datasourceOf(context, repository)
  const route = `/api/${context.name}/${kebab(entity.plural)}`
  const doc = source.kind !== 'rest'
    ? `Client copy of every ${names.type}, synced from the ${names.type} repository's list route (sync mode: ${entity.client.sync}).`
    : `Client copy of the first page of ${pascal(entity.plural)} from the "${source.name}" REST data source${isWritable(repository) ? '' : ' (read-only)'}.`
  const key = keyOf(entity)
  return {
    path: `layers/${context.name}/app/data/${kebab(entity.plural)}.collection.ts`,
    source: context.source(entity.id),
    content: file([
      header(context.source(entity.id)),
      'import { queryCollectionOptions } from \'@tanstack/query-db-collection\'',
      'import { createCollection } from \'@tanstack/vue-db\'',
      'import type { Page } from \'#core/kernel/page\'',
      'import { queryClient } from \'#layers/core/app/data/query-client\'',
      importLine(`#${context.name}/domain/${names.file}`, [{ name: names.type, type: true }, `${names.type}Schema`]),
      '',
      `/** ${docText(doc)} */`,
      `export const ${names.collection} = createCollection(`,
      '  queryCollectionOptions({',
      `    id: ${tsString(`${context.name}:${entity.plural}`)},`,
      `    queryKey: [${tsString(context.name)}, ${tsString(entity.plural)}],`,
      `    queryFn: ({ signal }) => $fetch<Page<${names.type}>>(${tsString(route)}, { query: { limit: ${entity.client.limit ?? 500} }, signal }),`,
      `    select: (page: Page<${names.type}>) => page.items,`,
      '    queryClient,',
      `    schema: ${names.type}Schema,`,
      `    getKey: ${names.variable} => ${names.variable}.${key.name}${entity.client.staleTime !== undefined ? ',' : ''}`,
      entity.client.staleTime !== undefined && `    staleTime: ${tsDuration(entity.client.staleTime)}`,
      '  })',
      ')'
    ])
  }
}

// ── Query composables ──────────────────────────────────────────────────

const CONDITION_FUNCTIONS: Record<NonNullable<QueryFile['where']>['op'], string> = {
  eq: 'eq', ne: 'eq', lt: 'lt', lte: 'lte', gt: 'gt', gte: 'gte', in: 'inArray', like: 'like'
}

const paramType = (type: string) => type === 'integer' || type === 'number' ? 'number' : type === 'boolean' ? 'boolean' : 'string'

export const queryFile = (context: ModuleContext, query: QueryFile) => {
  const entity = entityById(context, query.from)
  const names = entityNames(entity)
  const alias = names.variable
  const composable = `use${pascal(query.name)}`
  const tanstack = new Set<string>(['useLiveQuery'])
  const vue = new Set<string>()
  const reactive = query.params.filter(param => param.reactive)
  if (reactive.length) {
    vue.add('MaybeRefOrGetter')
    vue.add('toValue')
  }

  const valueOf = (value: Value | undefined): string => {
    if (value && typeof value === 'object' && !Array.isArray(value) && '$param' in value) {
      const name = String(value.$param)
      const param = query.params.find(entry => entry.name === name)
      if (!param) throw new Error(`${query.id}: unknown parameter "${name}"`)
      return param.reactive ? `toValue(${name})` : name
    }
    return tsLiteral(value ?? null)
  }

  const chain = [`.from({ ${alias}: ${names.collection} })`]
  if (query.where) {
    const fn = CONDITION_FUNCTIONS[query.where.op]
    tanstack.add(fn)
    const condition = `${fn}(${alias}.${query.where.field}, ${valueOf(query.where.value)})`
    if (query.where.op === 'ne') tanstack.add('not')
    chain.push(`.where(({ ${alias} }) => ${query.where.op === 'ne' ? `not(${condition})` : condition})`)
  }
  for (const order of query.orderBy ?? []) chain.push(`.orderBy(({ ${alias} }) => ${alias}.${order.field}, ${tsString(order.direction)})`)
  if (query.limit !== undefined) chain.push(`.limit(${valueOf(query.limit)})`)
  if (query.result === 'one') {
    chain.push('.findOne()')
    vue.add('computed')
  }

  const signature = query.params.map((param) => {
    if (param.reactive) return `${param.name}: MaybeRefOrGetter<${paramType(param.type)}>`
    return param.default !== undefined ? `${param.name} = ${tsLiteral(param.default)}` : `${param.name}: ${paramType(param.type)}`
  }).join(', ')
  const deps = reactive.length ? `[${reactive.map(param => `() => toValue(${param.name})`).join(', ')}]` : undefined
  const liveQuery = (indent: string) => [
    `useLiveQuery(q => q`,
    ...chain.map((step, index) => `${indent}  ${step}${deps && index === chain.length - 1 ? ',' : ''}`),
    deps ? `${indent}${deps}` : undefined,
    `${indent})`
  ].filter((line): line is string => line !== undefined)

  const doc = `Query "${query.label}"${query.description ? `: ${query.description}` : '.'}`
  const body = query.result === 'one'
    ? [
        `export const ${composable} = (${signature}) => {`,
        `  const result = ${liveQuery('  ').join('\n')}`,
        `  return { ...result, ${alias}: computed(() => result.data.value) }`,
        '}'
      ]
    : [`export const ${composable} = (${signature}) =>`, `  ${liveQuery('  ').join('\n')}`]

  return {
    path: `layers/${context.name}/app/composables/${context.name}/${composable}.ts`,
    source: context.source(query.id),
    content: file([
      header(context.source(query.id)),
      importLine('@tanstack/vue-db', [...tanstack]),
      vue.size > 0 && importLine('vue', [...vue].map(name => name === 'MaybeRefOrGetter' ? { name, type: true } : name)),
      `import { ${names.collection} } from '../../data/${kebab(entity.plural)}.collection'`,
      '',
      `/** ${docText(doc)} */`,
      ...body
    ])
  }
}

// ── State ──────────────────────────────────────────────────────────────

const PERSISTENCE = {
  localStorage: 'persisted in localStorage and synced across tabs',
  session: 'persisted in sessionStorage for this tab',
  memory: 'kept in memory until the page reloads'
} as const

const stateNames = (context: ModuleContext, state: StateFile) => ({
  type: `${pascal(context.name)}${pascal(state.name)}`,
  collection: `${camel(context.name)}${pascal(state.name)}Collection`,
  composable: `use${pascal(context.name)}${pascal(state.name)}`,
  file: kebab(state.name),
  key: `${context.name}:${state.name}`
})

const singleOnly = (state: StateFile) => {
  if (state.shape !== 'single') throw new Error(`${state.id}: state with shape "${state.shape}" is not generated yet (supported: single)`)
}

export const stateCollectionFile = (context: ModuleContext, state: StateFile) => {
  singleOnly(state)
  const names = stateNames(context, state)
  const kernel = new Set<KernelName>()
  const fields = state.fields.map(field => `  ${field.name}: ${zodField(field, kernel)}`)
  const options = state.persist === 'memory' ? 'localOnlyCollectionOptions' : 'localStorageCollectionOptions'
  return {
    path: `layers/${context.name}/app/data/${names.file}.collection.ts`,
    source: context.source(state.id),
    content: file([
      header(context.source(state.id)),
      importLine('@tanstack/vue-db', ['createCollection', options]),
      'import { z } from \'zod\'',
      kernel.size > 0 && importLine('#core/kernel/ids', [...kernel]),
      '',
      `/** UI state of the ${context.name} module, ${PERSISTENCE[state.persist]}. */`,
      `export const ${names.type}Schema = z.object({`,
      [`  id: z.literal(${tsString(context.name)})`, ...fields].join(',\n'),
      '})',
      `export type ${names.type} = z.infer<typeof ${names.type}Schema>`,
      '',
      `export const ${names.collection} = createCollection(`,
      `  ${options}({`,
      `    id: ${tsString(names.key)},`,
      state.persist !== 'memory' && `    storageKey: ${tsString(names.key)},`,
      state.persist === 'session' && '    storage: sessionStorage,',
      `    schema: ${names.type}Schema,`,
      '    getKey: row => row.id',
      '  })',
      ')'
    ])
  }
}

export const stateComposableFile = (context: ModuleContext, state: StateFile) => {
  singleOnly(state)
  const names = stateNames(context, state)
  const variable = camel(state.name)
  const key = tsString(context.name)
  return {
    path: `layers/${context.name}/app/composables/${context.name}/${names.composable}.ts`,
    source: context.source(state.id),
    content: file([
      header(context.source(state.id)),
      'import { useLiveQuery } from \'@tanstack/vue-db\'',
      'import { computed } from \'vue\'',
      importLine(`../../data/${names.file}.collection`, [{ name: names.type, type: true }, `${names.type}Schema`, names.collection]),
      '',
      `/** ${docText(`State "${state.label}": one ${state.persist === 'memory' ? 'in-memory' : 'persisted'} row with defaults, plus a typed setter.`)} */`,
      `export const ${names.composable} = () => {`,
      `  const { data } = useLiveQuery(q => q.from({ row: ${names.collection} }).findOne())`,
      `  const ${variable} = computed<${names.type}>(() => data.value ?? ${names.type}Schema.parse({ id: ${key} }))`,
      `  const set = (patch: Partial<Omit<${names.type}, 'id'>>) => {`,
      `    if (${names.collection}.has(${key})) ${names.collection}.update(${key}, draft => Object.assign(draft, patch))`,
      `    else ${names.collection}.insert({ ...${variable}.value, ...patch })`,
      '  }',
      `  return { ${variable}, set }`,
      '}'
    ])
  }
}
