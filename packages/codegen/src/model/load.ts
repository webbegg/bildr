import type { z } from 'zod'
import {
  ActionFileSchema, ComponentFileSchema, DataSourceFileSchema, EntityFileSchema, EXPRESSION_KEYS, FixturesFileSchema,
  LayoutFileSchema, ManifestFileSchema, ModuleFileSchema, PageFileSchema, ProjectFileSchema, QueryFileSchema,
  RepositoryFileSchema, StateFileSchema, ThemeFileSchema
} from './schemas.ts'
import type {
  ActionFile, ComponentFile, DataSourceFile, EntityFile, FixturesFile, LayoutFile, ManifestFile, ModelNode, ModuleFile,
  PageFile, ProjectFile, QueryFile, RepositoryFile, StateFile, ThemeFile, Value
} from './schemas.ts'

/** The model version this bildr reads and writes. Older files are migrated on load, newer ones refused. */
export const CURRENT_SCHEMA_VERSION = 1

export const PROJECT_FILE = '.bildr/bildr.json'
export const THEME_FILE = '.bildr/theme.json'
export const MANIFEST_FILE = '.bildr/manifest.json'

export interface ModuleModel {
  module: ModuleFile
  entities: EntityFile[]
  repositories: RepositoryFile[]
  queries: QueryFile[]
  actions: ActionFile[]
  state: StateFile[]
  components: ComponentFile[]
  pages: PageFile[]
  fixtures: FixturesFile[]
}

export interface Model {
  project: ProjectFile
  theme?: ThemeFile
  manifest?: ManifestFile
  datasources: DataSourceFile[]
  layouts: LayoutFile[]
  modules: Record<string, ModuleModel>
  /** Where each artifact lives, keyed by artifact id (fixtures by `fixtures:<entity id>`). Kept so saving rewrites the same files. */
  paths: Record<string, string>
}

export interface ModelProblem {
  /** The `.bildr/…` file. */
  path: string
  message: string
}

export type LoadResult = { ok: true, model: Model } | { ok: false, problems: ModelProblem[] }

/** Rewrites the raw files (path → parsed JSON) of one schema version into the next one, including `schemaVersion`. */
export type ModelMigration = (files: Record<string, unknown>) => Record<string, unknown>

/** Migrations keyed by the version they migrate from. Empty while only version 1 exists. */
export const MODEL_MIGRATIONS: Record<number, ModelMigration> = {}

export interface LoadOptions {
  /** The version to load into (tests only; defaults to CURRENT_SCHEMA_VERSION). */
  current?: number
  migrations?: Record<number, ModelMigration>
}

const MODULE_FOLDERS = {
  entities: 'entity',
  repositories: 'repository',
  queries: 'query',
  actions: 'action',
  state: 'state',
  components: 'component',
  pages: 'page',
  fixtures: 'fixtures'
} as const

type ModuleFolder = keyof typeof MODULE_FOLDERS
export type FileKind = 'project' | 'theme' | 'manifest' | 'datasource' | 'layout' | 'module' | (typeof MODULE_FOLDERS)[ModuleFolder]

const SCHEMAS: Record<FileKind, z.ZodType> = {
  project: ProjectFileSchema,
  theme: ThemeFileSchema,
  manifest: ManifestFileSchema,
  datasource: DataSourceFileSchema,
  layout: LayoutFileSchema,
  module: ModuleFileSchema,
  entity: EntityFileSchema,
  repository: RepositoryFileSchema,
  query: QueryFileSchema,
  action: ActionFileSchema,
  state: StateFileSchema,
  component: ComponentFileSchema,
  page: PageFileSchema,
  fixtures: FixturesFileSchema
}

/** The kind of a `.bildr/` file from its path, or undefined for files that aren't part of the model (like `.cache/`). */
export const fileKind = (path: string): FileKind | undefined => {
  if (path === PROJECT_FILE) return 'project'
  if (path === THEME_FILE) return 'theme'
  if (path === MANIFEST_FILE) return 'manifest'
  if (/^\.bildr\/datasources\/[^/]+\.json$/.test(path)) return 'datasource'
  if (/^\.bildr\/layouts\/[^/]+\.json$/.test(path)) return 'layout'
  if (/^\.bildr\/modules\/[^/]+\/module\.json$/.test(path)) return 'module'
  const match = /^\.bildr\/modules\/[^/]+\/([^/]+)\/[^/]+\.json$/.exec(path)
  return match && match[1]! in MODULE_FOLDERS ? MODULE_FOLDERS[match[1] as ModuleFolder] : undefined
}

