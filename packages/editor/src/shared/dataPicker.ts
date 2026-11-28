import { bindingPaths } from '@bildr/codegen/edit'
import type { ScopeName } from '@bildr/codegen/edit'
import type { PageDataOffer } from './pageDataOffers.ts'

/**
 * What the Insert variable popover (EditorVariablePicker) lists, in two levels so a page with many APIs, stores and nested models
 * stays readable: first the sources (what the page reads, then its module's stores and the API queries it doesn't use yet), then the
 * fields of the one picked, a nested model or a list as a level of its own. Searching lists every field at once (`leaves`).
 */
export interface PickerField {
  /** The field's own name (`city` of `address.city`). */
  label: string
  /** What `{…}` reads, for a field a text shows; none for a nested model or a list, which open their fields. */
  path?: string
  children?: PickerField[]
}

export interface PickerSource {
  /** `page:<name>`, or the offer's `store:<id>` / `api:<datasource>:<query>`. */
  id: string
  group: 'page' | 'store' | 'api'
  label: string
  /** What it is: "Query", "The site", "Store, added to this page"… */
  description: string
  /** The name `{…}` reads it under (the store or query's, for one the page doesn't use yet). */
  alias: string
  fields: PickerField[]
  /** Every path a text can insert from it, for search. */
  leaves: string[]
  /** The page's use to add first, for a source the page doesn't use yet. */
  offer?: PageDataOffer
  /** The required parameters the page can't give by itself: the source can't be picked from here. */
  missing: string[]
}

const SCOPE_WORDS: Record<ScopeName['source'], string> = {
  item: 'Item of a List', query: 'Query', state: 'Store', action: 'Action', computed: 'Computed value', prop: 'Property', layout: 'Layout variable', site: 'The site'
}
const OFFER_WORDS: Record<PageDataOffer['source'], string> = { store: 'Store, added to this page', api: 'API, added to this page' }

/**
 * The fields under `alias` as a tree: `alias.address.city` is `address` › `city`. A path with paths below it (a nested model, a list
 * and its `length`) only opens them, since a text can't show a record or a list. A lone `alias` (a value with no fields) is one leaf.
 */
export function fieldTree(alias: string, paths: readonly string[]): PickerField[] {
  const roots: PickerField[] = []
  const below = (path: string) => paths.some(other => other.startsWith(`${path}.`))
  for (const path of paths) {
    if (path === alias) {
      roots.push({ label: alias, path })
      continue
    }
    if (!path.startsWith(`${alias}.`) || below(path)) continue
    let level = roots
    const parts = path.slice(alias.length + 1).split('.')
    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        level.push({ label: part, path })
        return
      }
      let node = level.find(entry => entry.label === part && entry.children)
      if (!node) level.push(node = { label: part, children: [] })
      level = node.children!
    })
  }
  return roots
}

/** Every path of a tree a text can insert, depth first. */
const leavesOf = (fields: readonly PickerField[]): string[] => fields.flatMap(field => (field.children ? leavesOf(field.children) : field.path ? [field.path] : []))

/** The sources a text can read: the names in `scope` first, then the `offers` the page doesn't use yet; a source with nothing to show is left out. */
export function pickerSources(scope: readonly ScopeName[], offers: readonly PageDataOffer[] = []): PickerSource[] {
  const own = scope.map((entry): PickerSource => {
    const fields = fieldTree(entry.name, bindingPaths([entry], { leaves: true }))
    return { id: `page:${entry.name}`, group: 'page', label: entry.name, description: SCOPE_WORDS[entry.source], alias: entry.name, fields, leaves: leavesOf(fields), missing: [] }
  })
  const offered = offers.map((offer): PickerSource => {
    const fields = fieldTree(offer.use.as, offer.paths)
    const id = 'state' in offer.use ? `store:${offer.use.state}` : `api:${offer.use.api.datasource}:${offer.use.api.query}`
    return { id, group: offer.source, label: offer.label, description: OFFER_WORDS[offer.source], alias: offer.use.as, fields, leaves: leavesOf(fields), offer, missing: offer.missing }
  })
  return [...own, ...offered].filter(source => source.leaves.length)
}
