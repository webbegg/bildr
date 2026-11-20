import type { Model } from '../model/load.ts'
import type { ActionFile, EntityFile, RepositoryFile, Value } from '../model/schemas.ts'
import type { GeneratedFile } from '../sync/plan.ts'
import { allFields, datasourceOf, entityById, entityNames, moduleContext, repositoryOf } from './context.ts'
import type { Field, ModuleContext } from './context.ts'
import { importLine } from './imports.ts'
import type { ImportName } from './imports.ts'
import { camel, docText, file, header, identifier, kebab, pascal, propertyPath, tsLiteral, tsString } from './text.ts'

/**
 * Business logic (T6): each Action becomes a use-case (server/application),
 * a thin POST route, an optimistic client composable and generated tests;
 * each module gets its domain error union and its composition root.
 */
export const generateActions = (model: Model): GeneratedFile[] => {
  const files: Array<Omit<GeneratedFile, 'owner'>> = []
  for (const name of Object.keys(model.modules).sort()) {
    const context = moduleContext(model, name)
    const actions = context.module.actions.map(action => analyze(context, action))
    files.push(errorsFile(context), compositionRootFile(context, actions))
    for (const action of actions) files.push(useCaseFile(context, action), routeFile(context, action), composableFile(context, action), useCaseTestFile(context, action))
  }
  return files
    .map(entry => ({ ...entry, owner: 'managed' as const }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

// ── Analysis: what each action reads and writes ────────────────────────

interface Step { kind: string, [key: string]: unknown }
interface RepositoryCall { repository: string, op: string, args?: Record<string, Value> }

interface Analyzed {
  action: ActionFile
  /** Entity whose New<Entity>Schema is the input, if any. */
  inputEntity?: EntityFile
  params: NonNullable<ActionFile['input']['params']>
  output?: EntityFile
  /** Repositories the steps use, in first-use order. */
  repositories: Array<{ repository: RepositoryFile, entity: EntityFile }>
  steps: Step[]
}

const SUPPORTED_STEPS = new Set(['validate', 'assert', 'load', 'return', 'repository'])

const analyze = (context: ModuleContext, action: ActionFile): Analyzed => {
  const steps = action.steps as Step[]
  steps.forEach((step, index) => {
    if (!SUPPORTED_STEPS.has(step.kind)) throw new Error(`${action.id}: step ${index + 1} ("${step.kind}") is not generated yet`)
  })
  steps.forEach((step, index) => {
    if (step.kind === 'repository' && index !== steps.length - 1) throw new Error(`${action.id}: a repository step must be the last step`)
  })
  const repositories: Analyzed['repositories'] = []
  const use = (id: string) => {
    if (repositories.some(entry => entry.repository.id === id)) return
    const repository = context.module.repositories.find(entry => entry.id === id)
    if (!repository) throw new Error(`${action.id}: unknown repository "${id}"`)
    repositories.push({ repository, entity: entityById(context, repository.entity) })
  }
  for (const step of steps) {
    const call = (step.kind === 'assert' ? step.unless : step) as Partial<RepositoryCall> | undefined
    if (call?.repository) use(call.repository)
  }
  return {
    action,
    ...(action.input.entity ? { inputEntity: entityById(context, action.input.entity) } : {}),
    params: action.input.params ?? [],
    ...(action.output ? { output: entityById(context, action.output.entity) } : {}),
    repositories,
    steps
  }
}

const tsType = (type: string) => type === 'integer' || type === 'number' ? 'number' : type === 'boolean' ? 'boolean' : 'string'
const errorFactory = (type: string) => camel(type)
const errorTypeName = (context: ModuleContext) => `${pascal(context.name)}Error`
const repositoryVariable = (entity: EntityFile) => entity.plural

/** How many times a value tree mentions `$now`. */
const nowCount = (value: unknown): number => {
  if (!value || typeof value !== 'object') return 0
  if (Array.isArray(value)) return value.reduce((sum: number, item) => sum + nowCount(item), 0)
  return Object.entries(value).reduce((sum, [key, item]) => sum + (key === '$now' ? 1 : nowCount(item)), 0)
}

/** Compiles a model value expression to TS. `input` names what `$input.x` reads from; `$now` reads `at` when declared. */
const compile = (value: Value | undefined, scope: { input: (name: string) => string, at: boolean }): string => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if ('$input' in value) return scope.input(propertyPath(String(value.$input), '$input'))
    if ('$var' in value) return propertyPath(String(value.$var), '$var')
    if ('$now' in value) return scope.at ? 'at' : 'now()'
    if ('if' in value && 'then' in value) return `${compile(value.if, scope)} ? ${compile(value.then, scope)} : ${compile(value.else ?? null, scope)}`
  }
  return tsLiteral(value ?? null)
}

const setEntries = (set: Record<string, Value> | undefined, scope: Parameters<typeof compile>[1]) =>
  Object.entries(set ?? {}).map(([key, value]) => `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : tsString(key)}: ${compile(value, scope)}`)

const errorsOf = (context: ModuleContext) => {
  const seen = new Map<string, ActionFile['errors'][number]>()
  for (const action of context.module.actions) for (const error of action.errors) if (!seen.has(error.type)) seen.set(error.type, error)
  return [...seen.values()]
}

// ── Domain errors ──────────────────────────────────────────────────────

/** A message with `{field}` placeholders for the error's data becomes a template literal. */
const messageExpression = (message: string, data: string[]) => {
  const parts = message.split(/\{(\w+)\}/)
  const hasPlaceholder = parts.some((part, index) => index % 2 === 1 && data.includes(part))
  if (!hasPlaceholder) return tsString(message)
  return `\`${parts.map((part, index) => index % 2 === 1
    ? (data.includes(part) ? `\${${part}}` : `{${part}}`)
    : part.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')).join('')}\``
}

const errorsFile = (context: ModuleContext) => {
  const errors = errorsOf(context)
  const type = errorTypeName(context)
  const union = errors.map(error => `  | { type: ${tsString(error.type)}, message: string${Object.entries(error.data ?? {}).map(([key, kind]) => `, ${key}: ${tsType(kind)}`).join('')} }`)
  const factories = errors.map((error) => {
    const data = Object.entries(error.data ?? {})
    const params = data.map(([key, kind]) => `${key}: ${tsType(kind)}`).join(', ')
    const fields = data.map(([key]) => key)
    return `export const ${errorFactory(error.type)} = (${params}): ${type} => ({ type: ${tsString(error.type)}, message: ${messageExpression(error.message, fields)}${fields.map(key => `, ${key}`).join('')} })`
  })
  return {
    path: `layers/${context.name}/shared/domain/errors.ts`,
    content: file([
      `// Generated by bildr from the ${context.name} module's actions. Editing this file detaches it from the editor.`,
      '',
      `/** Every expected failure of the ${context.name} module's use-cases. */`,
      errors.length ? `export type ${type} =` : `export type ${type} = never`,
      ...union,
      ...factories.flatMap(factory => ['', factory])
    ])
  }
}

// ── Use-case ───────────────────────────────────────────────────────────

const useCaseFile = (context: ModuleContext, analyzed: Analyzed) => {
  const { action, inputEntity, params, output } = analyzed
  const source = context.source(action.id)
  const deps = `${pascal(action.name)}Deps`
  const kernelIds = new Set<string>()
  const domain = new Map<string, ImportName[]>()
  const addDomain = (entity: EntityFile, name: ImportName) => {
    const key = entityNames(entity).file
    domain.set(key, [...(domain.get(key) ?? []), name])
  }
  const errorImports: ImportName[] = [{ name: errorTypeName(context), type: true }]
  let usesErr = false
  let validated = false
  // What the body reads of its input: an input it never reads is named `_input`, which the project's lint allows.
  let readsInput = false
  const readParams = new Set<string>()
  const scope = {
    input: (name: string) => {
      if (validated) return `data.${name}`
      if (params.some(param => param.name === name)) {
        readParams.add(name)
        return name
      }
      readsInput = true
      return `input.${name}`
    },
    at: false
  }

  const body: string[] = []
  const errorCall = (type: string, data: Record<string, Value> | undefined) => {
    const error = action.errors.find(entry => entry.type === type)
    if (!error) throw new Error(`${action.id}: the error "${type}" is not declared in the action's errors`)
    identifier(errorFactory(type), `${action.id}: error`)
    usesErr = true
    if (!errorImports.some(entry => entry.name === errorFactory(type))) errorImports.push({ name: errorFactory(type) })
    const values = Object.keys(error?.data ?? {}).map(key => compile(data?.[key] ?? null, scope))
    return `err(${errorFactory(type)}(${values.join(', ')}))`
  }
  const call = (step: RepositoryCall) => {
    const repository = analyzed.repositories.find(entry => entry.repository.id === step.repository)!
    return `${repositoryVariable(repository.entity)}.${identifier(String(step.op), `${action.id}: repository op`)}(${Object.values(step.args ?? {}).map(arg => compile(arg, scope)).join(', ')})`
  }

  for (const step of analyzed.steps) {
    if (step.kind === 'validate') {
      if (!inputEntity) throw new Error(`${action.id}: validate needs an entity input`)
      body.push(`const data = New${inputEntity.name}Schema.parse(input)`)
      addDomain(inputEntity, { name: `New${inputEntity.name}Schema` })
      validated = true
      readsInput = true
    } else if (step.kind === 'assert') {
      body.push(`if (await ${call(step.unless as RepositoryCall)}) return ${errorCall(String(step.error), step.errorData as Record<string, Value>)}`)
    } else if (step.kind === 'load') {
      const as = identifier(String(step.as), `${action.id}: load as`)
      body.push(`const ${as} = await ${call(step as unknown as RepositoryCall)}`)
      if (step.orError) body.push(`if (!${as}) return ${errorCall(String(step.orError), step.errorData as Record<string, Value>)}`)
    } else if (step.kind === 'return') {
      const when = compile(step.if as Value, scope)
      // A return that always runs is a plain return: `if (true)` fails the project's lint.
      body.push(when === 'true' ? `return ok(${compile(step.value as Value, scope)})` : `if (${when}) return ok(${compile(step.value as Value, scope)})`)
    } else if (step.kind === 'repository') {
      const repository = analyzed.repositories.find(entry => entry.repository.id === step.repository)!
      const timestamps = repository.entity.timestamps ? (step.op === 'create' ? ['createdAt', 'updatedAt'] : ['updatedAt']) : []
      scope.at = nowCount(step.set) + timestamps.length >= 2
      if (scope.at || nowCount(step.set)) kernelIds.add('now')
      if (scope.at) body.push('const at = now()')
      const stamped = timestamps.map(name => `${name}: ${scope.at ? 'at' : 'now()'}`)
      const variable = repositoryVariable(repository.entity)
      if (step.op === 'create') {
        body.push(`return ok(await ${variable}.create({ ${['...data', ...setEntries(step.set as Record<string, Value>, scope), ...stamped].join(', ')} }))`)
      } else if (step.op === 'update') {
        body.push(`return ok(await ${variable}.update(${compile(step.id as Value, scope)}, { ${[`...${compile(step.from as Value, scope)}`, ...setEntries(step.set as Record<string, Value>, scope), ...stamped].join(', ')} }))`)
      } else if (step.op === 'delete') {
        body.push(`await ${variable}.delete(${compile(step.id as Value, scope)})`, 'return ok(undefined)')
      } else {
        throw new Error(`${action.id}: repository operation "${String(step.op)}" is not generated yet`)
      }
    }
  }

  if (inputEntity) addDomain(inputEntity, { name: `New${inputEntity.name}`, type: true })
  if (output) addDomain(output, { name: output.name, type: true })
  const signature = inputEntity
    ? `${readsInput ? 'input' : '_input'}: New${inputEntity.name}`
    : params.map(param => `${readParams.has(param.name) ? param.name : `_${param.name}`}: ${tsType(param.type)}`).join(', ')
  // A use-case that reads no repository has no dependencies to take.
  const wired = analyzed.repositories.length > 0
  const result = `Promise<Result<${output?.name ?? 'void'}, ${errorTypeName(context)}>>`

  return {
    path: `layers/${context.name}/server/application/actions/${kebab(action.name)}.ts`,
    source,
    content: file([
      header(source),
      kernelIds.size > 0 && importLine('#core/kernel/ids', [...kernelIds]),
      importLine('#core/kernel/result', [{ name: 'Result', type: true }, ...(usesErr ? ['err'] : []), 'ok']),
      importLine(`#${context.name}/domain/errors`, errorImports),
      ...[...domain.entries()].map(([path, names]) => importLine(`#${context.name}/domain/${path}`, names)),
      ...analyzed.repositories.map(({ entity }) => `import type { ${entityNames(entity).port} } from '../ports/${entityNames(entity).portFile}'`),
      '',
      ...(wired
        ? [
            `export interface ${deps} {`,
            ...analyzed.repositories.map(({ entity }) => `  ${repositoryVariable(entity)}: ${entityNames(entity).port}`),
            '}',
            ''
          ]
        : []),
      `/** ${docText(action.description ?? `Action "${action.label}".`)} */`,
      `export const ${action.name} = (${wired ? `{ ${analyzed.repositories.map(({ entity }) => repositoryVariable(entity)).join(', ')} }: ${deps}` : ''}) =>`,
      `  async (${signature}): ${result} => {`,
      ...body.map(line => `    ${line}`),
      '  }'
    ])
  }
}

// ── Route ──────────────────────────────────────────────────────────────

/** `/posts` → `posts/index.post.ts`; `/posts/:id/publish` → `posts/[id]/publish.post.ts`; `/posts/:id` → `posts/[id].patch.ts`. */
const routePath = (context: ModuleContext, action: ActionFile) => {
  const segments = action.http.path.split('/').filter(Boolean).map(segment => segment.startsWith(':') ? `[${segment.slice(1)}]` : segment)
  const method = action.http.method.toLowerCase()
  const base = `layers/${context.name}/server/api/${context.name}`
  if (segments.length <= 1) return `${base}/${segments[0] ?? ''}${segments.length ? '/' : ''}index.${method}.ts`
  return `${base}/${segments.slice(0, -1).join('/')}/${segments.at(-1)}.${method}.ts`
}

const routeFile = (context: ModuleContext, analyzed: Analyzed) => {
  const { action, inputEntity, params } = analyzed
  const source = context.source(action.id)
  for (const param of params) if (param.type !== 'uuid' || param.from !== 'route') throw new Error(`${action.id}: only route uuid parameters are generated yet ("${param.name}")`)
  const invoke = `${context.root}().${action.name}(${inputEntity ? 'input' : params.map(param => param.name).join(', ')})`
  return {
    path: routePath(context, action),
    source,
    content: file([
      header(source),
      inputEntity
        ? 'import { defineEventHandler, readValidatedBody } from \'nuxt/server\''
        : `import { defineEventHandler${params.length ? ', getRouterParam' : ''} } from 'nuxt/server'`,
      params.length > 0 && 'import { IdSchema } from \'#core/kernel/ids\'',
      inputEntity && `import { New${inputEntity.name}Schema } from '#${context.name}/domain/${entityNames(inputEntity).file}'`,
      '',
      // A route that reads neither a body nor a parameter has no use for the event.
      `export default defineEventHandler(async (${inputEntity || params.length ? 'event' : ''}) => {`,
      inputEntity && `  const input = await readValidatedBody(event, New${inputEntity.name}Schema)`,
      ...params.map(param => `  const ${param.name} = IdSchema.parse(getRouterParam(event, ${tsString(param.name)}))`),
      `  return unwrapOrThrow(await ${invoke}, ${camel(context.name)}ErrorStatus)`,
      '})'
    ])
  }
}

// ── Composition root ───────────────────────────────────────────────────

const compositionRootFile = (context: ModuleContext, actions: Analyzed[]) => {
  const entries: string[] = []
  const imports: Array<{ path: string, name: string }> = []
  const wiring: string[] = []
  // Memory stores live as long as the server process, so they sit outside the per-call root.
  const stores: string[] = []
  const seeds: string[] = []
  const placed = new Set<string>()
  const sources = { database: false, rest: [] as string[], memory: [] as string[] }
  const listed = (repository: RepositoryFile) => Boolean(repository.expose?.list && repository.operations.includes('list'))
  // Only repositories a use-case consumes are wired: an unused adapter binding fails the project's lint.
  const consumed = new Set(actions.flatMap(analyzed => analyzed.repositories.map(({ entity }) => entity.id)))

  for (const entity of context.module.entities) {
    const repository = repositoryOf(context, entity)
    if (!repository || !(listed(repository) || consumed.has(entity.id))) continue
    const names = entityNames(entity)
    const datasource = datasourceOf(context, repository)
    const adapter = datasource.kind === 'sqlite' ? `drizzle${names.port}` : `${datasource.kind}${names.port}`
    const adapterFile = datasource.kind === 'sqlite' ? 'drizzle' : datasource.kind
    imports.push({ path: `../infrastructure/repositories/${names.file}.${adapterFile}`, name: adapter })
    if (datasource.kind === 'memory') {
      const seeded = context.module.fixtures.some(fixtures => fixtures.entity === entity.id)
      if (seeded) seeds.push(`${names.variable}Seed`)
      stores.push(`const ${names.plural} = ${adapter}(${seeded ? `${names.variable}Seed` : ''})`)
    } else {
      wiring.push(`  const ${names.plural} = ${adapter}(${datasource.kind === 'sqlite' ? 'useDb()' : `useRemote(${tsString(datasource.name)})`})`)
    }
    if (datasource.kind === 'sqlite') sources.database = true
    else if (!sources[datasource.kind].includes(datasource.name)) sources[datasource.kind].push(datasource.name)
    if (listed(repository)) {
      const useCase = `list${pascal(entity.plural)}`
      imports.push({ path: `../application/queries/list-${kebab(entity.plural)}`, name: useCase })
      entries.push(`    ${useCase}: ${useCase}({ ${names.plural} })`)
    }
    for (const analyzed of actions) {
      if (placed.has(analyzed.action.id) || analyzed.repositories[0]?.entity.id !== entity.id) continue
      placed.add(analyzed.action.id)
      entries.push(`    ${analyzed.action.name}: ${analyzed.action.name}({ ${analyzed.repositories.map(({ entity: used }) => used.plural).join(', ')} })`)
    }
  }
  for (const analyzed of actions) {
    if (placed.has(analyzed.action.id)) continue
    entries.push(`    ${analyzed.action.name}: ${analyzed.action.name}()`)
  }
  for (const analyzed of actions) imports.push({ path: `../application/actions/${kebab(analyzed.action.name)}`, name: analyzed.action.name })
  if (seeds.length) imports.push({ path: `../infrastructure/memory/seed`, name: seeds.join(', ') })

  const named = (names: string[], kind: string) => `the ${names.map(name => `"${name}"`).join(' and ')} ${kind}data source${names.length > 1 ? 's' : ''}`
  const wired = [
    ...(sources.database ? ['the app database'] : []),
    ...(sources.rest.length ? [named(sources.rest, '')] : []),
    ...(sources.memory.length ? [named(sources.memory, 'memory ')] : [])
  ]
  const statuses = errorsOf(context).map(error => `  ${error.type}: ${error.status}`)
  const source = `.bildr/modules/${context.name}`
  return {
    path: `layers/${context.name}/server/utils/${context.name}.ts`,
    source,
    content: file([
      header(source),
      `// Composition root of the ${context.name} module: the only place where use-cases meet their adapters.`,
      'import type { ErrorStatusMap } from \'#core/kernel/result\'',
      ...imports.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(entry => `import { ${entry.name} } from '${entry.path}'`),
      '',
      ...(stores.length ? ['// Memory data sources: one store per server process, seeded from the model fixtures, never persisted.', ...stores, ''] : []),
      `/** The ${context.name} module's use-cases${wired.length ? `, wired to ${wired.join(' and ')}` : ''}. */`,
      `export const ${context.root} = () => {`,
      ...wiring,
      ...(entries.length ? ['  return {', entries.join(',\n'), '  }'] : ['  return {}']),
      '}',
      '',
      `/** HTTP status of each ${context.name} domain error. */`,
      statuses.length ? `export const ${camel(context.name)}ErrorStatus: ErrorStatusMap = {` : `export const ${camel(context.name)}ErrorStatus: ErrorStatusMap = {}`,
      ...(statuses.length ? [statuses.join(',\n'), '}'] : [])
    ])
  }
}

// ── Client composable ──────────────────────────────────────────────────

interface Optimistic { kind: 'insert' | 'update' | 'delete', entity: string, key?: Value, unless?: string, set?: Record<string, Value> }

/**
 * The client composable of an action with no `client.optimistic` (B7 for no input, fix/action-server-call for the rest): `execute(...)`
 * calls the route with its input, then refetches what the action invalidates. It is not a `createOptimisticAction` with an empty
 * `onMutate`: TanStack DB's transaction only calls its `mutationFn` when something was mutated, so that never reached the server.
 * The public surface is the optimistic composable's: `execute` (true when the server answered), `pending` and `error`.
 */
const directComposableFile = (context: ModuleContext, analyzed: Analyzed) => {
  const { action, inputEntity, params, output } = analyzed
  if (action.client.optimistic) throw new Error(`${action.id}: an optimistic action goes through createOptimisticAction`)
  if (!inputEntity && params.length > 1) throw new Error(`${action.id}: client actions need one entity input or one parameter`)
  const source = context.source(action.id)
  const invalidated = action.client.invalidates.map(id => entityById(context, id))
  const collections = new Set(invalidated.map(entity => entityNames(entity).collection))
  const doc = `Action "${action.label}": runs the server use-case${invalidated.length ? `; invalidates ${invalidated.map(entity => entity.name).join(', ')}` : ''}.`
  const uuidInput = inputEntity?.idStrategy === 'uuid'
  // The input's and the output's types, each imported from its own entity's file.
  const domain = new Map<string, ImportName[]>()
  for (const [entity, name] of [[inputEntity, inputEntity && `New${inputEntity.name}`], [output, output?.name]] as const) {
    if (entity && name) domain.set(entityNames(entity).file, [...(domain.get(entityNames(entity).file) ?? []), { name, type: true }])
  }
  const alias = inputEntity && uuidInput ? `type ${pascal(action.name)}Input = Omit<New${inputEntity.name}, 'id'>` : undefined
  const signature = inputEntity ? `input: ${uuidInput ? `${pascal(action.name)}Input` : `New${inputEntity.name}`}` : params.map(param => `${param.name}: ${tsType(param.type)}`).join('')
  const route = `/api/${context.name}${action.http.path}`
  const url = params.length ? `\`${route.replace(/:(\w+)/g, '${$1}')}\`` : tsString(route)
  const body = inputEntity ? `, body: ${uuidInput ? '{ ...input, id: newId() }' : 'input'}` : ''
  return {
    path: `layers/${context.name}/app/composables/${context.name}/use${pascal(action.name)}.ts`,
    source,
    content: file([
      header(source),
      'import { ref } from \'vue\'',
      uuidInput && importLine('#core/kernel/ids', ['newId']),
      ...[...domain.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, names]) => importLine(`#${context.name}/domain/${path}`, names)),
      ...[...collections].sort().map((collection) => {
        const entity = context.module.entities.find(entry => entityNames(entry).collection === collection)!
        return `import { ${collection} } from '../../data/${kebab(entity.plural)}.collection'`
      }),
      '',
      alias,
      alias !== undefined && '',
      `/** ${docText(doc)} */`,
      `export const use${pascal(action.name)} = () => {`,
      '  const pending = ref(false)',
      '  const error = ref<string>()',
      '',
      `  const execute = async (${signature}): Promise<boolean> => {`,
      '    pending.value = true',
      '    error.value = undefined',
      '    try {',
      `      await $fetch${output ? `<${output.name}>` : ''}(${url}, { method: ${tsString(action.http.method)}${body} })`,
      ...invalidated.map(entity => `      await ${entityNames(entity).collection}.utils.refetch()`),
      '      return true',
      '    } catch (cause) {',
      '      error.value = errorMessage(cause)',
      '      return false',
      '    } finally {',
      '      pending.value = false',
      '    }',
      '  }',
      '',
      '  return { execute, pending, error }',
      '}'
    ])
  }
}