const isModelPath = (path: string) => path.startsWith('.bildr/') && !path.startsWith('.bildr/.cache/')
const moduleOf = (path: string) => /^\.bildr\/modules\/([^/]+)\//.exec(path)?.[1]
const folderOf = (path: string) => /^\.bildr\/modules\/[^/]+\/([^/]+)\//.exec(path)?.[1] as ModuleFolder | undefined

const issueProblems = (path: string, error: z.ZodError): ModelProblem[] =>
  error.issues.map(issue => ({ path, message: issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message }))

/**
 * Loads a project's `.bildr/` files (path → text) into one validated model.
 * Pure: the caller reads the files. All file problems are reported together;
 * cross-file references are checked only once every file parses.
 */
export const loadModel = (files: Record<string, string>, options: LoadOptions = {}): LoadResult => {
  const { current: supported = CURRENT_SCHEMA_VERSION, migrations = MODEL_MIGRATIONS } = options
  const paths = Object.keys(files).filter(isModelPath).sort()
  const problems: ModelProblem[] = []
  const raw: Record<string, unknown> = {}

  if (!(PROJECT_FILE in files)) problems.push({ path: PROJECT_FILE, message: 'Missing project file' })
  for (const path of paths) {
    if (!fileKind(path)) {
      problems.push({ path, message: 'Unknown model file' })
      continue
    }
    try {
      raw[path] = JSON.parse(files[path]!)
    } catch (error) {
      problems.push({ path, message: `Invalid JSON: ${(error as Error).message}` })
    }
  }
  if (problems.length) return { ok: false, problems }

  const version = (raw[PROJECT_FILE] as { schemaVersion?: unknown }).schemaVersion
  if (typeof version === 'number' && version > supported) {
    return { ok: false, problems: [{ path: PROJECT_FILE, message: `schemaVersion ${version} is newer than this bildr supports (${supported}). Update bildr.` }] }
  }
  let current = raw
  if (typeof version === 'number') {
    for (let from = version; from < supported; from++) {
      const migrate = migrations[from]
      if (!migrate) return { ok: false, problems: [{ path: PROJECT_FILE, message: `No migration from schemaVersion ${from} to ${from + 1}` }] }
      current = migrate(current)
    }
  }

  const parsed: Record<string, unknown> = {}
  for (const path of Object.keys(current).sort()) {
    const result = SCHEMAS[fileKind(path)!].safeParse(current[path])
    if (result.success) parsed[path] = result.data
    else problems.push(...issueProblems(path, result.error))
  }
  if (problems.length) return { ok: false, problems }

  const { model, entries } = assemble(parsed)
  problems.push(...crossCheck(model, entries))
  return problems.length ? { ok: false, problems } : { ok: true, model }
}

const emptyModule = (module: ModuleFile): ModuleModel => ({
  module, entities: [], repositories: [], queries: [], actions: [], state: [], components: [], pages: [], fixtures: []
})

/** One parsed artifact file, in path order. */
interface Entry {
  path: string
  kind: FileKind
  module?: string
  value: { id?: string, name?: string, entity?: string }
}

const assemble = (parsed: Record<string, unknown>): { model: Model, entries: Entry[] } => {
  const model: Model = { project: parsed[PROJECT_FILE] as ProjectFile, datasources: [], layouts: [], modules: {}, paths: {} }
  const entries: Entry[] = []
  // The first file in path order owns an id; later ones are reported as duplicates.
  const locate = (key: string, path: string) => {
    model.paths[key] ??= path
  }
  if (parsed[THEME_FILE]) model.theme = parsed[THEME_FILE] as ThemeFile
  if (parsed[MANIFEST_FILE]) model.manifest = parsed[MANIFEST_FILE] as ManifestFile
  const paths = Object.keys(parsed).sort()
  for (const path of paths) {
    const kind = fileKind(path)!
    const value = parsed[path]
    if (kind === 'datasource') model.datasources.push(value as DataSourceFile)
    else if (kind === 'layout') model.layouts.push(value as LayoutFile)
    else if (kind === 'module') model.modules[moduleOf(path)!] = emptyModule(value as ModuleFile)
    else continue
    locate((value as { id: string }).id, path)
    entries.push({ path, kind, value: value as Entry['value'] })
  }
  for (const path of paths) {
    const folder = folderOf(path)
    if (!folder) continue
    const name = moduleOf(path)!
    // A module folder without module.json still gets its artifacts checked.
    const target = model.modules[name] ??= emptyModule({ id: `mod_${name.replaceAll('-', '_')}`, name, label: name, dependsOn: [] })
    const value = parsed[path] as { id?: string, entity?: string }
    ;(target[folder] as unknown[]).push(value)
    locate(folder === 'fixtures' ? `fixtures:${value.entity}` : value.id!, path)
    entries.push({ path, kind: fileKind(path)!, module: name, value })
  }
  return { model, entries }
}

