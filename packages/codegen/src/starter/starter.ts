import { DEFAULT_THEME } from '../design/theme.ts'
import { generate, SCAFFOLD_ROOT_FILES } from '../generate/index.ts'
import { loadModel } from '../model/load.ts'
import type { Model } from '../model/load.ts'
import { ModuleNameSchema, RESERVED_MODULE_NAMES } from '../model/schemas.ts'
import { serializeModel, stringifyModelFile } from '../model/serialize.ts'
import type { GeneratedFile } from '../sync/plan.ts'
import { STARTER_ROOT_FILES } from './core-files.ts'
import { GENERATOR_VERSION } from './version.ts'

export { GENERATOR_VERSION, generatorHold } from './version.ts'

/**
 * The starter kit (decision D9): everything a new bildr project needs, as an
 * initial `.bildr/` model plus the files of the first sync. The managed files
 * are exactly what `generate` makes of that model, so the first sync after
 * creation changes nothing; the starter adds only the scaffold-once files.
 */

export const STARTER_KIT_VERSION = '1'

export interface StarterKitOptions {
  /** Project name, shown in the app and the README. */
  name: string
  /** First feature module (kebab-case). Default `main`. */
  module?: string
  /** Dependency spec for `@bildr/nuxt` (a version, or `link:<path>` while it is unpublished). Default `^0.1.0`. */
  bildrNuxt?: string
  /**
   * The app database (V7, E2). `sqlite` (default): a `main` sqlite data source, Drizzle and
   * libSQL. `none`: an API-only project, no database code or dependencies; data comes from
   * REST data sources. Adding a sqlite data source later turns the database on.
   */
  database?: StarterDatabase
}

export const STARTER_DATABASES = ['sqlite', 'none'] as const
export type StarterDatabase = typeof STARTER_DATABASES[number]

export const BILDR_NUXT_VERSION = '^0.1.0'

export interface StarterKit {
  /** `.bildr/…` path → text, in canonical form. The manifest is not included: the first sync writes it. */
  model: Record<string, string>
  files: GeneratedFile[]
}

const packageName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bildr-app'
const pascal = (name: string) => name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')

export const starterKit = ({ name, module = 'main', bildrNuxt = BILDR_NUXT_VERSION, database = 'sqlite' }: StarterKitOptions): StarterKit => {
  const title = name.trim()
  if (!title) throw new Error('Give the project a name')
  if (!ModuleNameSchema.safeParse(module).success) throw new Error(`Module name "${module}": use lowercase letters, digits and dashes (kebab-case)`)
  if ((RESERVED_MODULE_NAMES as readonly string[]).includes(module)) throw new Error(`Module name "${module}" is reserved (Nuxt aliases and the core layer use it)`)
  if (!(STARTER_DATABASES as readonly string[]).includes(database)) throw new Error(`Database "${String(database)}": use ${STARTER_DATABASES.join(' or ')}`)

  const model = initialModel(title, module, database)
  const files: GeneratedFile[] = [...generate(model.loaded), ...scaffoldFiles(title, module, bildrNuxt, database)]
  return { model: model.files, files: files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) }
}

// ── The initial .bildr/ model ──────────────────────────────────────────

