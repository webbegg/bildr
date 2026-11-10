import { INSTANCE_TYPE } from './components'
import type { TreeRef } from './operations'
import type { DocNode, Project } from './schema'

/** One Instance of a component: the tree it is in, its node id, and where that is, for messages. */
export type ComponentUsage = TreeRef & { nodeId: string, where: string }

/**
 * Every Instance of component `componentId` on the pages and in the other
 * definitions, in document order, with its node and whether it sits inside
 * another instance of the same component (in that one's slot content).
 */
export function componentInstances(project: Project, componentId: string): (ComponentUsage & { node: DocNode, nested: boolean })[] {
  const found: (ComponentUsage & { node: DocNode, nested: boolean })[] = []
  const visit = (node: DocNode, ref: TreeRef, where: string, nested: boolean) => {
    const match = node.type === INSTANCE_TYPE && node.props.component === componentId
    if (match) found.push({ ...ref, nodeId: node.id, where, node, nested })
    node.children.forEach(child => visit(child, ref, where, nested || match))
  }
  for (const page of project.pages) visit(page.root, { pageId: page.id }, `page "${page.name}"`, false)
  for (const def of project.components) {
    if (def.id !== componentId) visit(def.root, { componentId: def.id }, `component "${def.name}"`, false)
  }
  return found
}

/**
 * Where component `componentId` is used: its instances, leaving out the ones
 * inside another instance of it, which go with the outer one.
 */
export function componentUsages(project: Project, componentId: string): ComponentUsage[] {
  return componentInstances(project, componentId)
    .filter(instance => !instance.nested)
    .map(({ node: _node, nested: _nested, ...usage }) => usage as ComponentUsage)
}
