import type { Model } from '../model/load.ts'
import type { ActionFile, DataSourceFile, EntityFile, RepositoryFile, Value } from '../model/schemas.ts'
import type { GeneratedFile } from '../sync/plan.ts'
import { isBasicType, sampleOf } from '../model/field-types.ts'
import { allFields, datasourceOf, entityById, entityNames, moduleContext, repositoryOf } from './context.ts'
import type { Field, ModuleContext } from './context.ts'
import { actionContractFile, actionContractNames, contractImport, contractPath } from './contracts.ts'
import { importLine } from './imports.ts'
import { composableOf } from './names.ts'
import { importPath } from './paths.ts'
import type { RepositoryAdapter } from './paths.ts'
import { SOURCE_ERRORS, answersResult, cacheImports, checkSourceErrorTypes, resultSources, sourceAdapterArgs, sourceClientLines, sourceErrorsFile, sourceNames } from './rest-source.ts'
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
    files.push(errorsFile(context), compositionRootFile(context, actions), ...rulesFiles(context, actions))
    files.push(...resultSources(context).map(source => sourceErrorsFile(context, source)))
    for (const action of actions) {
      files.push(useCaseFile(context, action), actionContractFile(context, action), routeFile(context, action), composableFile(context, action), useCaseTestFile(context, action))
    }
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
  checkSourceErrorTypes(context, errors.map(error => error.type), errorTypeName(context))
  // A REST source's failures are the module's too: its Result-answering repositories pass them on (R1').
  const sources = resultSources(context).map(source => sourceNames(context, source))
  const type = errorTypeName(context)
  const union = errors.map(error => `  | { type: ${tsString(error.type)}, message: string${Object.entries(error.data ?? {}).map(([key, kind]) => `, ${key}: ${tsType(kind)}`).join('')} }`)
  const factories = errors.map((error) => {
    const data = Object.entries(error.data ?? {})
    const params = data.map(([key, kind]) => `${key}: ${tsType(kind)}`).join(', ')
    const fields = data.map(([key]) => key)
    return `export const ${errorFactory(error.type)} = (${params}): ${type} => ({ type: ${tsString(error.type)}, message: ${messageExpression(error.message, fields)}${fields.map(key => `, ${key}`).join('')} })`
  })
  return {
    path: context.paths.errors,
    content: file([
      `// Generated by bildr from the ${context.name} module's actions. Editing this file detaches it from the editor.`,
      ...sources.map(names => `import type { ${names.error} } from './sources/${names.file}'`),
      '',
      `/** Every expected failure of the ${context.name} module's use-cases${sources.length ? `, and of the ${resultSources(context).map(source => `"${source.name}"`).join(' and ')} data source${sources.length > 1 ? 's' : ''} they read` : ''}. */`,
      errors.length || sources.length ? `export type ${type} =` : `export type ${type} = never`,
      ...union,
      ...sources.map(names => `  | ${names.error}`),
      ...factories.flatMap(factory => ['', factory])
    ])
  }
}

// ── Domain rules ───────────────────────────────────────────────────────

/**
 * What an action changes, as one pure function of the domain (codegen-architecture T4a): the `set` of its repository step and,
 * for an update, the trailing `return <row> if …` steps (the action changes nothing then). The use-case applies it, and so does
 * the optimistic update when it says the same as the steps or nothing (`agreesWith`). Timestamps aren't in it: they are the
 * store's bookkeeping, stamped where the row is written.
 */
interface Rule {
  name: string
  entity: EntityFile
  kind: 'create' | 'update'
  /** The row an update loads and changes, and its id (update only). */
  row?: string
  id?: Value
  /**
   * What it reads: the input (create), or the fields of the row its guards read (update). Only those fields: the server passes the
   * entity, the optimistic update the collection's draft, whose fields with a default are optional.
   */
  param: { name: string, type: string }
  set: Record<string, Value>
  /** When any holds, the action changes nothing (update only). */
  guards: Value[]
  /** Whether it sets a time: it takes `at`. */
  at: boolean
}

/** Whether every `$input` and `$var` a value tree reads passes `allowed`. */
const readsOnly = (value: unknown, allowed: (read: { input?: string, var?: string }) => boolean): boolean => {
  if (!value || typeof value !== 'object') return true
  if (Array.isArray(value)) return value.every(item => readsOnly(item, allowed))
  if ('$input' in value) return allowed({ input: String(value.$input) })
  if ('$var' in value) return allowed({ var: String(value.$var) })
  return Object.values(value).every(item => readsOnly(item, allowed))
}

const ruleName = (action: ActionFile) => `${action.name}Change`