const initialModel = (title: string, module: string, database: StarterDatabase): { files: Record<string, string>, loaded: Model } => {
  const raw: Record<string, unknown> = {
    '.bildr/bildr.json': { schemaVersion: 1, generatorVersion: GENERATOR_VERSION, starterKit: STARTER_KIT_VERSION, name: title, defaultModule: module, modules: [module] },
    '.bildr/theme.json': DEFAULT_THEME,
    ...(database === 'sqlite' ? { '.bildr/datasources/main.json': { id: 'ds_main', name: 'main', kind: 'sqlite', env: { url: 'NUXT_DB_URL' }, defaults: { url: 'file:.data/app.db' } } } : {}),
    '.bildr/layouts/main.json': {
      id: 'lay_main',
      name: 'main',
      slots: [{ id: 'children', name: 'children', nodeId: 'n_main' }, { id: 'footer', name: 'footer', nodeId: 'n_footer' }],
      root: {
        id: 'n_root', type: 'Container', style: { display: 'flex', direction: 'col', minH: 'screen' },
        children: [
          { id: 'n_header', type: 'Container', props: { tag: 'header' }, style: { borderB: '1', borderColor: 'default' }, children: [
            { id: 'n_nav', type: 'Row', props: { tag: 'nav' }, style: { maxW: '4xl', w: 'full', mx: 'auto', items: 'center', p: '4' }, children: [
              { id: 'n_brand', type: 'Link', props: { to: { page: 'pg_index' }, text: { $bind: 'site.name' } }, style: { text: 'lg', font: 'semibold' } }
            ] }
          ] },
          { id: 'n_main', type: 'Container', props: { tag: 'main' }, style: { maxW: '4xl', mx: 'auto', w: 'full', p: '4' }, children: [] },
          { id: 'n_footer', type: 'Container', props: { tag: 'footer' }, style: { borderT: '1', borderColor: 'default', mt: 'auto', p: '4', align: 'center', text: 'sm', color: 'muted' }, children: [
            { id: 'n_footer_text', type: 'Text', props: { text: { $bind: 'site.name' } } }
          ] }
        ]
      }
    },
    [`.bildr/modules/${module}/module.json`]: { id: `mod_${module.replaceAll('-', '_')}`, name: module, label: pascal(module), dependsOn: [] },
    [`.bildr/modules/${module}/pages/index.json`]: {
      id: 'pg_index', name: 'index', path: '/', layout: 'lay_main', seo: { title: title },
      root: { id: 'n_page', type: 'Page', props: { tag: 'section' }, style: { display: 'flex', direction: 'col', gap: '4' }, children: [
        { id: 'n_h1', type: 'Heading', props: { level: 1, text: `Welcome to ${title}` }, style: { text: '3xl', font: 'semibold' } },
        { id: 'n_intro', type: 'Text', props: { text: 'Open the bildr editor to model your data and design your pages.' }, style: { color: 'muted' } }
      ] }
    }
  }
  const files = Object.fromEntries(Object.entries(raw).map(([path, value]) => [path, stringifyModelFile(value)]))
  const result = loadModel(files)
  if (!result.ok) throw new Error(`Starter model is invalid: ${result.problems.map(problem => `${problem.path}: ${problem.message}`).join('; ')}`)
  return { files: serializeModel(result.model), loaded: result.model }
}

// ── Scaffold-once files (the user's after creation) ──────────────────────────

/**
 * What a project needs for its app database (D3): add these to package.json when a sqlite
 * data source is added to a project created without one. package.json is the user's
 * (scaffold-once), so bildr never edits it after creation.
 */
export const DATABASE_DEPENDENCIES = {
  dependencies: { '@libsql/client': '^0.18.0', 'drizzle-orm': '^0.45.4' },
  devDependencies: { 'drizzle-kit': '^0.31.11' },
  scripts: { 'db:generate': 'drizzle-kit generate' }
} as const

const sorted = (entries: Record<string, string>) => Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))

const scaffoldFiles = (title: string, module: string, bildrNuxt: string, database: StarterDatabase): GeneratedFile[] => {
  const db = database === 'sqlite'
  return [
    ...Object.entries(STARTER_ROOT_FILES).filter(([path]) => SCAFFOLD_ROOT_FILES.has(path)).map(([path, content]) => ({ path, content, owner: 'scaffold' as const })),
    { path: 'package.json', owner: 'scaffold', content: `${JSON.stringify({
      name: packageName(title),
      private: true,
      type: 'module',
      scripts: {
        dev: 'nuxt dev',
        build: 'nuxt build',
        preview: 'nuxt preview',
        postinstall: 'nuxt prepare',
        typecheck: 'nuxt typecheck',
        lint: 'eslint .',
        test: 'vitest run',
        ...(db ? DATABASE_DEPENDENCIES.scripts : {})
      },
      dependencies: sorted({
        '@nuxt/ui': '^4.12.0',
        '@tanstack/query-core': '^5.100.0',
        '@tanstack/query-db-collection': '^1.5.2',
        '@tanstack/vue-db': '1.0.0-rc.1.5',
        'nuxt': '^4.6.3',
        'zod': '^4.6.7',
        ...(db ? DATABASE_DEPENDENCIES.dependencies : {})
      }),
      devDependencies: sorted({
        '@bildr/nuxt': bildrNuxt,
        '@iconify-json/lucide': '^1.2.147',
        '@nuxt/eslint': '^1.17.0',
        '@nuxt/test-utils': '^4.4.0',
        'eslint': '^10.13.0',
        'tailwindcss': '^4.3.3',
        'typescript': '^6.0.3',
        'vitest': '^5.1.0',
        'vue-tsc': '^3.3.13',
        ...(db ? DATABASE_DEPENDENCIES.devDependencies : {})
      }),
      packageManager: 'pnpm@12.15.0'
    }, null, 2)}\n` },
    {
      path: '.env.example',
      owner: 'scaffold',
      content: db
        ? '# Database (libSQL: a local file by default, or a remote libsql:// URL)\nNUXT_DB_URL=file:.data/app.db\n'
        : '# This project has no database: its data comes from REST data sources.\n# Each one reads its settings from NUXT_DATASOURCES_<NAME>_* env vars (base URL, API key).\n'
    },
    { path: 'README.md', owner: 'scaffold', content: readme(title, module, db) }
  ]
}