// ── Cross-file checks ──────────────────────────────────────────────────

const NAME_LABELS: Partial<Record<FileKind, string>> = {
  datasource: 'data source name', layout: 'layout name', entity: 'entity name', query: 'query name', action: 'action name',
  state: 'state name', component: 'component name', page: 'page name'
}

const crossCheck = (model: Model, entries: Entry[]): ModelProblem[] => {
  const problems: ModelProblem[] = []
  const at = (id: string) => model.paths[id] ?? PROJECT_FILE
  const report = (path: string, where: string, message: string) => problems.push({ path, message: `${where}: ${message}` })

  type RefKind = 'entity' | 'datasource' | 'layout' | 'page' | 'component' | 'query' | 'action' | 'state' | 'field'
  const byKind = Object.fromEntries((['entity', 'datasource', 'layout', 'page', 'component', 'query', 'action', 'state', 'field'] as const)
    .map(kind => [kind, new Set<string>()])) as Record<RefKind, Set<string>>
  const moduleOfId = new Map<string, string>()

  // Unique ids across the whole model; unique names per kind and module.
  const seenIds = new Map<string, string>()
  const seenNames = new Map<string, string>()
  for (const entry of entries) {
    const { id, name } = entry.value
    if (!id) continue
    const first = seenIds.get(id)
    if (first) report(entry.path, 'id', `Duplicate id "${id}" (also in ${first})`)
    else seenIds.set(id, entry.path)
    const label = NAME_LABELS[entry.kind]
    if (label && name) {
      const key = `${entry.module ?? ''}:${entry.kind}:${name}`
      if (seenNames.has(key)) report(entry.path, 'name', `Duplicate ${label} "${name}"${entry.module ? ` in module "${entry.module}"` : ''}`)
      else seenNames.set(key, entry.path)
    }
    if (entry.kind in byKind) byKind[entry.kind as RefKind].add(id)
    if (entry.module) moduleOfId.set(id, entry.module)
  }
  for (const [folder, mod] of Object.entries(model.modules)) {
    if (mod.module.name !== folder) report(`.bildr/modules/${folder}/module.json`, 'name', `Module name "${mod.module.name}" must match its folder "${folder}"`)
    for (const holder of [...mod.entities, ...mod.state]) for (const field of holder.fields) byKind.field.add(field.id)
  }

  // Module dependencies: known modules, no cycles.
  const reported = new Set<string>()
  for (const [folder, mod] of Object.entries(model.modules)) {
    const modulePath = `.bildr/modules/${folder}/module.json`
    for (const dep of mod.module.dependsOn) if (!model.modules[dep]) report(modulePath, 'dependsOn', `Unknown module "${dep}"`)
    const walk = (name: string, trail: string[]): string[] | undefined => {
      if (trail.includes(name)) return [...trail, name]
      for (const dep of model.modules[name]?.module.dependsOn ?? []) {
        const cycle = walk(dep, [...trail, name])
        if (cycle) return cycle
      }
      return undefined
    }
    const cycle = walk(folder, [])
    if (cycle && cycle[0] === folder && !cycle.some(name => reported.has(name))) {
      report(modulePath, 'dependsOn', `Module dependency cycle: ${cycle.join(' → ')}`)
      cycle.forEach(name => reported.add(name))
    }
  }

  // References. A module may use its own artifacts and those of modules it depends on.
  for (const [folder, mod] of Object.entries(model.modules)) {
    const visible = new Set([folder, ...mod.module.dependsOn])
    const ref = (path: string, where: string, kind: RefKind, id: string, label: string) => {
      const owner = moduleOfId.get(id)
      if (!byKind[kind].has(id) || (owner !== undefined && !visible.has(owner))) report(path, where, `Unknown ${label} "${id}"`)
    }
    for (const repo of mod.repositories) {
      const path = at(repo.id)
      ref(path, 'entity', 'entity', repo.entity, 'entity')
      ref(path, 'datasource', 'datasource', repo.datasource, 'data source')
      repo.finders?.forEach((finder, index) => ref(path, `finders.${index}.by`, 'field', finder.by, 'field'))
    }
    for (const query of mod.queries) ref(at(query.id), 'from', 'entity', query.from, 'entity')
    for (const action of mod.actions) {
      const path = at(action.id)
      if (action.input.entity) ref(path, 'input.entity', 'entity', action.input.entity, 'entity')
      if (action.output) ref(path, 'output.entity', 'entity', action.output.entity, 'entity')
      action.client.invalidates.forEach((id, index) => ref(path, `client.invalidates.${index}`, 'entity', id, 'entity'))
    }
    for (const fixtures of mod.fixtures) ref(at(`fixtures:${fixtures.entity}`), 'entity', 'entity', fixtures.entity, 'entity')
    for (const component of mod.components) {
      component.properties.forEach((prop, index) => prop.entity && ref(at(component.id), `properties.${index}.entity`, 'entity', prop.entity, 'entity'))
      checkTree(component.root, 'root', at(component.id))
    }
    for (const page of mod.pages) {
      const path = at(page.id)
      if (page.layout) ref(path, 'layout', 'layout', page.layout, 'layout')
      page.uses?.queries?.forEach((use, index) => ref(path, `uses.queries.${index}.query`, 'query', use.query, 'query'))
      page.uses?.actions?.forEach((use, index) => ref(path, `uses.actions.${index}.action`, 'action', use.action, 'action'))
      page.uses?.state?.forEach((use, index) => ref(path, `uses.state.${index}.state`, 'state', use.state, 'state'))
      checkTree(page.root, 'root', path)
    }
  }
  for (const layout of model.layouts) {
    const path = at(layout.id)
    checkTree(layout.root, 'root', path)
    const ids = new Set<string>()
    const collect = (node: ModelNode) => {
      ids.add(node.id)
      node.children?.forEach(collect)
    }
    collect(layout.root)
    layout.slots.forEach((slot, index) => !ids.has(slot.nodeId) && report(path, `slots.${index}.nodeId`, `Unknown node "${slot.nodeId}"`))
  }
  return problems

  function checkTree(node: ModelNode, where: string, path: string) {
    if (node.type === 'Instance' && typeof node.props?.component === 'string' && !byKind.component.has(node.props.component)) {
      report(path, `${where}.props.component`, `Unknown component "${node.props.component}"`)
    }
    for (const [key, value] of Object.entries(node.props ?? {})) checkValue(value, `${where}.props.${key}`, path)
    node.interactions?.forEach((interaction, i) => interaction.do.forEach((step, j) => {
      const at = `${where}.interactions.${i}.do.${j}`
      if (step.kind === 'runAction' && typeof step.action === 'string' && !byKind.action.has(step.action)) report(path, `${at}.action`, `Unknown action "${step.action}"`)
      if (step.kind === 'setState' && typeof step.state === 'string' && !byKind.state.has(step.state)) report(path, `${at}.state`, `Unknown state "${step.state}"`)
      for (const [key, value] of Object.entries(step)) if (key !== 'kind') checkValue(value as Value, `${at}.${key}`, path)
    }))
    node.children?.forEach((child, index) => checkTree(child, `${where}.children.${index}`, path))
  }

  function checkValue(value: Value | undefined, where: string, path: string) {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) return value.forEach((item, index) => checkValue(item, `${where}.${index}`, path))
    for (const key of Object.keys(value)) {
      if (key.startsWith('$') && !(EXPRESSION_KEYS as readonly string[]).includes(key)) report(path, `${where}.${key}`, `Unknown expression "${key}"`)
    }
    if (typeof value.page === 'string' && !byKind.page.has(value.page)) report(path, `${where}.page`, `Unknown page "${value.page}"`)
    for (const [key, item] of Object.entries(value)) if (key !== 'page') checkValue(item, `${where}.${key}`, path)
  }
}
