/**
 * Component and layout names: unique in the project, ignoring case (`Card`
 * and `card` are one name), as Framer's. The creation dialog and the server
 * (`component_create`, `component_rename`, `layout_create`, `layout_rename`)
 * share these checks, so the dialog never offers what the server refuses.
 */

interface Named {
  id?: string
  name: string
}

const key = (name: string) => name.trim().toLowerCase()

/** Why `name` can't name a new component or layout (or `exceptId` renamed), or '' when it can. */
export function nameProblem(name: string, items: readonly Named[], noun: 'component' | 'layout', exceptId?: string): string {
  if (!name.trim()) return `Give the ${noun} a name`
  const taken = items.find(item => item.id !== exceptId && key(item.name) === key(name))
  return taken ? `A ${noun} named "${taken.name}" already exists` : ''
}

/** `base`, or `base 2`, `base 3`… when that name is taken in any case. */
export function uniqueName(base: string, items: readonly Named[]): string {
  const taken = new Set(items.map(item => key(item.name)))
  let name = base
  for (let n = 2; taken.has(key(name)); n++) name = `${base} ${n}`
  return name
}

/** The "New component" name: the one selected layer's name (its type when unnamed), "Component" for several; never one already used. */
export function componentPrefill(layerNames: readonly string[], components: readonly Named[]): string {
  return uniqueName(layerNames.length === 1 ? layerNames[0]! : 'Component', components)
}