/** The rule of an action, or undefined when its steps set nothing a pure function of its input or its row can say. */
const ruleOf = (analyzed: Analyzed): Rule | undefined => {
  const { action, inputEntity, steps } = analyzed
  const last = steps.at(-1)
  if (last?.kind !== 'repository') return undefined
  const set = (last.set ?? {}) as Record<string, Value>
  if (Object.keys(set).length === 0) return undefined
  const entity = analyzed.repositories.find(entry => entry.repository.id === last.repository)!.entity
  if (last.op === 'create') {
    if (!inputEntity || !readsOnly(set, read => read.input !== undefined)) return undefined
    // What it sets decides nothing (constants, the time): the use-case says it inline.
    if (readsOnly(set, () => false)) return undefined
    return { name: ruleName(action), entity, kind: 'create', param: { name: 'input', type: `New${inputEntity.name}` }, set, guards: [], at: nowCount(set) > 0 }
  }
  if (last.op !== 'update') return undefined
  const from = last.from as Value
  const row = from && typeof from === 'object' && !Array.isArray(from) && '$var' in from ? String(from.$var) : undefined
  // The row must be one the action loaded from the repository it updates: the rule takes it as that entity.
  if (!row || !steps.some(step => step.kind === 'load' && step.as === row && step.repository === last.repository)) return undefined
  // The rule takes the row and the time: a row named `at` would be two parameters of one name.
  if (row === 'at' && nowCount(set) > 0) return undefined
  // What it sets reads nothing (the row's fields would be optional on the draft); its guards read fields of the row.
  if (!readsOnly(set, () => false)) return undefined
  const fields = new Set<string>()
  /** The fields of the row a guard reads, when it reads nothing else. */
  const own = (value: unknown) => {
    const read = new Set<string>()
    const only = readsOnly(value, (entry) => {
      if (!entry.var?.startsWith(`${row}.`)) return false
      read.add(entry.var.slice(row.length + 1).split('.')[0]!)
      return true
    })
    return only ? read : undefined
  }
  // The returns right before the update that answer the row unchanged: where the action changes nothing.
  const guards: Value[] = []
  for (let index = steps.length - 2; index >= 0; index--) {
    const step = steps[index]!
    const value = step.value as Value
    const answersRow = value && typeof value === 'object' && !Array.isArray(value) && '$var' in value && value.$var === row
    const read = step.kind === 'return' && answersRow && step.if && typeof step.if === 'object' ? own(step.if) : undefined
    if (!read?.size) break
    guards.unshift(step.if as Value)
    for (const field of read) fields.add(field)
  }
  // An update with no guard decides nothing (it sets constants, the time): the use-case says it inline.
  if (guards.length === 0) return undefined
  const param = { name: row, type: `Partial<Pick<${entity.name}, ${[...fields].sort().map(quotedKey).join(' | ')}>>` }
  const rule: Rule = { name: ruleName(action), entity, kind: 'update', row, id: last.id as Value, param, set, guards, at: nowCount(set) > 0 }
  // The rule answers into a local of the use-case: with no free name for it, the action keeps its steps inline.
  return changeLocal(analyzed, rule) ? rule : undefined
}

const quotedKey = (key: string) => tsString(key)

/** The name of the change an update use-case reads from its rule: one no other name of the use-case takes. */
const changeLocal = (analyzed: Analyzed, rule: Rule) => {
  const taken = new Set([rule.name, analyzed.action.name, 'data', 'input', 'at', ...analyzed.params.map(param => param.name), ...analyzed.steps.map(step => String(step.as ?? ''))])
  return [`${rule.row}Change`, 'change', 'changed'].find(name => !taken.has(name))
}

/** The call of a rule: `of` is what it reads, `at` the time it sets (when it sets one). */
const applyRule = (rule: Rule, of: string, at: string) => `${rule.name}(${[of, ...(rule.at ? [at] : [])].join(', ')})`

