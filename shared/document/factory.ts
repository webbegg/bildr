import { defaultTheme } from '../design/theme'
import { getComponent, PAGE_ROOT_TYPE } from './components'
import type { PropValue } from './components'
import type { DocNode, Page, Project } from './schema'

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return `${prefix}_${Array.from(bytes, b => ID_ALPHABET[b % ID_ALPHABET.length]).join('')}`
}

export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return slug || 'page'
}

/** A node of a palette component with its default props and style. */
export function createNode(type: string, props: Record<string, PropValue> = {}): DocNode {
  const def = getComponent(type)
  if (!def) throw new Error(`Unknown component type "${type}"`)
  const defaults = Object.fromEntries(def.props.map(p => [p.name, p.default]))
  return { id: newId('n'), type, props: { ...defaults, ...props }, style: { ...def.defaultStyle }, children: [] }
}

export function createPage(name: string, slug = slugify(name)): Page {
  return {
    id: newId('p'),
    name,
    slug,
    root: { id: newId('n'), type: PAGE_ROOT_TYPE, props: {}, style: { p: '6', gap: '4' }, children: [] }
  }
}

export function createProject(name: string): Project {
  const now = new Date().toISOString()
  return {
    id: newId('prj'),
    name,
    slug: slugify(name),
    version: 0,
    pages: [createPage('Home')],
    theme: defaultTheme(),
    createdAt: now,
    updatedAt: now
  }
}

/** Deep copy of `node` where it and every descendant get a fresh id. */
export function cloneWithNewIds(node: DocNode): DocNode {
  return { ...structuredClone(node), id: newId('n'), children: node.children.map(cloneWithNewIds) }
}
