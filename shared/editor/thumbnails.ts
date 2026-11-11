/**
 * The Insert panel's thumbnails: a small static render of a component
 * definition or a layout, made by the canvas renderer at a device width and
 * scaled into the tile. Pure parts: what to render, the signature that
 * keys the cache (it changes exactly when the render would), the fit into a
 * tile, and a small LRU cache.
 */
import { INSTANCE_TYPE, PAGE_ROOT_TYPE } from '../document/components'
import type { ComponentDefinition, Page, Project } from '../document/schema'
import { walk } from '../document/tree'
import type { Theme } from '../design/theme'
import type { Rect } from './viewport'
import { DEVICES } from './styleFields'

export type ThumbnailKind = 'component' | 'layout'

export interface ThumbnailSource {
  /** The page the canvas renders (no layout around it): a layout's tree, or a page holding the component's definition. */
  page: Page
  /** The node whose box the thumbnail shows: the definition root (at its natural size), or the layout root. */
  measureId: string
  /** The definitions its instances render from, nested ones included, in project order. */
  components: ComponentDefinition[]
  /** The canvas width it renders at: Mobile for components, Desktop for layouts. */
  width: number
}

const widthOf = (id: string) => DEVICES.find(d => d.id === id)!.width

/** The components `root` uses, directly or through other components, in project order. */
function usedComponents(project: Pick<Project, 'components'>, root: Page['root']): ComponentDefinition[] {
  const used = new Set<string>()
  const visit = (node: Page['root']) => walk(node, (child) => {
    const id = child.type === INSTANCE_TYPE ? String(child.props.component ?? '') : ''
    const def = id && !used.has(id) ? project.components.find(c => c.id === id) : undefined
    if (!def) return
    used.add(id)
    visit(def.root)
  })
  visit(root)
  return project.components.filter(c => used.has(c.id))
}

/** What the thumbnail of component or layout `id` renders; null when it does not exist. */
export function thumbnailSource(project: Pick<Project, 'components' | 'layouts'>, kind: ThumbnailKind, id: string): ThumbnailSource | null {
  const item = kind === 'component' ? project.components.find(c => c.id === id) : project.layouts.find(l => l.id === id)
  if (!item) return null
  // A definition root as the page root would stretch to the frame; inside a page it keeps its own size.
  const root = kind === 'layout' ? item.root : { id: `${item.id}-thumbnail`, type: PAGE_ROOT_TYPE, props: {}, style: { items: 'start', color: 'default' }, children: [item.root] }
  return {
    page: { id: item.id, name: item.name, slug: '', root },
    measureId: item.root.id,
    components: usedComponents(project, item.root),
    width: widthOf(kind === 'component' ? 'mobile' : 'desktop')
  }
}

/** FNV-1a over a string, as 8 hex digits. */
function hash(text: string): string {
  let h = 0x811C9DC5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** The cache key of a thumbnail: everything its render depends on (the tree, the definitions it uses, the theme and the dark preview). */
export function thumbnailSignature(source: ThumbnailSource, theme: Theme, dark: boolean): string {
  const text = JSON.stringify([source.page.root, source.components, theme, dark, source.width])
  return `${source.page.id}:${hash(text)}:${text.length}`
}

/** How a rendered `box` (canvas px) fits in `tile`: scaled down to fit whole, never up, and centred; x/y are the offset of the render's origin. */
export function thumbnailFit(box: Rect, tile: { width: number, height: number }): { scale: number, x: number, y: number } {
  if (!box.width || !box.height) return { scale: 1, x: 0, y: 0 }
  const scale = Math.min(1, tile.width / box.width, tile.height / box.height)
  return { scale, x: (tile.width - box.width * scale) / 2 - box.x * scale, y: (tile.height - box.height * scale) / 2 - box.y * scale }
}

/**
 * A limiter of at most `max` holders at a time: the returned function
 * resolves with a release once a slot is free, the waiting ones first come
 * first served. Releasing twice frees one slot.
 */
export function createLimiter(max: number): () => Promise<() => void> {
  let holders = 0
  const waiting: (() => void)[] = []
  return () => new Promise((resolve) => {
    const start = () => {
      holders++
      let released = false
      resolve(() => {
        if (released) return
        released = true
        holders--
        waiting.shift()?.()
      })
    }
    if (holders < max) start()
    else waiting.push(start)
  })
}

/** A rendered thumbnail: the canvas document as static HTML, the rendered root's box and the width it rendered at. */
export interface ThumbnailSnapshot { html: string, box: Rect, width: number }

/** A least-recently-used cache of at most `max` entries. */
export class ThumbnailCache<T> {
  private readonly entries = new Map<string, T>()
  constructor(private readonly max = 100) {}

  get(key: string): T | undefined {
    const value = this.entries.get(key)
    if (value === undefined) return undefined
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  set(key: string, value: T): void {
    this.entries.delete(key)
    this.entries.set(key, value)
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!)
  }
}

/** The editor session's thumbnails by signature: a reopened Insert panel shows them at once, and any change renders again. */
export const thumbnailSnapshots = new ThumbnailCache<ThumbnailSnapshot>(120)

/** Live thumbnail renders each boot a canvas: two at a time. */
export const thumbnailRenderSlot = createLimiter(2)
