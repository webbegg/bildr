import { entityNames, moduleContext } from '../generate/context.ts'
import { camel, kebab, pascal } from '../generate/text.ts'
import type { Model } from '../model/load.ts'
import type { ApiSource } from './api.ts'
import { apiComposableName } from '../generate/names.ts'
import { resultSources, sourceNames } from '../generate/rest-source.ts'
import { API_DECLARED_NAMES, BROWSER_SHARED_FILES, composableNameProblem, composableProblem, declaredNameProblem, JS_RESERVED_WORDS, LINT_RESTRICTED_FOLDERS } from './reserved-names.ts'

/**
 * The names a module's generated server code already declares at the top of a file: the composition root's
 * exports and locals, the adapters and seeds it imports, the error factories. An action is a function of its
 * own name in the files that use these, so it can't take one (D10a). Derived from the model, not listed by hand:
 * a new entity or error brings its names.
 */
export const generatedNames = (model: Model, module: string): Map<string, string> => {
  const context = moduleContext(model, module)
  const names = new Map<string, string>()
  const add = (name: string, what: string) => {
    if (!names.has(name)) names.set(name, what)
  }
  add(context.root, `the ${module} module's composition root`)
  add(`${camel(module)}ErrorStatus`, `the ${module} module's table of error statuses`)
  for (const name of ['useDb', 'useRemote']) add(name, 'a helper the composition root calls')
  for (const entity of context.module.entities) {
    const entityName = entityNames(entity)
    add(entityName.plural, `the ${entity.name} repository inside the composition root`)
    add(`${entityName.variable}Seed`, `the sample rows of ${entity.name}`)
    add(`list${pascal(entity.plural)}`, `the list use-case of ${entity.name}`)
    for (const kind of ['drizzle', 'rest', 'memory']) add(`${kind}${entityName.port}`, `an adapter of the ${entity.name} repository`)
  }
  // A REST source's client in the composition root and its error factories (codegen-architecture R1').
  for (const source of resultSources(context)) {
    const named = sourceNames(context, source)
    add(named.client, `the client of the "${source.name}" data source`)
    for (const factory of [named.failed, named.invalidAnswer]) add(factory, `an error factory of the "${source.name}" data source`)
  }
  for (const action of context.module.actions) {
    for (const error of action.errors) add(camel(error.type), `the error "${error.type}"`)
    // Its domain rule (codegen-architecture T4a), claimed whether its steps make one or not: a step edit can't then clash.
    add(`${action.name}Change`, `the domain rule of the action "${action.name}"`)
  }
  return names
}

/** Why `name` can't be an action of `module`, or undefined when no generated code is named so. */
export const actionNameProblem = (model: Model, module: string, name: string): string | undefined => {
  const what = generatedNames(model, module).get(name)
  if (what) return `"${name}" is already the name of ${what}, which the generated code declares next to the action: pick another`
  return declaredNameProblem(name) ?? composableNameProblem(name)
}

/** Why `name` can't be a query (only its composable use<Name> is generated), or undefined. */
export const queryNameProblem = (name: string): string | undefined => composableNameProblem(name)

// ── API data sources (simple data, SD-5) ───────────────────────────────

/** The identifiers the generated files of an API source declare for the source itself (all derived from its name). */
export const apiSourceIdentifiers = (sourceName: string) => {
  const name = pascal(sourceName)
  const key = camel(sourceName)
  return {
    camel: key,
    pascal: name,
    port: `${name}Repository`,
    adapter: `http${name}Repository`,
    fake: `fake${name}Repository`,
    error: `${name}Error`,
    root: `use${name}Api`,
    status: `${key}ErrorStatus`,
    client: `${key}Client`
  }
}

/** A name the generated files of one API source take, and who takes it. `loose`: it is only a property of an object, so no file can clash with it. */
export interface ApiNameClaim {
  name: string
  owner: string
  loose?: boolean
}

type ApiNamed = Pick<ApiSource, 'name' | 'models' | 'queries' | 'actions'>

