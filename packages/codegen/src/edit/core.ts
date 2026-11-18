import { z } from 'zod'
import { customColorNames } from '../design/theme.ts'
import { generate } from '../generate/index.ts'
import type { BreakpointBase } from '../design/tokens.ts'
import { loadModel, MANIFEST_FILE } from '../model/load.ts'
import type { Model, ModelProblem, ModuleModel } from '../model/load.ts'
import type { ComponentFile, LayoutFile, ModelNode, PageFile, Value } from '../model/schemas.ts'
import { serializeModel } from '../model/serialize.ts'
import { actionNameProblem, queryNameProblem } from './generated-names.ts'
import { walk } from './tree.ts'

/**
 * The machinery every edit shares: errors, names, id minting, the draft model
 * an edit changes, and the change set it becomes. Pure: no fs.
 */

/**
 * A refusal is a model rule (`invalid`, 422), never a guard: path and write refusals (`forbidden`) belong to the module's actions.
 * `conflict` (409) is for an edit aimed at a thing that is no longer what the caller saw.
 */
export type EditErrorCode = 'invalid_input' | 'not_found' | 'invalid' | 'conflict'

export class EditError extends Error {
  readonly code: EditErrorCode

  // Plain fields, not parameter properties: Node's type stripping can't run those.
  constructor(code: EditErrorCode, message: string) {
    super(message)
    this.name = 'EditError'
    this.code = code
  }
}

export const fail = (code: Exclude<EditErrorCode, 'invalid_input'>, message: string): never => {
  throw new EditError(code, message)
}

/** Whether `value` is an object of values (not null, not a list): a binding, a template, a step. */
export const isObject = (value: unknown): value is Record<string, Value> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** One file an edit writes (`content`, canonical) or deletes (`null`), relative to the project root. */
export interface FileChange {
  path: string
  content: string | null
}

export type EditOutcome<R = Record<string, unknown>>
  = | { ok: true, changes: FileChange[], result: R }
    | { ok: false, code: EditErrorCode, message: string, problems?: ModelProblem[] }

// ── Names and ids ────────────────────────────────────────────────────────

const words = (name: string) => name.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** `About us` → `about_us`, `featuredPosts` → `featured_posts`. */
export const snake = (name: string): string => words(name).join('_')
/** `About us` → `about-us`. */
export const kebab = (name: string): string => words(name).join('-')
/** `post card` → `PostCard`. */
export const pascal = (name: string): string => words(name).map(word => word[0]!.toUpperCase() + word.slice(1)).join('')
/** `Draft label` → `draftLabel`. */
export const camel = (name: string): string => {
  const value = pascal(name)
  return value ? value[0]!.toLowerCase() + value.slice(1) : value
}

/**
 * A new artifact id: `prefix` plus the snake-cased name (`new` when nothing is
 * left of it), numbered `_2`, `_3`… while `taken` has it. Reserves the id in `taken`.
 */
export const mintId = (prefix: string, name: string, taken: Set<string>): string => {
  const base = `${prefix}_${snake(name) || 'new'}`
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`
  taken.add(id)
  return id
}

/** `name`, or `name2`, `name3`… (with `separator`) until `taken` (lowercased) doesn't have it. */
export const uniqueName = (name: string, taken: Iterable<string>, separator = ''): string => {
  const used = new Set([...taken].map(entry => entry.toLowerCase()))
  let candidate = name
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${name}${separator}${n}`
  return candidate
}

// ── The draft ────────────────────────────────────────────────────────────

export type TreeKind = 'page' | 'component' | 'layout'

/** A file with a node tree: a page, a component or a layout. */
export interface Tree {
  /** Its artifact id. */
  file: string
  kind: TreeKind
  owner: PageFile | ComponentFile | LayoutFile
  /** The module folder of a page or component. */
  module?: string
  readonly root: ModelNode
}

const KIND_ROOT: Record<TreeKind, string> = { page: 'page root', component: 'component root', layout: 'layout root' }
export const rootName = (tree: Tree) => KIND_ROOT[tree.kind]

