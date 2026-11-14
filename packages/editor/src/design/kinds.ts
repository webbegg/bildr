import type { ComponentFile, LayoutFile, PropertyDef, Transition } from '@bildr/codegen/model'

/**
 * The model's enumerations the component and layout panels offer. The model's
 * zod schemas hold them too, but the editor bundle only takes the types from
 * `@bildr/codegen/model`; these are checked against them by the compiler
 * (and the tests compare them with the schemas').
 */

type Variant = ComponentFile['variants'][number]
type Interaction = NonNullable<Variant['interactions']>[number]

export const PROPERTY_KINDS: readonly PropertyDef['kind'][] = ['text', 'textarea', 'number', 'boolean', 'select', 'image', 'link', 'icon', 'entity', 'field', 'slot']
export const LAYOUT_VARIABLE_KINDS: readonly NonNullable<LayoutFile['variables']>[number]['kind'][] = ['text', 'textarea', 'number', 'boolean', 'select', 'image', 'link', 'icon']
export const STATE_KINDS: readonly NonNullable<Variant['state']>['kind'][] = ['hover', 'pressed']
export const VARIANT_EVENTS: readonly Interaction['on'][] = ['click', 'mouseenter', 'mouseleave', 'appear']
export const TRANSITION_TYPES: readonly Transition['type'][] = ['instant', 'ease', 'spring']
export const TRANSITION_EASINGS: readonly NonNullable<Transition['easing']>[] = ['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear']
