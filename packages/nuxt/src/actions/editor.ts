import { lstatSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { ArtifactIdSchema, LocalIdSchema, loadModel } from '@bildr/codegen/model'
import type { ComponentFile, Model, ModelNode } from '@bildr/codegen/model'
import { readModelFiles, resolvesInside } from '../node/project.ts'
import { writeAtomically } from '../node/sync.ts'
import { ActionError, defineAction } from './define.ts'
import type { ActionDef } from './define.ts'

/**
 * Editor context (after the hosted `editor_*` actions): the editor reports
 * what the human looks at, agents read it, and `editor_navigate` names a
 * target for the editor to open. Kept in `.bildr/.cache/session.json` (V2:
 * the cache is the only place besides the model). Both reach open editors on
 * the event stream (P3b): `context` and `navigate` events.
 */

export const CONTEXT_FILE = '.bildr/.cache/session.json'

interface StoredContext {
  /** The page, component or layout the editor shows. */
  file: string
  nodeId: string | null
  /** With a component: the variant shown (`''` for the primary). */
  variant: string | null
  /** On a detail page: the key (the value of the field its route parameter matches) of the record the editor shows. */
  record?: string | null
  updatedAt: string
}

interface Shown {
  kind: 'page' | 'component' | 'layout'
  name: string
  root: ModelNode
  component?: ComponentFile
}

const loaded = (root: string): Model => {
  const result = loadModel(readModelFiles(root))
  if (!result.ok) throw new ActionError('invalid', 'The model has problems: fix them first', result.problems)
  return result.model
}

const shownIn = (model: Model, file: string): Shown | undefined => {
  for (const mod of Object.values(model.modules)) {
    const page = mod.pages.find(entry => entry.id === file)
    if (page) return { kind: 'page', name: page.name, root: page.root }
    const component = mod.components.find(entry => entry.id === file)
    if (component) return { kind: 'component', name: component.name, root: component.root, component }
  }
  const layout = model.layouts.find(entry => entry.id === file)
  return layout ? { kind: 'layout', name: layout.name, root: layout.root } : undefined
}

const findNode = (node: ModelNode, id: string): ModelNode | undefined => {
  if (node.id === id) return node
  for (const child of node.children ?? []) {
    const found = findNode(child, id)
    if (found) return found
  }
  return undefined
}

/** The tree `file` shows, checked with its node and variant. */
const target = (model: Model, file: string, nodeId: string | null | undefined, variant: string | null | undefined): Shown => {
  const shown = shownIn(model, file)
  if (!shown) throw new ActionError('not_found', `No page, component or layout "${file}"`)
  if (nodeId && !findNode(shown.root, nodeId)) throw new ActionError('not_found', `Node "${nodeId}" not found in ${file}`)
  if (variant !== undefined && variant !== null) {
    if (!shown.component) throw new ActionError('invalid_input', 'variant needs a component file')
    if (variant !== '' && !shown.component.variants.some(entry => entry.id === variant)) throw new ActionError('not_found', `${shown.component.name} has no variant "${variant}"`)
  }
  return shown
}

const readContext = (root: string): StoredContext | null => {
  const path = join(root, CONTEXT_FILE)
  try {
    if (!resolvesInside(root, path) || !lstatSync(path).isFile()) return null
    return JSON.parse(readFileSync(path, 'utf8')) as StoredContext
  } catch {
    return null
  }
}

const writeContext = (root: string, context: StoredContext) => {
  const cache = join(root, '.bildr/.cache')
  // Same boundary as the session token: a committed symlink can't send it elsewhere.
  if (!resolvesInside(root, cache)) throw new ActionError('forbidden', '.bildr/.cache resolves outside the project (symlink)')
  mkdirSync(cache, { recursive: true })
  const path = join(root, CONTEXT_FILE)
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw new ActionError('forbidden', `${CONTEXT_FILE} is a symlink`)
  writeAtomically(path, `${JSON.stringify(context, null, 2)}\n`)
}

const FileRef = ArtifactIdSchema.describe('The page, component or layout: its artifact id (pg_*, cmp_*, lay_*)')
const VariantRef = z.union([ArtifactIdSchema, z.literal('')]).nullable().optional().describe('With a component: the variant shown ("" for the primary)')

const editorContextSet = defineAction({
  name: 'editor_context_set',
  description: 'Record what the editor shows: the page, component or layout (file), the selected node (nodeId, null for none), for a component its variant and for a detail page the record picked (record). Called by the editor UI; stored in .bildr/.cache/session.json.',
  input: z.object({ file: FileRef, nodeId: LocalIdSchema.nullable(), variant: VariantRef, record: z.string().max(500).nullable().optional().describe('On a detail page: the key of the record shown (the value of the field its route parameter matches)') }),
  run: ({ file, nodeId, variant, record }, { root, events }) => {
    target(loaded(root), file, nodeId, variant)
    const context: StoredContext = { file, nodeId, variant: variant ?? null, ...(record ? { record } : {}), updatedAt: new Date().toISOString() }
    writeContext(root, context)
    events?.publish({ type: 'context', context })
    return context
  }
})

const editorContextGet = defineAction({
  name: 'editor_context_get',
  description: 'What the human sees in the editor: the file (page, component or layout) with its kind and name, the variant shown, and the selected node (id, type, name, props). Null before an editor reported anything.',
  input: z.object({}),
  readOnly: true,
  run: (_input, { root }) => {
    const context = readContext(root)
    if (!context) return null
    const shown = shownIn(loaded(root), context.file)
    const node = shown && context.nodeId ? findNode(shown.root, context.nodeId) : undefined
    return {
      ...context,
      kind: shown?.kind ?? null,
      name: shown?.name ?? null,
      selected: node ? { id: node.id, type: node.type, ...(node.name ? { name: node.name } : {}), props: node.props ?? {} } : null
    }
  }
})

const editorNavigate = defineAction({
  name: 'editor_navigate',
  description: 'Point the editor at a page, component (optionally a variant) or layout, and optionally a node to select. Checks the target, sends it to open editors (a navigate event on /__bildr/api/events) and returns it; changes no file.',
  input: z.object({ file: FileRef, nodeId: LocalIdSchema.optional(), variant: VariantRef }),
  readOnly: true,
  run: ({ file, nodeId, variant }, { root, events }) => {
    const shown = target(loaded(root), file, nodeId, variant)
    const navigated = { file, kind: shown.kind, nodeId: nodeId ?? null, variant: variant ?? null }
    events?.publish({ type: 'navigate', target: navigated })
    return navigated
  }
})

export const EDITOR_ACTIONS: readonly ActionDef[] = [editorContextSet, editorContextGet, editorNavigate] as ActionDef[]