/** Every page, component and layout of `model`, by artifact id. */
export const treesOf = (model: Model): Tree[] => {
  const trees: Tree[] = []
  // `root` reads the owner's, so an edit that replaces a root is seen.
  const tree = (file: string, kind: TreeKind, owner: Tree['owner'], module?: string): Tree => ({
    file, kind, owner, ...(module ? { module } : {}),
    get root() {
      return owner.root
    }
  })
  for (const [module, mod] of Object.entries(model.modules)) {
    for (const page of mod.pages) trees.push(tree(page.id, 'page', page, module))
    for (const component of mod.components) trees.push(tree(component.id, 'component', component, module))
  }
  for (const layout of model.layouts) trees.push(tree(layout.id, 'layout', layout))
  return trees.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
}

/** File base names Windows reserves for devices, with any extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** The model an edit changes in place (a copy of the loaded one), with what minting needs. */
export class Draft {
  readonly model: Model
  private readonly ids: Set<string>
  private readonly nodeIds: Set<string>

  constructor(model: Model) {
    this.model = model
    this.ids = new Set(Object.keys(model.paths).filter(key => !key.startsWith('fixtures:')))
    for (const mod of Object.values(model.modules)) {
      this.ids.add(mod.module.id)
      for (const holder of [...mod.entities, ...mod.state]) holder.fields.forEach(field => this.ids.add(field.id))
      for (const component of mod.components) {
        component.properties.forEach(property => this.ids.add(property.id))
        component.variants.forEach(variant => this.ids.add(variant.id))
      }
    }
    for (const layout of model.layouts) layout.variables?.forEach(variable => this.ids.add(variable.id))
    this.nodeIds = new Set()
    for (const tree of this.trees()) walk(tree.root, node => this.nodeIds.add(node.id))
  }

  get base(): BreakpointBase {
    return this.model.project.breakpointBase ?? 'mobile'
  }

  get colors(): string[] {
    return customColorNames(this.model.theme)
  }

  /** A new artifact id (see `mintId`), unique across the whole model. */
  mint(prefix: string, name: string): string {
    return mintId(prefix, name, this.ids)
  }

  /** A new node id, `n_<type>_<k>`, unique across every tree of the model. */
  nodeId(type: string): string {
    const base = `n_${snake(type) || 'node'}`
    let k = 1
    while (this.nodeIds.has(`${base}_${k}`)) k++
    const id = `${base}_${k}`
    this.nodeIds.add(id)
    return id
  }

  /** Every page, component and layout. */
  trees(): Tree[] {
    return treesOf(this.model)
  }

  tree(file: string): Tree {
    return this.trees().find(tree => tree.file === file) ?? fail('not_found', `No page, component or layout "${file}"`)
  }

  page(id: string): { page: PageFile, module: string } {
    for (const [module, mod] of Object.entries(this.model.modules)) {
      const page = mod.pages.find(entry => entry.id === id)
      if (page) return { page, module }
    }
    return fail('not_found', `No page "${id}"`)
  }

  component(id: string): { component: ComponentFile, module: string } {
    for (const [module, mod] of Object.entries(this.model.modules)) {
      const component = mod.components.find(entry => entry.id === id)
      if (component) return { component, module }
    }
    return fail('not_found', `No component "${id}"`)
  }

  layout(id: string): LayoutFile {
    return this.model.layouts.find(entry => entry.id === id) ?? fail('not_found', `No layout "${id}"`)
  }

  module(name: string): ModuleModel {
    return this.model.modules[name] ?? fail('not_found', `No module "${name}"`)
  }

  pages(): PageFile[] {
    return Object.values(this.model.modules).flatMap(mod => mod.pages)
  }

  components(): ComponentFile[] {
    return Object.values(this.model.modules).flatMap(mod => mod.components)
  }

  /**
   * Records where a new artifact is written: `<folder>/<file>.json`, numbered when
   * another artifact has that path in any letter case (macOS and Windows file
   * systems ignore it). A name Windows reserves for a device is refused.
   */
  place(id: string, folder: string, file: string): string {
    if (WINDOWS_RESERVED.test(file)) fail('invalid', `"${file.toLowerCase()}" can't be a file name: Windows reserves it for a device. Pick another name`)
    const used = new Set(Object.values(this.model.paths).map(path => path.toLowerCase()))
    let path = `${folder}/${file}.json`
    for (let n = 2; used.has(path.toLowerCase()); n++) path = `${folder}/${file}-${n}.json`
    this.model.paths[id] = path
    return path
  }
}

// ── Edits ────────────────────────────────────────────────────────────────

export interface EditDef<S extends z.ZodType = z.ZodType> {
  input: S
  /** Reads the model only: no change set. */
  readOnly?: boolean
  apply: (draft: Draft, input: z.infer<S>) => Record<string, unknown>
}