const composableFile = (context: ModuleContext, analyzed: Analyzed) => {
  const { action, inputEntity, params, output } = analyzed
  const optimistic = action.client.optimistic as Optimistic | undefined
  if (!optimistic) return directComposableFile(context, analyzed)
  if (!inputEntity && params.length === 0) throw new Error(`${action.id}: an action with no input can't be optimistic (it has no row or parameter to show ahead of the server)`)
  const source = context.source(action.id)
  const composable = `use${pascal(action.name)}`
  const invalidated = action.client.invalidates.map(id => entityById(context, id))
  const collections = new Set(invalidated.map(entity => entityNames(entity).collection))
  const ids = new Set<string>()
  const types = new Set<string>()
  if (output) types.add(output.name)

  let generic: string
  let argument: string
  let execute: { signature: string, call: string, alias?: string }
  if (inputEntity) {
    types.add(`New${inputEntity.name}`)
    generic = `New${inputEntity.name}`
    argument = 'input'
    if (inputEntity.idStrategy === 'uuid') {
      ids.add('newId')
      execute = { signature: `input: ${pascal(action.name)}Input`, call: 'action({ ...input, id: newId() })', alias: `type ${pascal(action.name)}Input = Omit<New${inputEntity.name}, 'id'>` }
    } else {
      execute = { signature: `input: New${inputEntity.name}`, call: 'action(input)' }
    }
  } else {
    if (params.length !== 1) throw new Error(`${action.id}: client actions need one entity input or one parameter`)
    generic = tsType(params[0]!.type)
    argument = params[0]!.name
    execute = { signature: `${argument}: ${generic}`, call: `action(${argument})` }
  }

  // An action with no `client.optimistic` never gets here (directComposableFile): its onMutate would be empty and TanStack DB would
  // skip the server. An optimistic one whose onMutate changes nothing on a call (publishing an already published post: `unless`)
  // skips the server the same way. That one is left as is: the server's answer would be the row unchanged (see the use-case).
  const mutate: string[] = []
  const entity = entityById(context, optimistic.entity)
  const collection = entityNames(entity).collection
  collections.add(collection)
  if (optimistic.kind === 'insert') {
    const create = analyzed.steps.find(step => step.kind === 'repository' && step.op === 'create')
    const set = (create?.set ?? {}) as Record<string, Value>
    const stamps = entity.timestamps ? ['createdAt', 'updatedAt'] : []
    const at = nowCount(set) + stamps.length >= 2
    if (at || nowCount(set)) ids.add('now')
    const scope = { input: (name: string) => `input.${name}`, at }
    const picked = new Set(action.input.pick ?? allFields(entity).map(field => field.name))
    const defaults = entity.fields.filter(field => picked.has(field.name) && field.default !== undefined).map(field => `${field.name}: ${tsLiteral(field.default!)}`)
    mutate.push(
      `onMutate: (${argument}) => {`,
      ...(at ? ['  const at = now()'] : []),
      `  ${collection}.insert({`,
      `    ${[...defaults, '...input'].join(', ')},`,
      `    ${[...setEntries(set, scope), ...stamps.map(name => `${name}: ${at ? 'at' : 'now()'}`)].join(', ')}`,
      '  })',
      '},'
    )
  } else if (optimistic.kind === 'update') {
    const set = optimistic.set ?? {}
    const at = nowCount(set) >= 2
    if (nowCount(set)) ids.add('now')
    const scope = { input: (name: string) => name, at }
    mutate.push(
      `onMutate: (${argument}) => {`,
      `  ${collection}.update(${compile(optimistic.key ?? null, scope)}, (draft) => {`,
      ...(at ? ['    const at = now()'] : []),
      ...(optimistic.unless ? [`    if (draft.${optimistic.unless}) return`] : []),
      ...Object.entries(set).map(([key, value]) => `    draft.${key} = ${compile(value, scope)}`),
      '  })',
      '},'
    )
  } else {
    mutate.push(`onMutate: (${argument}) => {`, `  ${collection}.delete(${compile(optimistic.key ?? null, { input: name => name, at: false })})`, '},')
  }

  const route = `/api/${context.name}${action.http.path}`
  const url = params.length ? `\`${route.replace(/:(\w+)/g, '${$1}')}\`` : tsString(route)
  const fetchType = output ? `<${output.name}>` : ''
  const doc = `Action "${action.label}": optimistic ${optimistic.kind}, confirmed by the server use-case${invalidated.length ? `; invalidates ${invalidated.map(entity => entity.name).join(', ')}` : ''}.`
  // The types it imports are the input's and the output's: an action with neither (a delete) imports none.
  const typed = inputEntity ?? output

  return {
    path: `layers/${context.name}/app/composables/${context.name}/${composable}.ts`,
    source,
    content: file([
      header(source),
      'import { createOptimisticAction } from \'@tanstack/vue-db\'',
      'import { ref } from \'vue\'',
      ids.size > 0 && importLine('#core/kernel/ids', [...ids]),
      typed && importLine(`#${context.name}/domain/${entityNames(typed).file}`, [...types].map(name => ({ name, type: true }))),
      ...[...collections].sort().map((collection) => {
        const entity = context.module.entities.find(entry => entityNames(entry).collection === collection)!
        return `import { ${collection} } from '../../data/${kebab(entity.plural)}.collection'`
      }),
      '',
      execute.alias,
      execute.alias !== undefined && '',
      `/** ${docText(doc)} */`,
      `export const ${composable} = () => {`,
      '  const pending = ref(false)',
      '  const error = ref<string>()',
      '',
      `  const action = createOptimisticAction<${generic}>({`,
      ...mutate.map(line => `    ${line}`),
      `    mutationFn: async (${argument}) => {`,
      `      await $fetch${fetchType}(${url}, { method: ${tsString(action.http.method)}${inputEntity ? ', body: input' : ''} })`,
      ...invalidated.map(entity => `      await ${entityNames(entity).collection}.utils.refetch()`),
      '    }',
      '  })',
      '',
      `  const execute = async (${execute.signature}): Promise<boolean> => {`,
      '    pending.value = true',
      '    error.value = undefined',
      '    try {',
      `      await ${execute.call}.when('settled')`,
      '      return true',
      '    } catch (cause) {',
      '      error.value = errorMessage(cause)',
      '      return false',
      '    } finally {',
      '      pending.value = false',
      '    }',
      '  }',
      '',
      '  return { execute, pending, error }',
      '}'
    ])
  }
}

