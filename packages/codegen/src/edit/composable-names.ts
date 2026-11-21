import { pascal } from '../generate/text.ts'

/**
 * The composables the generated code names from the model. Pure and free of the edit machinery, so the model's load check and the edits
 * say the same (`page-uses.ts`).
 */

/** The client composable a query or action named `name` generates. */
export const composableOf = (name: string): string => `use${pascal(name)}`

/** The composable a state of `module` generates (generate/client.ts): the module's name comes first, so two modules' states never meet. */
export const stateComposableOf = (module: string, name: string): string => `use${pascal(module)}${pascal(name)}`

/** The composable a query or an action of an API source generates (auto-imported by name, so unique across the app). */
export const apiComposableName = (sourceName: string, operationName: string) => `use${pascal(sourceName)}${pascal(operationName)}`
