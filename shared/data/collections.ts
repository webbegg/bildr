import { slugify } from '../document/factory'

/** `name`, or `name 2`, `name 3`… : the first whose slug no collection has (slugs are unique). */
export function uniqueCollectionName(name: string, collections: readonly { slug: string }[]): string {
  const taken = new Set(collections.map(c => c.slug))
  let candidate = name
  for (let n = 2; taken.has(slugify(candidate)); n++) candidate = `${name} ${n}`
  return candidate
}