// ── Generated use-case tests ───────────────────────────────────────────

const sampleId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sampleValue = (field: Field): Value => {
  if (field.name === 'id' || field.type === 'uuid') return sampleId(1)
  if (field.type === 'integer' || field.type === 'number') return 1
  if (field.type === 'boolean') return true
  if (field.type === 'datetime') return '2026-01-01T00:00:00.000Z'
  if (field.type === 'date') return '2026-01-01'
  return field.name
}

/** Success plus one test per modeled error, against the in-memory repositories. */
const useCaseTestFile = (context: ModuleContext, analyzed: Analyzed) => {
  const { action, inputEntity, params } = analyzed
  const source = context.source(action.id)
  const deps = analyzed.repositories.map(({ entity }) => entity.plural).join(', ')
  const built = deps ? `{ ${deps} }` : ''
  const memory = analyzed.repositories.map(({ entity }) => ({ entity, factory: `memory${entityNames(entity).port}` }))
  const imports: Array<{ path: string, line: string }> = [
    { path: `../../server/application/actions/${kebab(action.name)}`, line: `import { ${action.name} } from '../../server/application/actions/${kebab(action.name)}'` },
    ...memory.map(({ entity, factory }) => ({ path: `../../server/infrastructure/repositories/${entityNames(entity).file}.memory`, line: `import { ${factory} } from '../../server/infrastructure/repositories/${entityNames(entity).file}.memory'` }))
  ]
  const setup = (seeded: boolean) => memory.map(({ entity, factory }) => `    const ${entity.plural} = ${factory}(${seeded ? `${entityNames(entity).variable}Seed` : ''})`)
  const tests: string[][] = []
  const preamble: string[] = []

  if (inputEntity) {
    const picked = action.input.pick ?? allFields(inputEntity).map(field => field.name)
    const fields = picked.map(name => allFields(inputEntity).find(field => field.name === name)!)
    preamble.push(`const input = { ${fields.map(field => `${field.name}: ${tsLiteral(sampleValue(field))}`).join(', ')} }`, '')
    tests.push(['  it(\'succeeds\', async () => {', ...setup(false), `    const result = await ${action.name}(${built})(input)`, '    expect(result.ok).toBe(true)', '  })'])
    for (const step of analyzed.steps.filter(entry => entry.kind === 'assert')) {
      const again = inputEntity.idStrategy === 'uuid' ? `{ ...input, id: ${tsString(sampleId(2))} }` : 'input'
      tests.push([
        `  it('fails with ${String(step.error)}', async () => {`,
        ...setup(false),
        `    await ${action.name}(${built})(input)`,
        `    const result = await ${action.name}(${built})(${again})`,
        `    expect(result).toEqual({ ok: false, error: expect.objectContaining({ type: ${tsString(String(step.error))} }) })`,
        '  })'
      ])
    }
  } else {
    const load = analyzed.steps.find(step => step.kind === 'load')
    const loaded = load ? analyzed.repositories.find(entry => entry.repository.id === load.repository) : undefined
    const seeded = loaded && context.module.fixtures.some(fixtures => fixtures.entity === loaded.entity.id)
    if (loaded && !seeded) throw new Error(`${action.id}: generated tests need fixtures for ${loaded.entity.name}`)
    if (loaded) {
      const seedFile = datasourceOf(context, loaded.repository).kind === 'memory' ? '../../server/infrastructure/memory/seed' : '../../server/infrastructure/db/seed'
      imports.push({ path: seedFile, line: `import { ${entityNames(loaded.entity).variable}Seed } from '${seedFile}'` })
    }
    const existing = loaded ? `${entityNames(loaded.entity).variable}Seed[0]!.id` : tsString(sampleId(1))
    tests.push(['  it(\'succeeds\', async () => {', ...setup(Boolean(loaded)), `    const result = await ${action.name}(${built})(${params.map(() => existing).join(', ')})`, '    expect(result.ok).toBe(true)', '  })'])
    if (load?.orError) {
      tests.push([
        `  it('fails with ${String(load.orError)}', async () => {`,
        ...setup(false),
        `    const result = await ${action.name}(${built})(${params.map(() => tsString(sampleId(1))).join(', ')})`,
        `    expect(result).toEqual({ ok: false, error: expect.objectContaining({ type: ${tsString(String(load.orError))} }) })`,
        '  })'
      ])
    }
  }

  return {
    path: `layers/${context.name}/test/application/${kebab(action.name)}.test.ts`,
    source,
    content: file([
      header(source),
      'import { describe, expect, it } from \'vitest\'',
      ...imports.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(entry => entry.line),
      '',
      ...preamble,
      `describe('${action.name}', () => {`,
      tests.map(test => test.join('\n')).join('\n\n'),
      '})'
    ])
  }
}
