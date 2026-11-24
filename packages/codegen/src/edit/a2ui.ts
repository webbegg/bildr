import { z } from 'zod'
import { checkSurface, fromA2ui } from '../a2ui/index.ts'
import type { A2uiComponent, A2uiImportWarning } from '../a2ui/index.ts'
import { LocalIdSchema } from '../model/schemas.ts'
import type { ModelNode, PageFile } from '../model/schemas.ts'
import { defineEdit, EditError, fail } from './core.ts'
import type { Draft, Tree } from './core.ts'
import { normalizeLayout } from './convert.ts'
import { contains } from './instances.ts'
import { addInteraction } from './interactions.ts'
import { FileRef, nodeInsert } from './nodes.ts'
import type { NodeSpec } from './nodes.ts'
import { findNode } from './tree.ts'

/**
 * `node_insert_a2ui`: an A2UI v1.0 surface (what an agent speaking A2UI composes) inserted as one node of a tree. The surface's
 * Basic Catalog components become bildr nodes and the project's components Instances (`fromA2ui`); it goes in as `node_insert`
 * with `exact` (fresh ids, no palette defaults), then each click is added as `node_interaction_add` adds one. What bildr can't
 * hold, and a click the page can't run, is left out and comes back in `warnings`; a surface a renderer would refuse is refused.
 */

const SurfaceComponentSchema = z.looseObject({
  id: z.string().min(1).describe('The component id, unique in the surface; one is "root"'),
  component: z.string().min(1).describe('A Basic Catalog type (Column, Row, Card, Text, Image, Button, List, TextField, CheckBox) or a project component\'s name')
})

/** A tree without its interactions (they go in once the nodes exist), and the interactions by path of child indexes. */
const split = (node: ModelNode, path: number[] = [], out: Array<{ path: number[], interactions: NonNullable<ModelNode['interactions']> }> = []) => {
  const { id: _id, interactions, children, ...rest } = node
  if (interactions?.length) out.push({ path, interactions })
  const spec: NodeSpec = { ...rest, ...(children?.length ? { children: children.map((child, index) => split(child, [...path, index], out).spec) } : {}) }
  return { spec, interactions: out }
}

const normalizeTree = (node: ModelNode): ModelNode => ({ ...normalizeLayout(node), ...(node.children ? { children: node.children.map(normalizeTree) } : {}) })

const at = (root: ModelNode, path: number[]): ModelNode => path.reduce((node, index) => node.children![index]!, root)

/**
 * The components an Instance may name (in a component's tree, none that is it or contains it: that would be a cycle), the
 * names left out for that, and the actions a page's clicks may run.
 */
const vocabulary = (draft: Draft, tree: Tree) => {
  const modules = tree.module ? [draft.model.modules[tree.module]!] : Object.values(draft.model.modules)
  const cyclic = (id: string) => tree.kind === 'component' && (id === tree.file || contains(draft, id, tree.file))
  const all = modules.flatMap(mod => mod.components)
  return {
    components: all.filter(component => !cyclic(component.id)),
    cyclic: new Set(all.filter(component => cyclic(component.id)).map(component => component.name)),
    actions: tree.kind === 'page' ? modules.flatMap(mod => mod.actions.map(action => action.id)) : []
  }
}

export const nodeInsertA2ui = defineEdit({
  input: z.object({
    file: FileRef,
    parentId: LocalIdSchema.optional().describe('The container to insert into; defaults to the tree root'),
    index: z.int().nonnegative().optional().describe('Position among its children; defaults to the end'),
    components: z.array(SurfaceComponentSchema).min(1).max(500).describe('The surface\'s flat component list, as createSurface/updateComponents carry it (A2UI v1.0)')
  }),
  apply: (draft, { file, parentId, index, components }) => {
    const surface = components as A2uiComponent[]
    const errors = checkSurface(surface)
    if (errors.length) fail('invalid', `Not a valid A2UI surface: ${errors.slice(0, 3).map(error => error.message).join('; ')}`)
    const tree = draft.tree(file)
    const { cyclic, ...known } = vocabulary(draft, tree)
    const { root, warnings: mapped } = fromA2ui(surface, known)
    const byId = new Map(surface.map(component => [component.id, component.component]))
    const warnings = mapped.map((warning) => {
      const name = byId.get(warning.componentId)
      return name && cyclic.has(name) ? { ...warning, message: `${name} cannot contain itself: left out` } : warning
    })
    // New nodes are Containers (layout-containers): fromA2ui's Row, Column and Card go in converted.
    const { spec, interactions } = split(normalizeTree(root))
    const { nodeId } = nodeInsert.apply(draft, { file, parentId, index, exact: true, ...spec }) as { nodeId: string }
    const inserted = findNode(tree.root, nodeId)!
    const left: A2uiImportWarning[] = []
    for (const entry of interactions) {
      const node = at(inserted, entry.path)
      for (const interaction of entry.interactions) {
        const page = tree.kind === 'page' ? tree.owner as PageFile : undefined
        const uses = page && structuredClone(page.uses)
        const had = node.interactions && structuredClone(node.interactions)
        try {
          addInteraction(draft, tree, node, interaction.on, interaction.do as Array<Record<string, unknown>>)
        } catch (error) {
          if (!(error instanceof EditError)) throw error
          // Put back what the refused steps had made the page use, so nothing stays behind.
          if (page) {
            if (uses) page.uses = uses
            else delete page.uses
          }
          if (had) node.interactions = had
          else delete node.interactions
          left.push({ componentId: sourceId(root, entry.path), message: `${interaction.on} left out: ${error.message}` })
        }
      }
    }
    return { nodeId, warnings: [...warnings, ...left] }
  }
})

/** The surface id of the node at `path` (fromA2ui keeps surface ids). */
const sourceId = (root: ModelNode, path: number[]) => at(root, path).id
