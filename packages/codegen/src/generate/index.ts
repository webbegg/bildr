import type { Model } from '../model/load.ts'
import { STARTER_CORE_FILES, STARTER_ROOT_FILES } from '../starter/core-files.ts'
import type { GeneratedFile } from '../sync/plan.ts'
import { generateActions } from './actions.ts'
import { generateData } from './data.ts'
import { generateProject } from './project.ts'
import { generateUi } from './ui.ts'

// Generators per layer. Only the complete `generate` may drive a sync: syncing a partial
// one would treat every file it doesn't emit as "no longer generated" (see planSync).
export { generateActions } from './actions.ts'
export { generateData } from './data.ts'
export { generateProject } from './project.ts'
export { generateUi } from './ui.ts'

/** Root files the starter kit writes once and then leaves to the user; never part of a sync. */
export const SCAFFOLD_ROOT_FILES = new Set(['nuxt.config.ts', 'tsconfig.json', '.gitignore', 'pnpm-workspace.yaml', 'app/README.md', 'server/README.md'])

const byPath = (a: GeneratedFile, b: GeneratedFile) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0

/**
 * Every managed file of a project (T7d): the static core layer and root
 * configs, plus everything the model generates. The input of a sync.
 */
export const generate = (model: Model): GeneratedFile[] => [
  ...Object.entries(STARTER_CORE_FILES).map(([path, content]) => ({ path, content, owner: 'managed' as const })),
  ...Object.entries(STARTER_ROOT_FILES).filter(([path]) => !SCAFFOLD_ROOT_FILES.has(path)).map(([path, content]) => ({ path, content, owner: 'managed' as const })),
  ...generateProject(model),
  ...generateData(model),
  ...generateActions(model),
  ...generateUi(model)
].sort(byPath)
