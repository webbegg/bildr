/**
 * The Insert panel's thumbnails (the hosted `shared/editor/thumbnails.ts`, over the
 * model): a small static render of a component or a layout, made by the canvas
 * renderer at a device width and scaled into the tile. Pure parts: what to render,
 * the signature that keys the cache (it changes exactly when the render would), the
 * fit into a tile, and a small LRU cache.
 */
import type { Theme } from '@bildr/codegen/design'
import type { ComponentFile, LayoutFile, Model, ModelNode, PageFile } from '@bildr/codegen/model'
import { DEVICES } from '@bildr/editor-core/styleFields'
import type { Rect } from '@bildr/editor-core/viewport'

export type ThumbnailKind = 'component' | 'layout'

export interface ThumbnailSource {
  /** What the canvas renders: a page showing one instance of the component, or an empty page in the layout. */
  file: PageFile
  /** The layouts it renders in (the one layout, for a layout tile). */
  layouts: LayoutFile[]
  /** The node whose box the thumbnail shows: the component's instance, or the layout root. */
  measureId: string
  /** The components its instances render from, nested ones included, in model order. */
  components: ComponentFile[]
  /** The canvas width it renders at: Mobile for components, Desktop for layouts. */
  width: number
}

const widthOf = (id: string) => DEVICES.find(device => device.id === id)!.width

const walk = (node: ModelNode, visit: (node: ModelNode) => void) => {
  visit(node)
  node.children?.forEach(child => walk(child, visit))
}

/** The components `root` uses, directly or through other components, in model order. */
function usedComponents(all: readonly ComponentFile[], root: ModelNode): ComponentFile[] {
  const used = new Set<string>()
  const visit = (node: ModelNode) => walk(node, (child) => {
    const id = child.type === 'Instance' ? String(child.props?.component ?? '') : ''
    const component = id && !used.has(id) ? all.find(entry => entry.id === id) : undefined
    if (!component) return
    used.add(id)
    visit(component.root)
  })
  visit(root)
  return all.filter(entry => used.has(entry.id))
}

/** What the thumbnail of component or layout `id` renders; null when it does not exist. */
export function thumbnailSource(model: Pick<Model, 'modules' | 'layouts'>, kind: ThumbnailKind, id: string): ThumbnailSource | null {
  const components = Object.values(model.modules).flatMap(entry => entry.components)
  const item = kind === 'component' ? components.find(entry => entry.id === id) : model.layouts.find(entry => entry.id === id)
  if (!item) return null
  // An instance inside a page keeps its own size (a definition root as the page root would stretch to the frame).
  const instance: ModelNode = { id: `${item.id}-thumbnail`, type: 'Instance', props: { component: item.id } }
  const root: ModelNode = { id: `${item.id}-thumbnail-page`, type: 'Page', style: { items: 'start', color: 'default' }, children: kind === 'component' ? [instance] : [] }
  const file = { id: `${item.id}-thumbnail-file`, name: item.name, path: '/', ...(kind === 'layout' ? { layout: item.id } : {}), root } as PageFile
  return {
    file,
    layouts: kind === 'layout' ? [item as LayoutFile] : [],
    measureId: kind === 'component' ? instance.id : item.root.id,
    components: usedComponents(components, kind === 'component' ? instance : item.root),
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
  const text = JSON.stringify([source.file.root, source.layouts, source.components, theme, dark, source.width])
  return `${source.file.id}:${hash(text)}:${text.length}`
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