/** Every name the generated files of `source` declare from its model: the source's, each model's and each operation's. */
export const apiNameClaims = (source: ApiNamed): ApiNameClaim[] => {
  const ids = apiSourceIdentifiers(source.name)
  const claims: ApiNameClaim[] = [
    { name: ids.camel, owner: `the API "${source.name}" (its key in the use-cases' dependencies)`, loose: true },
    { name: ids.port, owner: `the repository of the API "${source.name}"` },
    { name: ids.adapter, owner: `the HTTP repository of the API "${source.name}"` },
    { name: ids.fake, owner: `the fake repository of the API "${source.name}" in its tests` },
    { name: ids.error, owner: `the errors of the API "${source.name}"` },
    { name: ids.root, owner: `the composition root of the API "${source.name}"` },
    { name: ids.status, owner: `the error statuses of the API "${source.name}"` },
    { name: ids.client, owner: `the client of the API "${source.name}"` }
  ]
  for (const model of source.models) {
    const owner = `the model ${model.name}`
    for (const [what, name] of [['type', model.name], ['zod schema', `${model.name}Schema`], ['DTO', `${model.name}Dto`], ['DTO schema', `${model.name}DtoSchema`], ['mapper to the domain', `to${model.name}`], ['mapper from the domain', `from${model.name}`]] as const) {
      claims.push({ name, owner: `the ${what} of ${owner}` })
    }
  }
  const operations = [...source.queries.map(query => ({ name: query.name, kind: 'query' })), ...source.actions.map(action => ({ name: action.name, kind: 'action' }))]
  for (const operation of operations) {
    const type = pascal(operation.name)
    const owner = `the ${operation.kind} "${operation.name}"`
    claims.push(
      { name: operation.name, owner },
      { name: `${type}InputSchema`, owner: `the input schema of ${owner}` },
      { name: `${type}Input`, owner: `the input type of ${owner}` },
      { name: `${type}Deps`, owner: `the dependencies of ${owner}` },
      { name: apiComposableName(source.name, operation.name), owner: `the composable of ${owner}` }
    )
  }
  // The HTTP repository checks a path parameter into `<param>Segment` and a text header one into `<param>Header` (once per name: two
  // operations with the same parameter share it).
  const locals = new Map<string, string>()
  for (const param of [...source.queries, ...source.actions].flatMap(operation => operation.params)) {
    if (param.in === 'path') locals.set(`${param.name}Segment`, `the path parameter "${param.name}"`)
    if (param.in === 'header' && param.type === 'text') locals.set(`${param.name}Header`, `the header parameter "${param.name}"`)
  }
  for (const [name, of] of locals) claims.push({ name, owner: `the checked value of ${of} in the HTTP repository` })
  return claims
}

const FIXED_API_NAMES: Map<string, string> = new Map(Object.entries(API_DECLARED_NAMES).flatMap(([from, names]) => names.map(name => [name, from] as const)))

/** Who takes `name` in every API source's files whatever the model says, when anyone does. */
export const apiDeclaredName = (name: string): string | undefined => FIXED_API_NAMES.get(name)

/**
 * Why the API `source` can't be generated as it is (a name its files can't take), or undefined. The `api_*` edits refuse the
 * name with this message, and the generator throws it for a hand-written file: either way nothing is generated that doesn't build.
 */
export const apiNameProblem = (source: ApiNamed & Pick<ApiSource, 'auth' | 'runtime'>): string | undefined => {
  const where = `API "${source.name}"`
  if (LINT_RESTRICTED_FOLDERS.includes(source.name)) {
    return `${where}: "${source.name}" is a folder name the generated app's lint rules refuse in an import path (${LINT_RESTRICTED_FOLDERS.join(', ')}): pick another name`
  }
  if (source.runtime === 'browser' && BROWSER_SHARED_FILES.includes(source.name)) {
    return `${where}: "${source.name}" is the name of a file every browser API source shares (layers/apis/app/data/${source.name}.ts, where its own composition would go): pick another name`
  }
  if (camel(source.name) === 'constructor') return `${where}: "${source.name}" would be the settings key \`constructor\`: pick another name`
  const secret = source.auth?.secret
  if (secret === 'constructor') return `${where}: "${secret}" can't be the name of a secret: pick another name`
  for (const [kind, items] of [['query', source.queries], ['action', source.actions]] as const) {
    for (const item of items) {
      if (JS_RESERVED_WORDS.includes(item.name)) return `${where}: "${item.name}" is a reserved word, so the ${kind} can't be a function of that name: pick another name`
      const composable = composableProblem(apiComposableName(source.name, item.name), item.name)
      if (composable) return `${where}: ${composable}`
    }
  }
  const taken = new Map<string, string>()
  for (const claim of apiNameClaims(source)) {
    const fixed = claim.loose ? undefined : apiDeclaredName(claim.name)
    const prior = fixed ? `already declared or imported by the generated files (${fixed})` : taken.has(claim.name) ? `already the name of ${taken.get(claim.name)}` : undefined
    if (prior) return `${where}: ${claim.owner} would be named ${claim.name}, which is ${prior}: pick another name`
    taken.set(claim.name, claim.owner)
  }
  // Two names with one file: `getURL` and `getUrl` are both get-url.ts.
  for (const [kind, names] of [['query or action', [...source.queries, ...source.actions].map(item => item.name)], ['model', source.models.map(model => model.name)]] as const) {
    const files = new Map<string, string>()
    for (const name of names) {
      const other = files.get(kebab(name))
      if (other) return `${where}: the ${kind}s "${other}" and "${name}" would both generate the file ${kebab(name)}.ts: pick another name`
      files.set(kebab(name), name)
    }
  }
  return undefined
}
