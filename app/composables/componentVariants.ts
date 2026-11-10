import type { PropValue } from '#shared/document/components'
import type { ComponentDefinition, DocNode, Variant } from '#shared/document/schema'

/**
 * The variants UI's pure parts. The primary variant is the definition
 * itself; a variant stores only the props and design tokens it overrides,
 * per definition node, and a null value removes an override (so a reset
 * keeps the variant sparse). The component view shows the definition with
 * the active variant applied, ids unchanged, so the canvas, the layers and
 * the panel work on the same nodes in every variant.
 */

export type OverrideKind = 'props' | 'style'

export interface OverrideEntry {
  kind: OverrideKind
  key: string
  value: PropValue
}

/** The `<USelect>` value of the primary variant (select items cannot be empty). */
export const PRIMARY_VARIANT = '__primary'

/** The definition tree as `variant` renders it, with the definition's ids; the primary (null) is `root` itself. */
export function applyVariant(root: DocNode, variant: Variant | null): DocNode {
  if (!variant) return root
  const build = (node: DocNode): DocNode => {
    const override = variant.overrides[node.id]
    return {
      ...node,
      props: { ...node.props, ...override?.props },
      style: { ...node.style, ...override?.style },
      children: node.children.map(build)
    }
  }
  return build(root)
}

/** What `variant` overrides on one node: props, then design tokens. */
export function overrideEntries(variant: Variant | null, nodeId: string): OverrideEntry[] {
  const override = variant?.overrides[nodeId]
  return [
    ...Object.entries(override?.props ?? {}).map(([key, value]): OverrideEntry => ({ kind: 'props', key, value })),
    ...Object.entries(override?.style ?? {}).map(([key, value]): OverrideEntry => ({ kind: 'style', key, value }))
  ]
}

export function isOverridden(variant: Variant | null, nodeId: string, kind: OverrideKind, key: string): boolean {
  return !!variant?.overrides[nodeId]?.[kind] && key in variant.overrides[nodeId][kind]
}

/** The `component_variant_set_override` patch that removes `entries`. */
export function resetOverrides(entries: OverrideEntry[]): { props?: Record<string, null>, style?: Record<string, null> } {
  const patch: { props?: Record<string, null>, style?: Record<string, null> } = {}
  for (const { kind, key } of entries) patch[kind] = { ...patch[kind], [key]: null }
  return patch
}

/** The variant `variantId` of `def`; null for the primary, or for a variant that no longer exists. */
export function activeVariant(def: ComponentDefinition | null, variantId: string | null): Variant | null {
  return (variantId && def?.variants.find(v => v.id === variantId)) || null
}

/** The variant choices of an instance: Primary, then each variant. */
export function variantItems(def: ComponentDefinition): { label: string, value: string }[] {
  return [{ label: 'Primary', value: PRIMARY_VARIANT }, ...def.variants.map(v => ({ label: v.name, value: v.id }))]
}

/** The `instance_set_values` variant for a chosen item: `''` for the primary. */
export function instanceVariantValue(item: string): string {
  return item === PRIMARY_VARIANT ? '' : item
}

/** `Variant N`, N one more than the variants there are, or the next free number. */
export function newVariantName(def: ComponentDefinition): string {
  const taken = new Set(def.variants.map(v => v.name))
  let n = def.variants.length + 1
  while (taken.has(`Variant ${n}`)) n++
  return `Variant ${n}`
}
