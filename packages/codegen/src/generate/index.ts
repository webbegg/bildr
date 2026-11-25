import { schemaIds } from '../migrate/index.ts'
import type { Model } from '../model/load.ts'
import { STARTER_CORE_FILES, STARTER_ROOT_FILES } from '../starter/core-files.ts'
import type { GeneratedFile } from '../sync/plan.ts'
import { generateActions } from './actions.ts'
import { generateApis } from './api.ts'
import { hasDatabase } from './context.ts'
import { generateData } from './data.ts'
import { corePaths } from './paths.ts'
import { generateProject } from './project.ts'
import { generateUi } from './ui.ts'

// Generators per layer. Only the complete `generate` may drive a sync: syncing a partial
// one would treat every file it doesn't emit as "no longer generated" (see planSync).
export { generateActions } from './actions.ts'
export { generateApis } from './api.ts'
export { generateData } from './data.ts'
export { generateProject } from './project.ts'
export { generateUi } from './ui.ts'
export { hasDatabase } from './context.ts'

/** Static files of the database layer: generated only while the model has a sqlite data source (V7). */
export const DATABASE_FILES = new Set([corePaths.dbClient, corePaths.migratePlugin, 'drizzle.config.ts'])

/** Root files the starter kit writes once and then leaves to the user; never part of a sync. */
export const SCAFFOLD_ROOT_FILES = new Set(['nuxt.config.ts', 'tsconfig.json', '.gitignore', 'pnpm-workspace.yaml', 'app/README.md', 'server/README.md'])

const byPath = (a: GeneratedFile, b: GeneratedFile) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0

/**
 * Names the model allows but the app can't have: two entities of a module with
 * one plural (both name the same exports and files), or two stored entities on
 * one table (one would silently take over the other's rows).
 */
const checkCollisions = (model: Model) => {
  // `layers/apis/` is the one layer of every API data source: a module of that name would share its folder.
  if ('apis' in model.modules) throw new Error('Module name "apis" is reserved: the layer of the API data sources uses it')
  const nameOf = new Map<string, string>()
  for (const [module, { entities }] of Object.entries(model.modules)) {
    const byPlural = new Map<string, string>()
    for (const entity of entities) {
      nameOf.set(entity.id, entity.name)
      const other = byPlural.get(entity.plural)
      if (other) throw new Error(`${[other, entity.name].sort().join(' and ')} both use the plural ${entity.plural} in module ${module}: plurals name code and tables, so they must differ`)
      byPlural.set(entity.plural, entity.name)
    }
  }
  const byTable = new Map<string, string>()
  for (const [id, { table }] of Object.entries(schemaIds(model).tables)) {
    const other = byTable.get(table)
    if (other) throw new Error(`${[nameOf.get(other)!, nameOf.get(id)!].sort().join(' and ')} would share the table ${table}: give one of them another table or plural`)
    byTable.set(table, id)
  }
}

/**
 * Every managed file of a project (T7d): the static core layer and root
 * configs, plus everything the model generates. The input of a sync.
 */
export const generate = (model: Model): GeneratedFile[] => {
  checkCollisions(model)
  return generateAll(model)
}

const generateAll = (model: Model): GeneratedFile[] => {
  const database = hasDatabase(model)
  const kept = (path: string) => database || !DATABASE_FILES.has(path)
  return [
    ...Object.entries(STARTER_CORE_FILES).filter(([path]) => kept(path)).map(([path, content]) => ({ path, content, owner: 'managed' as const })),
    ...Object.entries(STARTER_ROOT_FILES).filter(([path]) => !SCAFFOLD_ROOT_FILES.has(path) && kept(path)).map(([path, content]) => ({ path, content, owner: 'managed' as const })),
    ...generateProject(model),
    ...generateData(model),
    ...generateActions(model),
    ...generateApis(model),
    ...generateUi(model)
  ].sort(byPath)
}
