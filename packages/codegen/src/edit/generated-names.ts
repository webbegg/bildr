import { entityNames, moduleContext } from '../generate/context.ts'
import { camel, pascal } from '../generate/text.ts'
import type { Model } from '../model/load.ts'
import { composableNameProblem, declaredNameProblem } from './reserved-names.ts'

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
  for (const action of context.module.actions) {
    for (const error of action.errors) add(camel(error.type), `the error "${error.type}"`)
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