const noDatabaseNote = [
  'Copy `.env.example` to `.env` to point the REST data sources at their APIs.',
  '',
  'This project has no database (created with `--database none`). To add one, add a sqlite data source in the editor: bildr generates the database layer. Then add',
  `${Object.keys({ ...DATABASE_DEPENDENCIES.dependencies, ...DATABASE_DEPENDENCIES.devDependencies }).map(name => `\`${name}\``).join(', ')} and the \`db:generate\` script to \`package.json\`, and run \`pnpm install\`.`
].join('\n')

const readme = (title: string, module: string, db: boolean) => `# ${title}

A Nuxt 4 app built with bildr. It's a normal Nuxt project: it runs, builds and deploys without the bildr editor.

## Run it

\`\`\`sh
pnpm install
pnpm dev            # http://localhost:3000${db ? ' (migrations apply on start)' : ''}
pnpm build && node .output/server/index.mjs
\`\`\`

${db ? 'Copy `.env.example` to `.env` to change the database URL.' : noDatabaseNote}

## Layout

| Path | What it is | Who owns it |
|---|---|---|
| \`.bildr/\` | The model the editor saves: modules, entities, repositories, queries, actions, pages, components, layouts, theme. \`manifest.json\` lists the files bildr generated. | bildr editor |
| \`layers/core/\` | Shared kernel (\`Result\`, \`Page\`, ids), ${db ? 'database client, migrations on boot, ' : ''}HTTP error mapping, query client, theme, app shell, layouts. | generated |
| \`layers/${module}/\` | Your first feature module. Every module is one Nuxt layer. | generated |
| \`app/\`, \`server/\` | Your code. Files here override the same path in any layer. | you |
${db ? '| `server/database/migrations/` | Drizzle migrations. Written once, never regenerated. | you |\n' : ''}| \`nuxt.config.ts\`, \`package.json\` | Project config. Written once by the starter kit. | you |

## Inside a module layer

Dependencies point inward only. ESLint enforces it (\`pnpm lint\`).

\`\`\`
shared/domain/            entities (zod schemas + types), domain errors and rules (<entity>.rules.ts: what an action
                          changes, shared by its use-case and its optimistic update): no Vue, no Nitro
shared/domain/sources/    what a call to a REST data source can fail with: the module's errors include them
shared/contracts/         one HTTP contract per route (method, path, what it reads, what it answers): the
                          route and its client (composable, collection) both read it, so they can't drift
server/application/       use-cases and repository ports: plain functions, no framework
server/infrastructure/    adapters: Drizzle tables and repositories, REST repositories, seeds
server/api/               thin HTTP handlers: validate, call a use-case, map errors
server/utils/<module>.ts  composition root: wires use-cases to adapters
app/data/                 TanStack DB collections (client copies of entities, UI state)
app/composables/<module>/ queries (live queries) and actions (optimistic, server-confirmed)
app/components, app/pages the UI; components only use composables
test/                     use-case, adapter and API tests
\`\`\`

## Inside the apis layer

An API data source gets \`layers/apis/\`, in the same rings. They all live under \`shared/\`, because a source can run on the server or in the page:

\`\`\`
shared/domain/<source>/          entities (zod schemas + types) and the source's errors
shared/application/<source>/     the repository port (ports/), one use-case per query (queries/) and action (actions/)
shared/infrastructure/<source>/  what the API sends (models/, validations/), mappers, the HTTP repository
shared/contracts/<source>/       one HTTP contract per route of a source that runs on the server: its route and composable read it
server/utils/<source>.ts         composition root of a source that runs on the server, with its routes in server/api/apis/
app/data/<source>.ts             composition of a source that runs in the page
app/composables/apis/            one composable per query and action
\`\`\`

## Changing generated code

- **Prefer overriding.** Put a file at the same path under the root \`app/\` or \`server/\`. Nuxt uses yours, and bildr keeps updating its own copy.
- **Editing a generated file is allowed.** bildr notices the edit, marks the file *detached* in \`.bildr/manifest.json\`, and stops overwriting it. The editor shows it as drift. You can reattach it later, which replaces your edits with the generated version.
- **Your own code** (routes, server utils, composables, components) goes in the root \`app/\` and \`server/\`. bildr never regenerates them.

## Upgrading bildr

\`.bildr/bildr.json\` records the generator that wrote this app (\`generatorVersion\`). A bildr whose generator writes different code keeps the app as it is and says so in Health. Read its MIGRATING.md, then run \`project_update { upgradeGenerator: true }\` to regenerate.

## Scripts

\`dev\`, \`build\`, \`preview\`, \`typecheck\`, \`lint\`, \`test\` (unit and API tests)${db ? ', `db:generate` (new migration after entity changes)' : ''}.
`
