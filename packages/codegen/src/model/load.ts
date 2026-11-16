import type { z } from 'zod'
import { customColorNames } from '../design/theme.ts'
import { isStyleKeyOf, styleTokenProblem } from '../design/tokens.ts'
import type { BreakpointBase } from '../design/tokens.ts'
import { ICON_NAME, nodePropProblems, propValues, STRUCTURAL_PROPS, takesProp, uiStepProblems } from '../render/rules.ts'
import {
  ActionFileSchema, ComponentFileSchema, DataSourceFileSchema, EntityFileSchema, EXPRESSION_KEYS, FixturesFileSchema, LAYOUT_VARIABLE_KINDS, PATH_EXPRESSIONS, PROPERTY_PATH,
  LayoutFileSchema, ManifestFileSchema, ModuleFileSchema, PageFileSchema, ProjectFileSchema, QueryFileSchema,
  RepositoryFileSchema, StateFileSchema, ThemeFileSchema
} from './schemas.ts'
import type {
  ActionFile, ComponentFile, DataSourceFile, EntityFile, FixturesFile, LayoutFile, ManifestFile, ModelNode, ModuleFile,
  PageFile, ProjectFile, PropertyDef, QueryFile, RepositoryFile, StateFile, ThemeFile, Value
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
  // Only normalized paths: `modules/../x` would be written outside the folder its kind implies.
  if (path.split('/').some(part => part === '' || part === '.' || part === '..')) return undefined
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

/** How far loading got: it stops at the first stage that has problems (a stage's problems hide every later stage's). */
export type LoadStage
  = /** Files that are unknown or not JSON, or no project file. */ 'files'
    | /** The project file does not load: not an object, a newer schemaVersion, or a migration fails. */ 'project'
    | /** Files that fail their schema. */ 'schema'
    /** Cross-file references and uniqueness. */
    | 'references'
    | /** No problems. */ 'loaded'

export interface ModelInspection {
  stage: LoadStage
  /** The problems `loadModel` reports: those of `stage`. */
  problems: ModelProblem[]
  /**
   * The problems of single files whatever the stage: an unknown file, one that is not JSON, or one that fails its schema.
   * Past the stage that stopped loading they are told as best as can be (the files of a project that does not load are
   * checked as they are, without migrations), and they name the files that cannot be part of a model.
   */
  own: ModelProblem[]
  model?: Model
}

/**
 * `loadModel` with where it stopped (`stage`) and the problems of single files (`own`), so a caller can judge a change
 * to the files without letting an earlier stage hide the later ones. `problems` is what `loadModel` reports.
 */
export const inspectModel = (files: Record<string, string>, options: LoadOptions = {}): ModelInspection => {
  const { current: supported = CURRENT_SCHEMA_VERSION, migrations = MODEL_MIGRATIONS } = options
  const paths = Object.keys(files).filter(isModelPath).sort()
  const problems: ModelProblem[] = []
  const own: ModelProblem[] = []
  const raw: Record<string, unknown> = {}
  const validate = (current: Record<string, unknown>) => {
    const parsed: Record<string, unknown> = {}
    const found: ModelProblem[] = []
    for (const path of Object.keys(current).sort()) {
      const result = SCHEMAS[fileKind(path)!].safeParse(current[path])
      if (result.success) parsed[path] = result.data
      else found.push(...issueProblems(path, result.error))
    }
    return { parsed, found }
  }
  const stopped = (stage: LoadStage, stopProblems: ModelProblem[]): ModelInspection => ({ stage, problems: stopProblems, own: [...own, ...validate(raw).found] })

  if (!(PROJECT_FILE in files)) problems.push({ path: PROJECT_FILE, message: 'Missing project file' })
  for (const path of paths) {
    if (!fileKind(path)) {
      own.push({ path, message: 'Unknown model file' })
      continue
    }
    try {
      raw[path] = JSON.parse(files[path]!)
    } catch (error) {
      own.push({ path, message: `Invalid JSON: ${(error as Error).message}` })
    }
  }
  problems.push(...own)
  if (problems.length) return stopped('files', problems)

  const project = raw[PROJECT_FILE]
  if (project !== undefined && (typeof project !== 'object' || project === null || Array.isArray(project))) {
    return stopped('project', [{ path: PROJECT_FILE, message: 'The project file must be a JSON object' }])
  }
  const version = (project as { schemaVersion?: unknown } | undefined)?.schemaVersion
  if (typeof version === 'number' && version > supported) {
    return stopped('project', [{ path: PROJECT_FILE, message: `schemaVersion ${version} is newer than this bildr supports (${supported}). Update bildr.` }])
  }
  let current = raw
  if (typeof version === 'number') {
    for (let from = version; from < supported; from++) {
      const migrate = migrations[from]
      if (!migrate) return stopped('project', [{ path: PROJECT_FILE, message: `No migration from schemaVersion ${from} to ${from + 1}` }])
      try {
        current = migrate(current)
      } catch (error) {
        return stopped('project', [{ path: PROJECT_FILE, message: `Migrating from schemaVersion ${from} failed: ${(error as Error).message}` }])
      }
    }
  }

  const { parsed, found } = validate(current)
  if (found.length) return { stage: 'schema', problems: found, own: found }

  const { model, entries } = assemble(parsed)
  const crossProblems = crossCheck(model, entries)
  return crossProblems.length ? { stage: 'references', problems: crossProblems, own: [] } : { stage: 'loaded', problems: [], own: [], model }
}

/**
 * Loads a project's `.bildr/` files (path → text) into one validated model.
 * Pure: the caller reads the files. All file problems are reported together;
 * cross-file references are checked only once every file parses.
 */
export const loadModel = (files: Record<string, string>, options: LoadOptions = {}): LoadResult => {
  const inspection = inspectModel(files, options)
  return inspection.model ? { ok: true, model: inspection.model } : { ok: false, problems: inspection.problems }
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
  const report = (path: string, where: string, message: string) => {
    problems.push({ path, message: `${where}: ${message}` })
  }
  const base: BreakpointBase = model.project.breakpointBase ?? 'mobile'
  const colors = customColorNames(model.theme)
  const components = new Map(Object.values(model.modules).flatMap(mod => mod.components.map(component => [component.id, component] as const)))

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
      // The repository step is what the use-case does and returns; without one it would only check its input.
      if (!action.steps.some(step => step.kind === 'repository')) report(path, 'steps', 'An action needs a "repository" step (create, update or delete) to do its work')
      // It returns the use-case's result, so it must be last: one repository step per action.
      action.steps.forEach((step, index) => {
        if (step.kind === 'repository' && index !== action.steps.length - 1) report(path, `steps.${index}`, 'A "repository" step must be the last step: the use-case returns its result')
      })
    }
    // The generators derive the key from idStrategy: "uuid" adds the id field, "external" uses the source's own.
    for (const entity of mod.entities) {
      const path = at(entity.id)
      const idField = entity.fields.findIndex(field => field.name === 'id')
      if (entity.idStrategy === 'uuid' && idField !== -1) report(path, `fields.${idField}.name`, '"id" is reserved: the id comes from idStrategy "uuid"')
      if (entity.idStrategy === 'external' && idField === -1) report(path, 'fields', 'idStrategy "external" needs an "id" field (the key its data source owns)')
      // timestamps adds the createdAt and updatedAt columns itself.
      if (entity.timestamps) {
        entity.fields.forEach((field, index) => {
          if (field.name === 'createdAt' || field.name === 'updatedAt') report(path, `fields.${index}.name`, `"${field.name}" is reserved: timestamps adds it`)
        })
      }
    }
    for (const fixtures of mod.fixtures) ref(at(`fixtures:${fixtures.entity}`), 'entity', 'entity', fixtures.entity, 'entity')
    for (const component of mod.components) {
      const path = at(component.id)
      component.properties.forEach((prop, index) => prop.entity && ref(path, `properties.${index}.entity`, 'entity', prop.entity, 'entity'))
      const nodes = nodeIndex(component.root)
      component.properties.forEach((prop, index) => {
        if (prop.kind === 'slot' && !prop.nodeId) report(path, `properties.${index}.nodeId`, 'A slot property needs the node whose children it replaces')
        else if (prop.nodeId && !nodes.has(prop.nodeId)) report(path, `properties.${index}.nodeId`, `Unknown node "${prop.nodeId}"`)
        propertyProblems(prop, `properties.${index}`, path, nodes)
      })
      variantProblems(component, path, nodes)
      // A property named `layout` is the component's own root.
      checkTree(component.root, 'root', path, component.properties.some(prop => prop.name === 'layout') ? undefined : null)
    }
    for (const page of mod.pages) {
      const path = at(page.id)
      if (page.layout) ref(path, 'layout', 'layout', page.layout, 'layout')
      if (page.layoutValues) {
        const layout = model.layouts.find(entry => entry.id === page.layout)
        if (!page.layout) report(path, 'layoutValues', 'A page without a layout has no layout values')
        else if (layout) {
          for (const [id, value] of Object.entries(page.layoutValues)) {
            const variable = layout.variables?.find(entry => entry.id === id)
            if (!variable) report(path, `layoutValues.${id}`, `Layout ${layout.name} has no variable "${id}"`)
            else if (isExpression(value)) report(path, `layoutValues.${id}`, 'Layout values are static (definePageMeta is compiled ahead of the page)')
            else {
              const problem = valueProblem(variable, value)
              if (problem) report(path, `layoutValues.${id}`, problem)
            }
          }
        }
      }
      page.uses?.queries?.forEach((use, index) => ref(path, `uses.queries.${index}.query`, 'query', use.query, 'query'))
      page.uses?.actions?.forEach((use, index) => ref(path, `uses.actions.${index}.action`, 'action', use.action, 'action'))
      page.uses?.state?.forEach((use, index) => ref(path, `uses.state.${index}.state`, 'state', use.state, 'state'))
      const uses = page.uses ?? {}
      const aliased = [...uses.state ?? [], ...uses.queries ?? [], ...uses.actions ?? [], ...uses.computed ?? []].some(use => use.as === 'layout')
      checkTree(page.root, 'root', path, aliased ? undefined : null)
    }
  }
  for (const layout of model.layouts) {
    const path = at(layout.id)
    const ids = nodeIndex(layout.root)
    checkTree(layout.root, 'root', path, { name: layout.name, variables: new Set((layout.variables ?? []).map(variable => variable.name)) })
    layout.slots.forEach((slot, index) => !ids.has(slot.nodeId) && report(path, `slots.${index}.nodeId`, `Unknown node "${slot.nodeId}"`))
    layout.variables?.forEach((variable, index) => {
      if (!(LAYOUT_VARIABLE_KINDS as readonly string[]).includes(variable.kind)) {
        report(path, `variables.${index}.kind`, `A layout variable is ${LAYOUT_VARIABLE_KINDS.slice(0, -1).join(', ')} or ${LAYOUT_VARIABLE_KINDS.at(-1)}`)
      } else {
        propertyProblems(variable, `variables.${index}`, path, ids)
      }
    })
  }
  return problems

  function nodeIndex(root: ModelNode) {
    const nodes = new Map<string, ModelNode>()
    const visit = (node: ModelNode) => {
      nodes.set(node.id, node)
      node.children?.forEach(visit)
    }
    visit(root)
    return nodes
  }

  function isExpression(value: Value | undefined) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).some(key => key.startsWith('$') || key === 'not')
  }

  /** Why `value` can't be the value of `property` (a default, an instance value or a layout value); expressions are checked where they are evaluated. */
  function valueProblem(property: PropertyDef, value: Value): string | undefined {
    if (property.kind === 'entity' && property.many) return isExpression(value) && '$bind' in (value as object) ? undefined : `${property.name} is a list of entities: bind it with $bind`
    if (isExpression(value) || property.kind === 'entity' || property.kind === 'slot') return undefined
    if (property.kind === 'number') return typeof value === 'number' ? undefined : `${property.name} must be a number`
    if (property.kind === 'boolean') return typeof value === 'boolean' ? undefined : `${property.name} must be true or false`
    if (typeof value !== 'string') return `${property.name} must be a string`
    if (property.kind === 'select' && property.options && !property.options.includes(value)) return `"${value}" is not one of the options of ${property.name} (${property.options.join(', ')})`
    if (property.kind === 'icon' && value !== '' && !ICON_NAME.test(value)) return 'An icon is a name like "i-lucide-send"'
    if (property.kind === 'field' && !byKind.field.has(value)) return `Unknown field "${value}"`
    return undefined
  }

  /** Rules shared by component properties and layout variables: options, bindings and the default. */
  function propertyProblems(property: PropertyDef, where: string, path: string, nodes: Map<string, ModelNode>) {
    if (property.kind === 'select' && !property.options) report(path, `${where}.options`, 'A select property needs its options')
    if (property.required && property.optional) report(path, `${where}.optional`, 'A property is either required or optional')
    if (property.kind === 'slot' && property.bindings) report(path, `${where}.bindings`, 'A slot property names its node with nodeId')
    property.bindings?.forEach((binding, index) => {
      const at = `${where}.bindings.${index}`
      const node = nodes.get(binding.nodeId)
      if (!node) return report(path, `${at}.nodeId`, `Unknown node "${binding.nodeId}"`)
      if (binding.target !== 'style') {
        if (STRUCTURAL_PROPS.includes(binding.prop)) return report(path, `${at}.prop`, `A property can't drive "${binding.prop}": it shapes the generated markup`)
        if (!takesProp(node.type, binding.prop)) return report(path, `${at}.prop`, `A ${node.type} has no prop "${binding.prop}"`)
        const values = propValues(node.type, binding.prop)
        if (!values) return
        const what = `the ${node.type} ${binding.prop}`
        if (property.kind !== 'select') return report(path, at, `${property.name} (kind ${property.kind}) can't drive ${what}: use a select property with options among ${values.join(', ')}`)
        property.options?.forEach((option, o) => {
          if (!values.includes(option)) report(path, `${where}.options.${o}`, `"${option}" is not a value of ${what} ${property.name} drives (${values.join(', ')})`)
        })
        return
      }
      if (!isStyleKeyOf(binding.prop, base)) return report(path, `${at}.prop`, styleTokenProblem(binding.prop, '', colors, base) ?? `Unknown style token "${binding.prop}"`)
      if (property.kind !== 'text' && property.kind !== 'select') return report(path, at, `${property.name} (kind ${property.kind}) can't drive the style "${binding.prop}": use a text or select property`)
      property.options?.forEach((option, o) => {
        if (styleTokenProblem(binding.prop, option, colors, base)) report(path, `${where}.options.${o}`, `"${option}" is not a value of the style "${binding.prop}" ${property.name} drives`)
      })
      if (typeof property.default === 'string' && styleTokenProblem(binding.prop, property.default, colors, base)) {
        report(path, `${where}.default`, `"${property.default}" is not a value of the style "${binding.prop}" ${property.name} drives`)
      }
    })
    if (property.default !== undefined) {
      const problem = valueProblem(property, property.default)
      if (problem) report(path, `${where}.default`, problem)
    }
  }

  /** Overrides (nodes, props, style, unset), states and interactions of a component's variants. */
  function variantProblems(component: ComponentFile, path: string, nodes: Map<string, ModelNode>) {
    const byId = new Map(component.variants.map(variant => [variant.id, variant]))
    const driven = new Map<string, string>()
    for (const property of component.properties) {
      for (const binding of property.bindings ?? []) if (binding.target === 'style') driven.set(`${binding.nodeId}:${binding.prop}`, property.name)
    }
    const states = new Set<string>()
    component.variants.forEach((variant, v) => {
      for (const [id, override] of Object.entries(variant.overrides)) {
        const at = `variants.${v}.overrides.${id}`
        const node = nodes.get(id)
        if (!node) {
          report(path, at, `Variant ${variant.name} overrides the missing node "${id}"`)
          continue
        }
        const props = override.props ?? {}
        for (const key of Object.keys(props)) {
          if (STRUCTURAL_PROPS.includes(key)) report(path, `${at}.props.${key}`, `A variant can't override "${key}": it shapes the generated markup`)
          else if (key !== 'hidden' && !takesProp(node.type, key)) report(path, `${at}.props.${key}`, `A ${node.type} has no prop "${key}"`)
          else checkValue(props[key], `${at}.props.${key}`, path)
        }
        for (const problem of nodePropProblems(node.type, { ...node.props, ...props })) {
          if (problem.key in props && !STRUCTURAL_PROPS.includes(problem.key)) report(path, `${at}.props.${problem.key}`, problem.message)
        }
        for (const [key, value] of Object.entries(override.style ?? {})) {
          const problem = styleTokenProblem(key, value, colors, base)
          if (problem) report(path, `${at}.style.${key}`, problem)
          else if (driven.has(`${id}:${key}`)) report(path, `${at}.style.${key}`, `${driven.get(`${id}:${key}`)} drives "${key}" of ${id}: a variant can't override it too`)
        }
        const removed = new Set<string>()
        override.unset?.forEach((key, u) => {
          const message = (isStyleKeyOf(key, base) ? undefined : styleTokenProblem(key, '', colors, base) ?? `Unknown style token "${key}"`)
            ?? (removed.has(key) ? `Variant ${variant.name} removes "${key}" twice on ${id}` : undefined)
            ?? (override.style && key in override.style ? `Variant ${variant.name} both overrides and removes "${key}" on ${id}` : undefined)
            ?? (driven.has(`${id}:${key}`) ? `${driven.get(`${id}:${key}`)} drives "${key}" of ${id}: a variant can't override it too` : undefined)
          if (message) report(path, `${at}.unset.${u}`, message)
          removed.add(key)
        })
      }
      if (variant.state) {
        const { of, kind } = variant.state
        const base = of === '' ? undefined : byId.get(of)
        const at = `variants.${v}.state`
        if (of === variant.id) report(path, `${at}.of`, `State ${variant.name} can't be a state of itself`)
        else if (of !== '' && !base) report(path, `${at}.of`, `State ${variant.name} is a state of the missing variant "${of}"`)
        else if (base?.state) report(path, `${at}.of`, `State ${variant.name} can't be a state of the state ${base.name}`)
        else if (states.has(`${of}:${kind}`)) report(path, `${at}.kind`, `${base ? `Variant ${base.name}` : 'The primary variant'} already has a ${kind} state`)
        states.add(`${of}:${kind}`)
      }
    })
    const lists = [
      { where: 'interactions', list: component.interactions ?? [] },
      ...component.variants.map((variant, v) => ({ where: `variants.${v}.interactions`, list: variant.interactions ?? [] }))
    ]
    for (const { where, list } of lists) {
      list.forEach((interaction, k) => {
        const to = interaction.do[0].to
        const target = to === '' ? undefined : byId.get(to)
        if (to !== '' && !target) report(path, `${where}.${k}.do.0.to`, `An interaction goes to the missing variant "${to}"`)
        else if (target?.state) report(path, `${where}.${k}.do.0.to`, `An interaction can't go to the state ${target.name}: states show from the pointer`)
      })
    }
  }

  /** `layout`: the variables `$bind: 'layout.<name>'` may read (a layout), null where no `layout` root exists, undefined where `layout` is the file's own root. */
  function checkTree(node: ModelNode, where: string, path: string, layout?: { name: string, variables: Set<string> } | null) {
    if (node.type === 'Instance' && typeof node.props?.component === 'string' && !byKind.component.has(node.props.component)) {
      report(path, `${where}.props.component`, `Unknown component "${node.props.component}"`)
    }
    if (node.type === 'Instance' && typeof node.props?.component === 'string') {
      const component = components.get(node.props.component)
      const values = node.props.values
      if (component) {
        // A required property without a default has no value to fall back on: the instance gives it (the page would fail at runtime otherwise).
        const given = values && typeof values === 'object' && !Array.isArray(values) ? values : {}
        const missing = component.properties.filter(property => property.required && property.kind !== 'slot' && property.default === undefined && !(property.id in given)).map(property => property.name)
        if (missing.length) report(path, `${where}.props.values`, `${component.name} needs a value for its required propert${missing.length === 1 ? 'y' : 'ies'} ${missing.join(', ')}`)
      }
      if (component && values && typeof values === 'object' && !Array.isArray(values)) {
        for (const [id, value] of Object.entries(values)) {
          const property = component.properties.find(entry => entry.id === id)
          const problem = property ? valueProblem(property, value) : `Component ${component.name} has no property "${id}"`
          if (problem) report(path, `${where}.props.values.${id}`, problem)
        }
      }
      const variant = node.props.variant
      if (component && variant !== undefined && variant !== '' && !component.variants.some(entry => entry.id === variant)) {
        report(path, `${where}.props.variant`, `Component ${component.name} has no variant "${String(variant)}"`)
      }
    }
    for (const [key, value] of Object.entries(node.props ?? {})) checkValue(value, `${where}.props.${key}`, path, layout)
    for (const problem of nodePropProblems(node.type, node.props)) report(path, `${where}.props.${problem.key}`, problem.message)
    node.interactions?.forEach((interaction, i) => interaction.do.forEach((step, j) => {
      const at = `${where}.interactions.${i}.do.${j}`
      for (const problem of uiStepProblems(step)) report(path, `${at}.${problem.key}`, problem.message)
      if (step.kind === 'runAction' && typeof step.action === 'string' && !byKind.action.has(step.action)) report(path, `${at}.action`, `Unknown action "${step.action}"`)
      if (step.kind === 'setState' && typeof step.state === 'string' && !byKind.state.has(step.state)) report(path, `${at}.state`, `Unknown state "${step.state}"`)
      for (const [key, value] of Object.entries(step)) if (key !== 'kind') checkValue(value as Value, `${at}.${key}`, path, layout)
    }))
    node.children?.forEach((child, index) => checkTree(child, `${where}.children.${index}`, path, layout))
  }

  function checkValue(value: Value | undefined, where: string, path: string, layout?: { name: string, variables: Set<string> } | null) {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) return value.forEach((item, index) => checkValue(item, `${where}.${index}`, path, layout))
    const bound = typeof value.$bind === 'string' ? value.$bind.split('.') : []
    if (bound[0] === 'layout' && layout === null) report(path, `${where}.$bind`, '"layout" values are read in layouts only')
    if (bound[0] === 'layout' && layout && (bound.length !== 2 || !layout.variables.has(bound[1]!))) report(path, `${where}.$bind`, `Layout ${layout.name} has no variable "${bound.slice(1).join('.')}"`)
    for (const key of Object.keys(value)) {
      if (key.startsWith('$') && !(EXPRESSION_KEYS as readonly string[]).includes(key)) report(path, `${where}.${key}`, `Unknown expression "${key}"`)
    }
    // Paths become property access in generated code: nothing else gets through.
    for (const key of PATH_EXPRESSIONS) {
      const path_ = value[key]
      if (typeof path_ === 'string' && !PROPERTY_PATH.test(path_)) report(path, `${where}.${key}`, `"${path_}" is not a property path (letters, digits, _ and $, separated by dots)`)
    }
    if (typeof value.$template === 'string') {
      for (const [, part] of value.$template.matchAll(/\{([^}]*)\}/g)) {
        if (!PROPERTY_PATH.test(part!)) report(path, `${where}.$template`, `"${part}" is not a property path (letters, digits, _ and $, separated by dots)`)
      }
    }
    if (typeof value.page === 'string' && !byKind.page.has(value.page)) report(path, `${where}.page`, `Unknown page "${value.page}"`)
    for (const [key, item] of Object.entries(value)) if (key !== 'page') checkValue(item, `${where}.${key}`, path, layout)
  }
}
