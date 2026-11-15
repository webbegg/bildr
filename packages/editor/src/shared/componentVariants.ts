import type { ComponentFile, Value } from '@bildr/codegen/model'

/**
 * The variants UI's pure parts the inspector reads (the hosted `composables/componentVariants.ts`,
 * over the model's variants). The primary variant is the component itself; a variant stores only
 * the props and design tokens it overrides, and the tokens it removes (`unset`), per definition
 * node, and a null value removes an override or a removal (so a reset keeps the variant sparse).
 * The component view shows the definition with the active variant applied, ids unchanged.
 */

type Variant = ComponentFile['variants'][number]

export type OverrideKind = 'props' | 'style'

export interface OverrideEntry {
  kind: OverrideKind
  key: string
  value: Value
  /** A token the variant removes (its value is empty). */
  removed?: true
}

/** What `variant` overrides on one node: props, then design tokens, then removed tokens (empty values). */
export function overrideEntries(variant: Variant | null, nodeId: string): OverrideEntry[] {
  const override = variant?.overrides[nodeId]
  return [
    ...Object.entries(override?.props ?? {}).map(([key, value]): OverrideEntry => ({ kind: 'props', key, value })),
    ...Object.entries(override?.style ?? {}).map(([key, value]): OverrideEntry => ({ kind: 'style', key, value })),
    ...(override?.unset ?? []).map((key): OverrideEntry => ({ kind: 'style', key, value: '', removed: true }))
  ]
}

/** Whether `variant` overrides prop (`kind` props) or style key `key` of the node: sets it, or for a token removes it. */
export function isOverridden(variant: Variant | null, nodeId: string, kind: OverrideKind, key: string): boolean {
  const override = variant?.overrides[nodeId]
  if (kind === 'style' && override?.unset?.includes(key)) return true
  return !!override?.[kind] && key in override[kind]
}

/** The `component_variant_set_override` patch that removes `entries`. */
export function resetOverrides(entries: OverrideEntry[]): { props?: Record<string, null>, style?: Record<string, null> } {
  const patch: { props?: Record<string, null>, style?: Record<string, null> } = {}
  for (const { kind, key } of entries) patch[kind] = { ...patch[kind], [key]: null }
  return patch
}
