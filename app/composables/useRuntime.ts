import type { InjectionKey } from 'vue'
import type { DataRecord } from '#shared/data/records'
import type { BindingItem } from '#shared/runtime/bindings'

export interface RuntimeContext {
  /** Path prefix that page-slug links resolve under, e.g. `/p/shop`. */
  base: string
  /** True inside the editor canvas: links don't navigate, empty containers show a drop hint. */
  editable: boolean
  /**
   * Records per List query (`listKey`). A query without an entry has no known
   * collection: the canvas shows a hint, published apps render nothing.
   */
  lists: Record<string, DataRecord[]>
}

export const RUNTIME_KEY: InjectionKey<RuntimeContext> = Symbol('bildr-runtime')

export function useRuntime(): RuntimeContext {
  return inject(RUNTIME_KEY, { base: '', editable: false, lists: {} })
}

/** One repetition of a List's children. The innermost List's item shadows outer ones. */
export interface ListItemContext {
  /** The record, or null for the canvas placeholder of an empty collection. */
  item: BindingItem | null
  /** True for every repetition but the first; the canvas keeps outlines and drops on the first. */
  copy: boolean
}

export const LIST_ITEM_KEY: InjectionKey<ListItemContext> = Symbol('bildr-list-item')

export function useListItem(): ListItemContext | undefined {
  return inject(LIST_ITEM_KEY, undefined)
}