/** One `<entity>.rules.ts` per entity some action changes by a rule. */
const rulesFiles = (context: ModuleContext, actions: Analyzed[]) => {
  const byEntity = new Map<string, Array<{ analyzed: Analyzed, rule: Rule }>>()
  for (const analyzed of actions) {
    const rule = ruleOf(analyzed)
    if (rule) byEntity.set(rule.entity.id, [...(byEntity.get(rule.entity.id) ?? []), { analyzed, rule }])
  }
  return [...byEntity.values()].map((rules) => {
    const entity = rules[0]!.rule.entity
    const path = context.paths.rules(entityNames(entity).file)
    const types = new Map<string, Set<string>>()
    const type = (of: EntityFile, name: string) => types.set(entityNames(of).file, (types.get(entityNames(of).file) ?? new Set()).add(name))
    const functions = rules.map(({ analyzed, rule }) => {
      const scope = { input: (name: string) => `input.${name}`, at: true }
      const changed = `Pick<${entity.name}, ${Object.keys(rule.set).map(quotedKey).join(' | ')}>`
      const params = [`${rule.param.name}: ${rule.param.type}`, ...(rule.at ? ['at: string'] : [])].join(', ')
      const doc = (what: string) => `/** ${docText(`What "${analyzed.action.label}" ${what}. The use-case and its optimistic update both apply it.`)} */`
      type(entity, entity.name)
      const body = `{ ${setEntries(rule.set, scope).join(', ')} }`
      if (rule.kind === 'create') {
        type(analyzed.inputEntity!, rule.param.type)
        return [doc(`sets on a new ${entity.name}`), `export const ${rule.name} = (${params}): ${changed} => (${body})`]
      }
      return [
        doc(`changes on a ${entity.name}, or undefined when it changes nothing`),
        `export const ${rule.name} = (${params}): ${changed} | undefined => {`,
        ...rule.guards.map(guard => `  if (${compile(guard, scope)}) return undefined`),
        `  return ${body}`,
        '}'
      ]
    })
    return {
      path,
      content: file([
        `// Generated by bildr from the ${context.name} module's actions. Editing this file detaches it from the editor.`,
        ...[...types.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
          .map(([of, names]) => importLine(importPath(path, context.paths.entity(of)), [...names].sort().map(name => ({ name, type: true })))),
        ...functions.flatMap(lines => ['', ...lines])
      ])
    }
  })
}

/** A model value as one string, its object keys sorted: two values that say the same are equal. */
const canonical = (value: unknown): string => JSON.stringify(value, (_, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  : item)

/** Whether an optimistic update says what the rule says (or nothing): then it applies the rule instead of its own code. */
const agreesWith = (optimistic: Optimistic, rule: Rule) => {
  if (optimistic.kind !== 'update' || rule.kind !== 'update' || optimistic.entity !== rule.entity.id) return false
  // It must change the row the server updates.
  if (canonical(optimistic.key ?? null) !== canonical(rule.id ?? null)) return false
  if (optimistic.set === undefined && optimistic.unless === undefined) return true
  if (optimistic.set === undefined || canonical(optimistic.set) !== canonical(rule.set)) return false
  // A rule always has a guard: an update that sets the same with no `unless` says something else.
  if (optimistic.unless === undefined) return false
  return rule.guards.length === 1 && canonical(rule.guards[0]) === canonical({ $var: `${rule.row}.${optimistic.unless}` })
}

// ── Use-case ───────────────────────────────────────────────────────────

const useCaseFile = (context: ModuleContext, analyzed: Analyzed) => {
  const { action, inputEntity, params, output } = analyzed
  const source = context.source(action.id)
  const deps = `${pascal(action.name)}Deps`
  const kernelIds = new Set<string>()
  const domain = new Map<string, ImportName[]>()
  const addDomain = (entity: EntityFile, name: ImportName, of: 'entity' | 'rules' = 'entity') => {
    const key = `${entityNames(entity).file}${of === 'rules' ? '.rules' : ''}`
    domain.set(key, [...(domain.get(key) ?? []), name])
  }
  const errorImports: ImportName[] = [{ name: errorTypeName(context), type: true }]
  const rule = ruleOf(analyzed)
  // The trailing guards an update's rule took over: the use-case doesn't run them itself.
  const guarded = new Set(rule ? analyzed.steps.slice(analyzed.steps.length - 1 - rule.guards.length, -1) : [])
  let usesErr = false
  let usesOk = false
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
  // A REST repository answers a Result (R1'): its failure is the use-case's own, passed on as it is, and its value read after.
  const answersOf = (step: object) =>
    answersResult(context, analyzed.repositories.find(entry => entry.repository.id === (step as { repository?: unknown }).repository)!.repository)
  /** `ok(value)`, and `ok` imported. */
  const okOf = (value: string) => {
    usesOk = true
    return `ok(${value})`
  }
  // The error factories too: the module's errors file exports them, and a use-case imports its own.
  const taken = new Set([action.name, 'data', 'input', 'at', 'ok', 'err', 'now', ...params.map(param => param.name), ...analyzed.repositories.map(({ entity }) => repositoryVariable(entity)),
    ...errorsOf(context).map(error => errorFactory(error.type)),
    ...analyzed.steps.map(step => String(step.as ?? '')), ...(rule ? [rule.name, changeLocal(analyzed, rule)!] : [])])
  /** A local of the use-case no other name takes. */
  const freeLocal = (name: string) => {
    let free = name
    while (taken.has(free)) free += '_'
    taken.add(free)
    return free
  }
  /** `const <name> = await <call>`, its value read from its Result when it answers one. */
  const awaited = (name: string, step: RepositoryCall) => {
    if (!answersOf(step)) return [`const ${name} = await ${call(step)}`]
    const answer = freeLocal(`${name}Loaded`)
    return [`const ${answer} = await ${call(step)}`, `if (!${answer}.ok) return ${answer}`, `const ${name} = ${answer}.value`]
  }
  /**
   * The answer of a write: its Result as it is, or the row wrapped in one. With no output the use-case answers `undefined` (T3c1), so
   * the row is not its answer: only a failure of the write is.
   */
  const written = (step: object, expression: string): string[] => {
    if (output) return [answersOf(step) ? `return ${expression}` : `return ${okOf(`await ${expression}`)}`]
    if (!answersOf(step)) return [`await ${expression}`, `return ${okOf('undefined')}`]
    const answer = freeLocal('written')
    return [`const ${answer} = await ${expression}`, `if (!${answer}.ok) return ${answer}`, `return ${okOf('undefined')}`]
  }

  for (const step of analyzed.steps) {
    if (guarded.has(step)) continue
    if (step.kind === 'validate') {
      if (!inputEntity) throw new Error(`${action.id}: validate needs an entity input`)
      body.push(`const data = New${inputEntity.name}Schema.parse(input)`)
      addDomain(inputEntity, { name: `New${inputEntity.name}Schema` })
      validated = true
      readsInput = true
    } else if (step.kind === 'assert') {
      const unless = step.unless as RepositoryCall
      if (answersOf(unless)) {
        const existing = freeLocal('existing')
        body.push(...awaited(existing, unless), `if (${existing}) return ${errorCall(String(step.error), step.errorData as Record<string, Value>)}`)
      } else {
        body.push(`if (await ${call(unless)}) return ${errorCall(String(step.error), step.errorData as Record<string, Value>)}`)
      }
    } else if (step.kind === 'load') {
      const as = identifier(String(step.as), `${action.id}: load as`)
      body.push(...awaited(as, step as unknown as RepositoryCall))
      if (step.orError) body.push(`if (!${as}) return ${errorCall(String(step.orError), step.errorData as Record<string, Value>)}`)
    } else if (step.kind === 'return') {
      const when = compile(step.if as Value, scope)
      // A return that always runs is a plain return: `if (true)` fails the project's lint.
      body.push(when === 'true' ? `return ${okOf(compile(step.value as Value, scope))}` : `if (${when}) return ${okOf(compile(step.value as Value, scope))}`)
    } else if (step.kind === 'repository') {
      const repository = analyzed.repositories.find(entry => entry.repository.id === step.repository)!
      const timestamps = repository.entity.timestamps ? (step.op === 'create' ? ['createdAt', 'updatedAt'] : ['updatedAt']) : []
      // A rule reads the time once, as its `at`.
      const times = rule ? Number(rule.at) : nowCount(step.set)
      scope.at = times + timestamps.length >= 2
      if (scope.at || times) kernelIds.add('now')
      if (scope.at) body.push('const at = now()')
      const stamped = timestamps.map(name => `${name}: ${scope.at ? 'at' : 'now()'}`)
      const variable = repositoryVariable(repository.entity)
      if (rule) addDomain(rule.entity, { name: rule.name }, 'rules')
      const applied = (of: string) => applyRule(rule!, of, scope.at ? 'at' : 'now()')
      if (step.op === 'create') {
        const set = rule ? [`...${applied('data')}`] : setEntries(step.set as Record<string, Value>, scope)
        // Unvalidated, the create writes its input as it came (its type is the entity's body already).
        if (!validated) readsInput = true
        body.push(...written(step, `${variable}.create({ ${[validated ? '...data' : '...input', ...set, ...stamped].join(', ')} })`))
      } else if (step.op === 'update' && rule) {
        // The rule's guards decide whether anything changes: nothing, and the row is answered as it is.
        const local = changeLocal(analyzed, rule)!
        body.push(
          `const ${local} = ${applied(rule.row!)}`,
          `if (!${local}) return ${okOf(output ? rule.row! : 'undefined')}`,
          ...written(step, `${variable}.update(${compile(step.id as Value, scope)}, { ${[`...${rule.row}`, `...${local}`, ...stamped].join(', ')} })`)
        )
      } else if (step.op === 'update') {
        body.push(...written(step, `${variable}.update(${compile(step.id as Value, scope)}, { ${[`...${compile(step.from as Value, scope)}`, ...setEntries(step.set as Record<string, Value>, scope), ...stamped].join(', ')} })`))
      } else if (step.op === 'delete') {
        body.push(...(answersOf(step) ? [`return ${variable}.delete(${compile(step.id as Value, scope)})`] : [`await ${variable}.delete(${compile(step.id as Value, scope)})`, `return ${okOf('undefined')}`]))
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
  // An action with no output answers `undefined` (T3c1), as its route's contract and its client say.
  const result = `Promise<Result<${output?.name ?? 'undefined'}, ${errorTypeName(context)}>>`

  const path = context.paths.action(kebab(action.name))
  return {
    path,
    source,
    content: file([
      header(source),
      kernelIds.size > 0 && importLine('#core/kernel/ids', [...kernelIds]),
      // A use-case whose every answer is a REST repository's Result wraps none itself.
      importLine('#core/kernel/result', [{ name: 'Result', type: true }, ...(usesErr ? ['err'] : []), ...(usesOk ? ['ok'] : [])]),
      importLine(`#${context.name}/domain/errors`, errorImports),
      ...[...domain.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, names]) => importLine(`#${context.name}/domain/${path}`, names)),
      ...analyzed.repositories.map(({ entity }) => `import type { ${entityNames(entity).port} } from '${importPath(path, context.paths.port(entityNames(entity).portFile))}'`),
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
  if (segments.length <= 1) return context.paths.apiRoute(`${segments[0] ?? ''}${segments.length ? '/' : ''}index.${method}.ts`)
  return context.paths.apiRoute(`${segments.slice(0, -1).join('/')}/${segments.at(-1)}.${method}.ts`)
}

const routeFile = (context: ModuleContext, analyzed: Analyzed) => {
  const { action, inputEntity, params } = analyzed
  const source = context.source(action.id)
  for (const param of params) if (param.type !== 'uuid' || param.from !== 'route') throw new Error(`${action.id}: only route uuid parameters are generated yet ("${param.name}")`)
  const invoke = `${context.root}().${action.name}(${inputEntity ? 'input' : params.map(param => param.name).join(', ')})`
  const contract = actionContractNames(context, action)
  return {
    path: routePath(context, action),
    source,
    content: file([
      header(source),
      inputEntity
        ? 'import { defineEventHandler, readValidatedBody } from \'nuxt/server\''
        : `import { defineEventHandler${params.length ? ', getRouterParam' : ''} } from 'nuxt/server'`,
      // A route that reads neither a body nor a parameter reads only its contract's response type.
      inputEntity || params.length ? contractImport(contract) : importLine(contract.from, [{ name: contract.response, type: true }]),
      '',
      // It answers what its contract says; the event also answers a remote source's Retry-After (R3'b).
      `export default defineEventHandler(async (event): Promise<${contract.response}> => {`,
      inputEntity && `  const input = await readValidatedBody(event, ${contract.value}.body)`,
      ...params.map(param => `  const ${param.name} = ${contract.value}.params.${param.name}.parse(getRouterParam(event, ${tsString(param.name)}))`),
      `  return unwrapOrThrow(await ${invoke}, ${camel(context.name)}ErrorStatus, event)`,
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
  // The REST sources whose client the root builds: the ones a wired, Result-answering repository reads (R1').
  const clients: DataSourceFile[] = []
  const listed = (repository: RepositoryFile) => Boolean(repository.expose?.list && repository.operations.includes('list'))
  // Only repositories a use-case consumes are wired: an unused adapter binding fails the project's lint.
  const consumed = new Set(actions.flatMap(analyzed => analyzed.repositories.map(({ entity }) => entity.id)))
  const rootPath = context.paths.compositionRoot

  for (const entity of context.module.entities) {
    const repository = repositoryOf(context, entity)
    if (!repository || !(listed(repository) || consumed.has(entity.id))) continue
    const names = entityNames(entity)
    const datasource = datasourceOf(context, repository)
    const adapter = datasource.kind === 'sqlite' ? `drizzle${names.port}` : `${datasource.kind}${names.port}`
    const adapterFile = (datasource.kind === 'sqlite' ? 'drizzle' : datasource.kind) as RepositoryAdapter
    imports.push({ path: importPath(rootPath, context.paths.repository(names.file, adapterFile)), name: adapter })
    if (datasource.kind === 'memory') {
      const seeded = context.module.fixtures.some(fixtures => fixtures.entity === entity.id)
      if (seeded) seeds.push(`${names.variable}Seed`)
      stores.push(`const ${names.plural} = ${adapter}(${seeded ? `${names.variable}Seed` : ''})`)
    } else {
      // A REST repository is wired to its source's client (R1'); a database one to the app database.
      const client = answersResult(context, repository) ? sourceAdapterArgs(context, datasource) : 'useDb()'
      if (answersResult(context, repository) && !clients.includes(datasource)) clients.push(datasource)
      wiring.push(`  const ${names.plural} = ${adapter}(${client})`)
    }
    if (datasource.kind === 'sqlite') sources.database = true
    // A repository never lives on an api source (load.ts refuses it).
    else if (datasource.kind !== 'api' && !sources[datasource.kind].includes(datasource.name)) sources[datasource.kind].push(datasource.name)
    if (listed(repository)) {
      const useCase = `list${pascal(entity.plural)}`
      imports.push({ path: importPath(rootPath, context.paths.query(`list-${names.pluralFile}`)), name: useCase })
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
  for (const analyzed of actions) imports.push({ path: importPath(rootPath, context.paths.action(kebab(analyzed.action.name))), name: analyzed.action.name })
  if (seeds.length) imports.push({ path: importPath(rootPath, context.paths.memorySeed), name: seeds.join(', ') })

  const named = (names: string[], kind: string) => `the ${names.map(name => `"${name}"`).join(' and ')} ${kind}data source${names.length > 1 ? 's' : ''}`
  const wired = [
    ...(sources.database ? ['the app database'] : []),
    ...(sources.rest.length ? [named(sources.rest, '')] : []),
    ...(sources.memory.length ? [named(sources.memory, 'memory ')] : [])
  ]
  const statuses = [
    ...errorsOf(context).map(error => `  ${error.type}: ${error.status}`),
    ...(resultSources(context).length ? SOURCE_ERRORS.map(error => `  ${error.type}: ${error.status}`) : [])
  ]
  const clientImports = clients.length
    ? [
        'import { useRuntimeConfig } from \'nuxt/server\'',
        'import { type ApiClient, resultClient } from \'#core/http/api-client\'',
        ...cacheImports(clients),
        'import { createHttpClient } from \'#core/http/client\'',
        ...clients.map(source => importLine(sourceNames(context, source).from, [{ name: sourceNames(context, source).error, type: true }, sourceNames(context, source).failed]))
      ]
    : []
  const source = `.bildr/modules/${context.name}`
  return {
    path: rootPath,
    source,
    content: file([
      header(source),
      `// Composition root of the ${context.name} module: the only place where use-cases meet their adapters.`,
      ...clientImports,
      statuses.length
        ? importLine(`#${context.name}/domain/errors`, [{ name: errorTypeName(context), type: true }])
        : 'import type { ErrorStatusMap } from \'#core/kernel/result\'',
      ...imports.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(entry => `import { ${entry.name} } from '${entry.path}'`),
      '',
      ...(stores.length ? ['// Memory data sources: one store per server process, seeded from the model fixtures, never persisted.', ...stores, ''] : []),
      ...clients.flatMap(source => [...sourceClientLines(context, source), '']),
      `/** The ${context.name} module's use-cases${wired.length ? `, wired to ${wired.join(' and ')}` : ''}. */`,
      // With a REST source, a read route gives its request's signal: when the browser goes away, the call stops (R4b).
      `export const ${context.root} = (${clients.length ? 'signal?: AbortSignal' : ''}) => {`,
      ...wiring,
      ...(entries.length ? ['  return {', entries.join(',\n'), '  }'] : ['  return {}']),
      '}',
      '',
      `/** HTTP status of each ${context.name} domain error. */`,
      // Every error type of the module has its status: a type added without one does not compile.
      statuses.length ? `export const ${camel(context.name)}ErrorStatus = {` : `export const ${camel(context.name)}ErrorStatus: ErrorStatusMap = {}`,
      ...(statuses.length ? [statuses.join(',\n'), `} satisfies Record<${errorTypeName(context)}['type'], number>`] : [])
    ])
  }
}

// ── Client composable ──────────────────────────────────────────────────

const RUN_DOC = (context: ModuleContext) => `\`run\` answers a Result, its error one of ${errorTypeName(context)} or unexpected, and never throws; \`pending\` and \`error\` are refs.`

interface Optimistic { kind: 'insert' | 'update' | 'delete', entity: string, key?: Value, unless?: string, set?: Record<string, Value> }

/**
 * The client composable of an action with no `client.optimistic` (B7 for no input, fix/action-server-call for the rest): `run(...)`
 * calls the route with its input, then refetches what the action invalidates. It is not a `createOptimisticAction` with an empty
 * `onMutate`: TanStack DB's transaction only calls its `mutationFn` when something was mutated, so that never reached the server.
 * The public surface is the optimistic composable's and an API action's (T3c2, the core's `useAction`): `run` answers a Result whose
 * error is one of the module's (`<Module>Error`) or `unexpected`, and never throws; `pending` and `error` are refs. It answers what the
 * route answered.
 */
const directComposableFile = (context: ModuleContext, analyzed: Analyzed) => {
  const { action, inputEntity, params } = analyzed
  if (action.client.optimistic) throw new Error(`${action.id}: an optimistic action goes through createOptimisticAction`)
  if (!inputEntity && params.length > 1) throw new Error(`${action.id}: client actions need one entity input or one parameter`)
  const source = context.source(action.id)
  const invalidated = action.client.invalidates.map(id => entityById(context, id))
  const collections = new Set(invalidated.map(entity => entityNames(entity).collection))
  const doc = `Action "${action.label}": runs the server use-case${invalidated.length ? `; invalidates ${invalidated.map(entity => entity.name).join(', ')}` : ''}. ${RUN_DOC(context)}`
  const uuidInput = inputEntity?.idStrategy === 'uuid'
  // The input's type, from its entity's file; what the route answers is its contract's.
  const domain = new Map<string, ImportName[]>()
  if (inputEntity) domain.set(entityNames(inputEntity).file, [{ name: `New${inputEntity.name}`, type: true }])
  const contract = actionContractNames(context, action)
  const alias = inputEntity && uuidInput ? `type ${pascal(action.name)}Input = Omit<New${inputEntity.name}, 'id'>` : undefined
  const signature = inputEntity ? `input: ${uuidInput ? `${pascal(action.name)}Input` : `New${inputEntity.name}`}` : params.map(param => `${param.name}: ${tsType(param.type)}`).join('')
  const body = inputEntity ? `, body: ${uuidInput ? '{ ...input, id: newId() }' : 'input'}` : ''
  const call = fetchCall(context, contract, params.map(param => param.name), body)
  const path = context.paths.composable(composableOf(action.name))
  return {
    path,
    source,
    content: file([
      header(source),
      uuidInput && importLine('#core/kernel/ids', ['newId']),
      importLine('#layers/core/app/data/results', ['fromRoute', 'useAction']),
      contractImport(contract),
      importLine(`#${context.name}/domain/errors`, [{ name: errorTypeName(context), type: true }]),
      ...[...domain.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, names]) => importLine(`#${context.name}/domain/${path}`, names)),
      ...[...collections].sort().map((collection) => {
        const entity = context.module.entities.find(entry => entityNames(entry).collection === collection)!
        return `import { ${collection} } from '${importPath(path, context.paths.collection(entityNames(entity).pluralFile))}'`
      }),
      '',
      alias,
      alias !== undefined && '',
      `/** ${docText(doc)} */`,
      ...(invalidated.length
        ? [
            `export const use${pascal(action.name)} = () => useAction(async (${signature}) => {`,
            `  const result = await ${call}`,
            '  if (result.ok) {',
            ...invalidated.map(entity => `    await ${entityNames(entity).collection}.utils.refetch()`),
            '  }',
            '  return result',
            '})'
          ]
        : [`export const use${pascal(action.name)} = () => useAction(async (${signature}) => ${call})`])
    ])
  }
}

/** The call of an action's route from its composable: its contract's path and method, its answer typed as the contract's response. */
const fetchCall = (context: ModuleContext, contract: ReturnType<typeof actionContractNames>, params: string[], body: string) =>
  `fromRoute<${contract.response}, ${errorTypeName(context)}>($fetch<${contract.response}>(${contractPath(contract, params)}, { method: ${contract.value}.method${body} }))`

const composableFile = (context: ModuleContext, analyzed: Analyzed) => {
  const { action, inputEntity, params } = analyzed
  const optimistic = action.client.optimistic as Optimistic | undefined
  if (!optimistic) return directComposableFile(context, analyzed)
  if (!inputEntity && params.length === 0) throw new Error(`${action.id}: an action with no input can't be optimistic (it has no row or parameter to show ahead of the server)`)
  const source = context.source(action.id)
  const composable = composableOf(action.name)
  const invalidated = action.client.invalidates.map(id => entityById(context, id))
  const collections = new Set(invalidated.map(entity => entityNames(entity).collection))
  const ids = new Set<string>()
  const types = new Set<string>()

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
  const rule = ruleOf(analyzed)
  const rules: string[] = []
  if (optimistic.kind === 'insert') {
    const create = analyzed.steps.find(step => step.kind === 'repository' && step.op === 'create')
    const set = (create?.set ?? {}) as Record<string, Value>
    // The insert shows what the server will create: the create step's rule, when it has one, applied to the input.
    const applies = rule?.kind === 'create' && rule.entity.id === entity.id
    const stamps = entity.timestamps ? ['createdAt', 'updatedAt'] : []
    const times = applies ? Number(rule.at) : nowCount(set)
    const at = times + stamps.length >= 2
    if (at || times) ids.add('now')
    if (applies) rules.push(rule.name)
    const scope = { input: (name: string) => `input.${name}`, at }
    const picked = new Set(action.input.pick ?? allFields(entity).map(field => field.name))
    const defaults = entity.fields.filter(field => picked.has(field.name) && field.default !== undefined).map(field => `${field.name}: ${tsLiteral(field.default!)}`)
    mutate.push(
      `onMutate: (${argument}) => {`,
      ...(at ? ['  const at = now()'] : []),
      `  ${collection}.insert({`,
      `    ${[...defaults, '...input'].join(', ')},`,
      `    ${[...(applies ? [`...${applyRule(rule, 'input', at ? 'at' : 'now()')}`] : setEntries(set, scope)), ...stamps.map(name => `${name}: ${at ? 'at' : 'now()'}`)].join(', ')}`,
      '  })',
      '},'
    )
  } else if (optimistic.kind === 'update' && rule && agreesWith(optimistic, rule)) {
    rules.push(rule.name)
    if (rule.at) ids.add('now')
    mutate.push(
      `onMutate: (${argument}) => {`,
      `  ${collection}.update(${compile(optimistic.key ?? null, { input: name => name, at: false })}, (draft) => {`,
      `    const change = ${applyRule(rule, 'draft', 'now()')}`,
      '    if (change) Object.assign(draft, change)',
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

  const contract = actionContractNames(context, action)
  // An optimistic action answers nothing: what it changes is shown ahead, in the collection, and refetched once the server answers.
  const doc = `Action "${action.label}": optimistic ${optimistic.kind}, confirmed by the server use-case${invalidated.length ? `; invalidates ${invalidated.map(entity => entity.name).join(', ')}` : ''}. ${RUN_DOC(context)} It answers nothing: the change is in the collection.`
  // The type it imports is the input's: an action with none (a delete, a publish) imports none; what it answers is its contract's.
  const typed = inputEntity

  const path = context.paths.composable(composable)
  return {
    path,
    source,
    content: file([
      header(source),
      'import { createOptimisticAction } from \'@tanstack/vue-db\'',
      ids.size > 0 && importLine('#core/kernel/ids', [...ids]),
      importLine('#core/kernel/result', ['ok', { name: 'ApiError', type: true }, { name: 'Result', type: true }]),
      importLine('#layers/core/app/data/results', ['Answered', 'fromRoute', 'useAction']),
      contractImport(contract),
      importLine(`#${context.name}/domain/errors`, [{ name: errorTypeName(context), type: true }]),
      typed && importLine(`#${context.name}/domain/${entityNames(typed).file}`, [...types].map(name => ({ name, type: true }))),
      rules.length > 0 && importLine(`#${context.name}/domain/${entityNames(entity).file}.rules`, rules),
      ...[...collections].sort().map((collection) => {
        const entity = context.module.entities.find(entry => entityNames(entry).collection === collection)!
        return `import { ${collection} } from '${importPath(path, context.paths.collection(entityNames(entity).pluralFile))}'`
      }),
      '',
      execute.alias,
      execute.alias !== undefined && '',
      `/** ${docText(doc)} */`,
      `export const ${composable} = () => {`,
      `  const action = createOptimisticAction<${generic}>({`,
      ...mutate.map(line => `    ${line}`),
      `    mutationFn: async (${argument}) => {`,
      `      const result = await ${fetchCall(context, contract, params.map(param => param.name), inputEntity ? ', body: input' : '')}`,
      '      // A transaction knows only thrown errors: `Answered` carries the module\'s error to `run`, and the change is rolled back.',
      '      if (!result.ok) throw new Answered(result.error)',
      ...invalidated.map(entity => `      await ${entityNames(entity).collection}.utils.refetch()`),
      '    }',
      '  })',
      '',
      `  return useAction(async (${execute.signature}): Promise<Result<undefined, ApiError<${errorTypeName(context)}>>> => {`,
      `    await ${execute.call}.when('settled')`,
      '    return ok(undefined)',
      '  })',
      '}'
    ])
  }
}

// ── Generated use-case tests ───────────────────────────────────────────

const sampleId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sampleValue = (field: Field): Value => {
  if (field.name === 'id' || field.type === 'uuid') return sampleId(1)
  if (!isBasicType(field.type)) return sampleOf(field)
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
  const path = context.paths.test(`application/${kebab(action.name)}.test.ts`)
  const named = (name: string, to: string) => {
    const from = importPath(path, to)
    return { path: from, line: `import { ${name} } from '${from}'` }
  }
  const imports: Array<{ path: string, line: string }> = [
    named(action.name, context.paths.action(kebab(action.name))),
    ...memory.map(({ entity, factory }) => named(factory, context.paths.repository(entityNames(entity).file, 'memory')))
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
      // A database entity's rows are its seed; a memory or REST one's, the memory seed (a REST twin's rows in these tests).
      const seedFile = datasourceOf(context, loaded.repository).kind === 'sqlite' ? context.paths.dbSeed : context.paths.memorySeed
      imports.push(named(`${entityNames(loaded.entity).variable}Seed`, seedFile))
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
    path,
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
