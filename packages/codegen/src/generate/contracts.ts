import type { ActionFile, EntityFile, RepositoryFile } from '../model/schemas.ts'
import { entityNames } from './context.ts'
import type { ModuleContext } from './context.ts'
import { importLine } from './imports.ts'
import type { ImportName } from './imports.ts'
import { docText, file, header, kebab, pascal, tsString } from './text.ts'

/**
 * The HTTP contracts of a module (codegen-architecture T4b): one file per route in `shared/contracts/`, with its method, its path (a
 * function of its parameters when it has some), the schemas of what it reads and the type of what it answers. The route validates
 * with it and declares its answer as it; the client calls its path with its method and reads its answer as it. Neither spells the
 * route on its own, so they can't drift. The schemas are the domain's: the contract says which one goes on the wire, not a copy.
 */

/** The names a contract exports and where it lives: `createPostContract` and `CreatePostResponse` in `create-post.ts`. */
export interface ContractNames {
  file: string
  value: string
  response: string
  /** Its `#<module>/contracts/…` specifier. */
  from: string
}

const contractNames = (context: ModuleContext, name: string): ContractNames => ({
  file: kebab(name),
  value: `${name}Contract`,
  response: `${pascal(name)}Response`,
  from: `#${context.name}/contracts/${kebab(name)}`
})

export const actionContractNames = (context: ModuleContext, action: ActionFile) => contractNames(context, action.name)
export const listContractNames = (context: ModuleContext, entity: EntityFile) => contractNames(context, `list${pascal(entity.plural)}`)

/** `import { type <Response>, <value> } from '#<module>/contracts/<file>'`: what a route or a client imports of its contract. */
export const contractImport = (names: ContractNames) => importLine(names.from, [{ name: names.response, type: true }, names.value])

/** A path as code: a string, or a template of the parameters (`/posts/:id` → `(id: string) => \`/posts/${id}\``). */
const pathCode = (path: string, params: string[]) => params.length
  ? `(${params.map(param => `${param}: string`).join(', ')}) => \`${path.replace(/:(\w+)/g, '${$1}')}\``
  : tsString(path)

/** The call of a contract's path in a client: the property, or the function given the parameters. */
export const contractPath = (names: ContractNames, params: string[]) => params.length ? `${names.value}.path(${params.join(', ')})` : `${names.value}.path`

const contractFile = (context: ModuleContext, options: {
  source: string
  names: ContractNames
  what: string
  /** Who calls the route: `its client`, `the posts collection`. */
  client: string
  method: string
  path: string
  params: string[]
  /** The property the route validates (body or query) and its schema. */
  reads?: { key: 'body' | 'query', schema: string }
  response: string
  imports: Map<string, ImportName[]>
}) => {
  const { names } = options
  // The response type is declared next to what it imports: an entity of that name would be two declarations of one name.
  const imported = [...options.imports.values()].flat().map(entry => entry.name)
  if (imported.includes(names.response)) throw new Error(`${options.source}: the contract's response type ${names.response} would take the name of the ${names.response} it answers: rename the action or the entity`)
  const path = context.paths.contract(names.file)
  // The core's imports come before the module's, as everywhere else.
  const lines = [...options.imports.entries()].sort(([a], [b]) => Number(b.startsWith('#core/')) - Number(a.startsWith('#core/')) || (a < b ? -1 : a > b ? 1 : 0))
  return {
    path,
    source: options.source,
    content: file([
      header(options.source),
      ...lines.map(([from, entries]) => importLine(from, entries)),
      '',
      `/** ${docText(`The HTTP contract of ${options.what}: its route and ${options.client} both read it.`)} */`,
      `export const ${names.value} = {`,
      [
        `  method: ${tsString(options.method)}`,
        `  path: ${pathCode(options.path, options.params)}`,
        ...(options.params.length ? [`  params: { ${options.params.map(param => `${param}: IdSchema`).join(', ')} }`] : []),
        ...(options.reads ? [`  ${options.reads.key}: ${options.reads.schema}`] : [])
      ].join(',\n'),
      '} as const',
      '',
      '/** What the route answers. */',
      `export type ${names.response} = ${options.response}`
    ])
  }
}

const add = (imports: Map<string, ImportName[]>, from: string, ...names: ImportName[]) => imports.set(from, [...(imports.get(from) ?? []), ...names])

/** The contract of an action's route. Its parameters are route uuids (the only ones generated yet). */
export const actionContractFile = (context: ModuleContext, analyzed: { action: ActionFile, inputEntity?: EntityFile, params: Array<{ name: string }>, output?: EntityFile }) => {
  const { action, inputEntity, params, output } = analyzed
  const imports = new Map<string, ImportName[]>()
  if (params.length) add(imports, '#core/kernel/ids', { name: 'IdSchema' })
  if (inputEntity) add(imports, `#${context.name}/domain/${entityNames(inputEntity).file}`, { name: `New${inputEntity.name}Schema` })
  if (output) add(imports, `#${context.name}/domain/${entityNames(output).file}`, { name: output.name, type: true })
  return contractFile(context, {
    source: context.source(action.id),
    names: actionContractNames(context, action),
    what: `the action "${action.label}"`,
    client: 'its client',
    method: action.http.method,
    path: `/api/${context.name}${action.http.path}`,
    params: params.map(param => param.name),
    ...(inputEntity ? { reads: { key: 'body' as const, schema: `New${inputEntity.name}Schema` } } : {}),
    // An action with no output answers nothing: `undefined`, as its use-case's Result and its client say.
    response: output?.name ?? 'undefined',
    imports
  })
}

/** The contract of an entity's list route: a page request in, one page of the entity out. */
export const listContractFile = (context: ModuleContext, entity: EntityFile, repository: RepositoryFile) => {
  const names = entityNames(entity)
  const imports = new Map<string, ImportName[]>()
  add(imports, '#core/kernel/page', { name: 'Page', type: true }, { name: 'PageRequestSchema' })
  add(imports, `#${context.name}/domain/${names.file}`, { name: names.type, type: true })
  return contractFile(context, {
    source: context.source(repository.id),
    names: listContractNames(context, entity),
    what: `the ${names.type} list`,
    client: `the ${entity.plural} collection`,
    method: 'GET',
    path: `/api/${context.name}/${kebab(entity.plural)}`,
    params: [],
    reads: { key: 'query', schema: 'PageRequestSchema' },
    response: `Page<${names.type}>`,
    imports
  })
}
