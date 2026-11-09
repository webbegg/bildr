import type { DocNode } from '../document/schema'
import { containsNode, findNode, findParent, pathTo } from '../document/tree'

/** What to select after deleting node `id`: next sibling, else previous, else the parent. */
export function selectionAfterDelete(root: DocNode, id: string): string | null {
  const location = findParent(root, id)
  if (!location) return null
  const { parent, index } = location
  return parent.children[index + 1]?.id ?? parent.children[index - 1]?.id ?? parent.id
}

/** The ancestors of node `id`, from the page root down, for the inspector breadcrumb. */
export function breadcrumb(root: DocNode, id: string): { id: string, type: string }[] {
  return pathTo(root, id).slice(0, -1).map(ancestor => ({ id: ancestor, type: findNode(root, ancestor)!.type }))
}

/**
 * What a canvas click on `clickedId` selects. Deep mode (Cmd/Ctrl+click, or
 * the Deep select setting) selects the clicked element itself. Otherwise, as
 * in Figma: inside a selected ancestor the click selects that ancestor's
 * child toward the element (so a double-click drills one level per click);
 * inside a sibling of a selected node it selects at the same depth; else it
 * selects the page root's top-level child that holds the element.
 */
export function drillTarget(root: DocNode, selectedIds: readonly string[], clickedId: string, { deep }: { deep: boolean }): string | null {
  const path = pathTo(root, clickedId)
  if (!path.length) return null
  if (deep) return clickedId
  const ancestor = Math.max(...selectedIds.map(id => path.indexOf(id)))
  if (ancestor >= 0) return path[ancestor + 1] ?? clickedId
  const level = Math.max(...selectedIds.map(id => path.indexOf(findParent(root, id)?.parent.id ?? '')))
  if (level >= 0) return path[level + 1] ?? clickedId
  return path[1] ?? root.id
}

/** Shift+click: adds `id` at the end (the new primary selection), or removes it. */
export function toggleSelection(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]
}

/** Cmd/Ctrl+A: every child of the primary (last) selection's parent; the page root's children with nothing or the root selected. */
export function selectAllSiblings(root: DocNode, ids: readonly string[]): string[] {
  const primary = ids.at(-1)
  const parent = primary ? findParent(root, primary)?.parent ?? root : root
  return parent.children.map(child => child.id)
}

export type SelectionStep = 'child' | 'parent' | 'next' | 'prev'

/** Enter (first child), Shift+Enter (parent), Tab / Shift+Tab (next / previous sibling, wrapping); null when there is none. */
export function navigateSelection(root: DocNode, id: string, step: SelectionStep): string | null {
  if (step === 'child') return findNode(root, id)?.children[0]?.id ?? null
  const location = findParent(root, id)
  if (!location) return null
  if (step === 'parent') return location.parent.id
  const siblings = location.parent.children
  return siblings[(location.index + (step === 'next' ? 1 : siblings.length - 1)) % siblings.length]!.id
}

/** The nodes a delete or duplicate acts on: known, not the root, once each, and not inside another selected node. */
export function topLevelSelection(root: DocNode, ids: readonly string[]): string[] {
  const known = [...new Set(ids)].filter(id => id !== root.id && findNode(root, id))
  return known.filter(id => !known.some(other => other !== id && containsNode(findNode(root, other)!, id)))
}

/** The parent shared by all `ids` (siblings only); undefined for none, the root, or nodes of different parents. */
export function siblingParent(root: DocNode, ids: readonly string[]): DocNode | undefined {
  const parents = ids.map(id => findParent(root, id)?.parent)
  const first = parents[0]
  return first && parents.every(parent => parent === first) ? first : undefined
}