export const defineEdit = <S extends z.ZodType>(def: EditDef<S>): EditDef<S> => def

/** The first problems as one sentence for the user: what is wrong and in which file. */
const problemsText = (problems: ModelProblem[]): string => {
  const shown = problems.slice(0, 3).map(problem => `${problem.message} (${problem.path})`).join('; ')
  return problems.length > 3 ? `${shown}; and ${problems.length - 3} more` : shown
}

/**
 * The generator's error for `model` (as a problem of the file it names), or undefined when it generates. A model that
 * generates two files at one path (a sync would refuse it: "Generated twice"), or an action named like something the
 * generated code declares, is one the generator can't build either.
 */
const generationProblem = (model: Model): ModelProblem | undefined => {
  try {
    // Paths are compared ignoring case, as Draft.place does for model files: two that differ only by case are one file on a case-insensitive file system.
    const seen = new Map<string, string | undefined>()
    for (const file of generate(model)) {
      const key = file.path.toLowerCase()
      if (seen.has(key)) {
        const other = seen.get(key)
        const sources = [file.source, other].filter((source): source is string => source !== undefined)
        return { path: sources[0] ?? MANIFEST_FILE, message: `${sources.join(' and ') || 'Two files'} would both generate ${file.path}: one of the names or routes has to change` }
      }
      seen.set(key, file.source)
    }
    for (const module of Object.keys(model.modules)) {
      for (const action of model.modules[module]!.actions) {
        const problem = actionNameProblem(model, module, action.name)
        if (problem) return { path: model.paths[action.id] ?? MANIFEST_FILE, message: `${model.paths[action.id] ?? action.id}: ${problem}` }
      }
      for (const query of model.modules[module]!.queries) {
        const problem = queryNameProblem(query.name)
        if (problem) return { path: model.paths[query.id] ?? MANIFEST_FILE, message: `${model.paths[query.id] ?? query.id}: ${problem}` }
      }
    }
    return undefined
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const file = /^(\.bildr\/[^\s:]+)/.exec(message)?.[1]
    return { path: file ?? MANIFEST_FILE, message }
  }
}

const changed = (before: Record<string, string>, after: Record<string, string>): string[] => {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...paths].filter(path => path !== MANIFEST_FILE && before[path] !== after[path]).sort()
}

/**
 * Runs `def` on the model of `files` (path → text) and returns what to write.
 * Only the files whose canonical form the edit changed are in the change set;
 * the whole model must still load, or its problems come back instead.
 */
export const runEdit = (files: Record<string, string>, def: EditDef, rawInput: unknown): EditOutcome => {
  const parsed = def.input.safeParse(rawInput ?? {})
  if (!parsed.success) return { ok: false, code: 'invalid_input', message: z.prettifyError(parsed.error) }
  const loaded = loadModel(files)
  if (!loaded.ok) return { ok: false, code: 'invalid', message: 'The model has problems: fix them before editing', problems: loaded.problems }
  const draft = new Draft(structuredClone(loaded.model))
  let result: Record<string, unknown>
  try {
    result = def.apply(draft, parsed.data)
  } catch (error) {
    if (error instanceof EditError) return { ok: false, code: error.code, message: error.message }
    throw error
  }
  if (def.readOnly) return { ok: true, changes: [], result }
  const paths = changed(serializeModel(loaded.model), serializeModel(draft.model))
  const after = serializeModel(draft.model)
  const next = { ...files }
  for (const path of paths) {
    if (after[path] === undefined) Reflect.deleteProperty(next, path)
    else next[path] = after[path]
  }
  const check = loadModel(next)
  if (!check.ok) return { ok: false, code: 'invalid', message: `The edit would leave the model with problems: ${problemsText(check.problems)}`, problems: check.problems }
  const broken = generationProblem(check.model)
  // Only an edit that breaks generation is refused: a model that already failed to generate can still be edited.
  if (broken && !generationProblem(loaded.model)) return { ok: false, code: 'invalid', message: `The edit would leave a model the generator can't build: ${broken.message}`, problems: [broken] }
  // The canonical form is the loaded one (schema key order), as a saved file has.
  const canonical = serializeModel(check.model)
  return { ok: true, changes: paths.map(path => ({ path, content: after[path] === undefined ? null : canonical[path]! })), result }
}
