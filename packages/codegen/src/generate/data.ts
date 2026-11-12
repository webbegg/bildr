import type { Model } from '../model/load.ts'
import type { EntityFile, RepositoryFile } from '../model/schemas.ts'
import type { GeneratedFile } from '../sync/plan.ts'
import { collectionFile, queryFile, stateCollectionFile, stateComposableFile } from './client.ts'
import { datasourceOf, entityById, entityNames, moduleContext, repositoryOf } from './context.ts'
import type { ModuleContext } from './context.ts'
import { domainFile } from './entity.ts'
import { importLine } from './imports.ts'
import {
  drizzleRepositoryFile, drizzleSchemaFile, listRouteFile, listUseCaseFile, memoryRepositoryFile, portFile,
  restRepositoryFile, restRepositoryTestFile
} from './repository.ts'
import { file, header, tsLiteral } from './text.ts'

/**
 * The data layer of every module (T5): domain schemas, ports, repositories,
 * list use-cases and routes, client collections, query and state
 * composables, seeds. Pure and deterministic: same model, same files.
 */
export const generateData = (model: Model): GeneratedFile[] => {
  const files: Array<Omit<GeneratedFile, 'owner'>> = []
  for (const name of Object.keys(model.modules).sort()) files.push(...moduleData(moduleContext(model, name)))
  return files
    .map(entry => ({ ...entry, owner: 'managed' as const }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

const moduleData = (context: ModuleContext): Array<Omit<GeneratedFile, 'owner'>> => {
  const out: Array<Omit<GeneratedFile, 'owner'>> = [moduleConfigFile(context)]
  const stored: Array<{ entity: EntityFile, repository: RepositoryFile }> = []

  for (const entity of context.module.entities) {
    out.push(domainFile(context, entity))
    const repository = repositoryOf(context, entity)
    if (!repository) continue
    const kind = datasourceOf(context, repository).kind
    out.push(portFile(context, entity, repository))
    if (kind === 'sqlite') {
      stored.push({ entity, repository })
      out.push(drizzleRepositoryFile(context, entity, repository), memoryRepositoryFile(context, entity, repository))
    } else {
      out.push(restRepositoryFile(context, entity, repository), restRepositoryTestFile(context, entity, repository))
    }
    if (repository.expose?.list && repository.operations.includes('list')) {
      out.push(listUseCaseFile(context, entity, repository), listRouteFile(context, entity, repository), collectionFile(context, entity, repository))
    }
  }
  if (stored.length) out.push(drizzleSchemaFile(context, stored))
  for (const query of context.module.queries) out.push(queryFile(context, query))
  for (const state of context.module.state) out.push(stateCollectionFile(context, state), stateComposableFile(context, state))
  out.push(...seedFiles(context, stored))
  return out
}

const moduleConfigFile = (context: ModuleContext) => {
  const source = `.bildr/modules/${context.name}/module.json`
  return {
    path: `layers/${context.name}/nuxt.config.ts`,
    source,
    content: file([
      header(source),
      'import { fileURLToPath } from \'node:url\'',
      '',
      'const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))',
      '',
      'export default defineNuxtConfig({',
      `  $meta: { name: '${context.name}' },`,
      '  alias: {',
      `    '#${context.name}/domain': here('./shared/domain')`,
      '  },',
      `  // Query, action and state composables live in app/composables/${context.name}/ and are auto-imported.`,
      `  imports: { dirs: [here('./app/composables/${context.name}')] }`,
      '})'
    ])
  }
}

/** Seed data from the model's fixtures, plus a `<module>:seed` Nitro task (database entities only). */
const seedFiles = (context: ModuleContext, stored: Array<{ entity: EntityFile }>) => {
  const storedIds = new Set(stored.map(({ entity }) => entity.id))
  const seeds = context.module.fixtures
    .filter(fixtures => storedIds.has(fixtures.entity))
    .map(fixtures => ({ entity: entityById(context, fixtures.entity), rows: fixtures.rows }))
  if (!seeds.length) return []
  const source = `.bildr/modules/${context.name}/fixtures`
  const seedName = (entity: EntityFile) => `${entityNames(entity).variable}Seed`
  return [
    {
      path: `layers/${context.name}/server/infrastructure/db/seed.ts`,
      source,
      content: file([
        header(source),
        ...seeds.map(({ entity }) => `import type { ${entity.name} } from '#${context.name}/domain/${entityNames(entity).file}'`),
        ...seeds.flatMap(({ entity, rows }) => ['', `export const ${seedName(entity)}: ${entity.name}[] = ${tsLiteral(rows)}`])
      ])
    },
    {
      path: `layers/${context.name}/server/tasks/${context.name}/seed.ts`,
      source,
      content: file([
        header(source),
        'import { defineTask } from \'nitropack/runtime\'',
        importLine('../../infrastructure/db/schema', seeds.map(({ entity }) => entity.plural)),
        importLine('../../infrastructure/db/seed', seeds.map(({ entity }) => seedName(entity))),
        '',
        `/** \`nuxt task run ${context.name}:seed\`: insert the model fixtures, skipping rows that already exist. */`,
        'export default defineTask({',
        `  meta: { name: '${context.name}:seed', description: 'Seed the ${context.name} module from its model fixtures' },`,
        '  async run() {',
        ...seeds.map(({ entity }) => `    await useDb().insert(${entity.plural}).values(${seedName(entity)}).onConflictDoNothing()`),
        `    return { result: { ${seeds.map(({ entity }) => `${entity.plural}: ${seedName(entity)}.length`).join(', ')} } }`,
        '  }',
        '})'
      ])
    }
  ]
}
