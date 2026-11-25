/**
 * Where every generated file goes: the one place that decides the layout of the generated project.
 * Paths are relative to the project root and carry their extension. Emitters name an artifact here
 * and compute their imports with `importPath`, so moving an artifact is a change to this file.
 */

const CORE = 'layers/core'
const APIS = 'layers/apis'

/** The core layer: kernel, shell, theme and the database client every module shares. */
export const corePaths = {
  root: CORE,
  /** The kernel the `#core` alias points at. */
  shared: `${CORE}/shared`,
  nuxtConfig: `${CORE}/nuxt.config.ts`,
  appConfig: `${CORE}/app/app.config.ts`,
  themeCss: `${CORE}/app/assets/css/theme.css`,
  layout: (name: string) => `${CORE}/app/layouts/${name}.vue`,
  dbClient: `${CORE}/server/utils/db.ts`,
  migratePlugin: `${CORE}/server/plugins/migrate.ts`
}

export type RepositoryAdapter = 'drizzle' | 'memory' | 'rest'

/** A module's layer (`layers/<module>/`): its domain, use-cases, adapters, HTTP routes and UI. */
export const modulePaths = (module: string) => {
  const root = `layers/${module}`
  return {
    root,
    nuxtConfig: `${root}/nuxt.config.ts`,
    // shared/: the domain, imported by the server and the app
    /** The folder the `#<module>/domain` alias points at. */
    domain: `${root}/shared/domain`,
    entity: (file: string) => `${root}/shared/domain/${file}.ts`,
    errors: `${root}/shared/domain/errors.ts`,
    // server/application: ports and use-cases
    port: (file: string) => `${root}/server/application/ports/${file}.ts`,
    action: (file: string) => `${root}/server/application/actions/${file}.ts`,
    query: (file: string) => `${root}/server/application/queries/${file}.ts`,
    // server/infrastructure: the adapters
    dbSchema: `${root}/server/infrastructure/db/schema.ts`,
    dbSeed: `${root}/server/infrastructure/db/seed.ts`,
    memorySeed: `${root}/server/infrastructure/memory/seed.ts`,
    repository: (file: string, adapter: RepositoryAdapter) => `${root}/server/infrastructure/repositories/${file}.${adapter}.ts`,
    // server/: wiring and the HTTP edge
    compositionRoot: `${root}/server/utils/${module}.ts`,
    seedTask: `${root}/server/tasks/${module}/seed.ts`,
    /** A route file under `/api/<module>/`, e.g. `posts/index.get.ts`. */
    apiRoute: (route: string) => `${root}/server/api/${module}/${route}`,
    // app/: the UI and its client data
    collection: (file: string) => `${root}/app/data/${file}.collection.ts`,
    composable: (name: string) => `${root}/app/composables/${module}/${name}.ts`,
    component: (name: string) => `${root}/app/components/${module}/${name}.vue`,
    /** A page file under `app/pages/`, e.g. `posts/[slug].vue`. */
    page: (file: string) => `${root}/app/pages/${file}`,
    /** A test file under `test/`, e.g. `application/create-post.test.ts`. */
    test: (file: string) => `${root}/test/${file}`
  }
}

export type ModulePaths = ReturnType<typeof modulePaths>

/** The `apis` layer: what every API data source shares, then one folder per source. */
export const apisPaths = {
  root: APIS,
  nuxtConfig: `${APIS}/nuxt.config.ts`,
  fetchClient: `${APIS}/server/lib/fetch-client.ts`,
  browserClient: `${APIS}/app/data/browser-client.ts`,
  apiQuery: `${APIS}/app/data/api-query.ts`,
  composable: (name: string) => `${APIS}/app/composables/apis/${name}.ts`,
  test: (file: string) => `${APIS}/test/${file}`,
  /** Every test of the API data sources. */
  testGlob: `${APIS}/test/**/*.test.ts`
}

/** One API data source in the `apis` layer (`dir` is the source's folder name). */
export const apiPaths = (dir: string) => {
  const domain = `${APIS}/shared/domain/${dir}`
  const data = `${APIS}/shared/data/${dir}`
  return {
    entity: (file: string) => `${domain}/entities/${file}.ts`,
    errors: `${domain}/errors.ts`,
    port: (file: string) => `${domain}/repositories/${file}.ts`,
    useCase: (file: string) => `${domain}/use-cases/${file}.ts`,
    dto: (file: string) => `${data}/models/${file}.dto.ts`,
    dtoSchema: (file: string) => `${data}/validations/${file}.schema.ts`,
    mapper: (file: string) => `${data}/mappers/${file}.mapper.ts`,
    client: `${data}/client.ts`,
    adapter: (file: string) => `${data}/repositories/${file}.ts`,
    /** The server composition root of a source that runs on the server. */
    compositionRoot: `${APIS}/server/utils/${dir}.ts`,
    /** The composition root of a source that runs in the browser. */
    browserRoot: `${APIS}/app/data/${dir}.ts`,
    apiRoute: (route: string) => `${APIS}/server/api/apis/${dir}/${route}`,
    test: (file: string) => `${APIS}/test/${dir}/${file}`
  }
}

/** The specifier `from` imports `to` with: relative, `./` for a sibling, the `.ts` extension dropped. */
export const importPath = (from: string, to: string): string => {
  const source = from.split('/').slice(0, -1)
  const target = to.replace(/\.ts$/, '').split('/')
  let shared = 0
  while (shared < source.length && shared < target.length - 1 && source[shared] === target[shared]) shared++
  const up = source.length - shared
  const down = target.slice(shared).join('/')
  return up === 0 ? `./${down}` : `${'../'.repeat(up)}${down}`
}
