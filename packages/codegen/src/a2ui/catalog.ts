import type { ComponentFile, PropertyDef } from '../model/schemas.ts'
import { A2UI_VERSION } from './wire.ts'

/**
 * A project's components as an A2UI v1.0 catalog (`specification/v1_0/json/catalog_definition.json`):
 * one JSON Schema per component, its properties typed with the standard
 * `common_types.json` definitions, so an agent can compose the app's own design
 * system on an A2UI surface.
 */

export interface A2uiCatalog {
  catalogId: string
  protocolVersion: typeof A2UI_VERSION
  title?: string
  instructions: string
  components: Record<string, A2uiComponentSchema>
}

export interface A2uiComponentSchema {
  type: 'object'
  description?: string
  properties: Record<string, Record<string, unknown>>
  required: string[]
}

export interface CatalogOptions {
  /** The catalog's id: a URL or domain the project owns, like `https://example.com/a2ui/catalog/v1`. */
  catalogId: string
  title?: string
}

const ref = (type: string) => `common_types.json#/$defs/${type}`
const KIND_HINT: Partial<Record<PropertyDef['kind'], string>> = { image: 'An image URL', link: 'A URL or a path', icon: 'An icon name' }

/** `ent_blog_post` → `BlogPost`. */
const entityName = (id: string) => id.replace(/^[a-z]+_/, '').split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')

const propertySchema = (property: PropertyDef): Record<string, unknown> => {
  const described = (schema: Record<string, unknown>, fallback?: string) => {
    const description = property.description ?? property.label ?? fallback
    return description ? { ...schema, description } : schema
  }
  switch (property.kind) {
    case 'number':
      return described({ $ref: ref('DynamicNumber') })
    case 'boolean':
      return described({ $ref: ref('DynamicBoolean') })
    case 'select':
      return described({ type: 'string', enum: property.options ?? [] })
    case 'slot':
      return described({ $ref: ref('ChildList') })
    case 'field':
      return described({ type: 'string' }, 'A field name')
    case 'entity': {
      const name = property.entity ? entityName(property.entity) : 'record'
      const what = property.many ? `A list of ${name}` : `A ${name}`
      return described({ $ref: ref('DataBinding') }, property.pick?.length ? `${what}: ${property.pick.join(', ')}` : what)
    }
    default:
      return described({ $ref: ref('DynamicString') }, KIND_HINT[property.kind])
  }
}

export const componentCatalog = (components: readonly ComponentFile[], options: CatalogOptions): A2uiCatalog => {
  const entries = Object.fromEntries(components.map(component => [component.name, {
    type: 'object' as const,
    properties: {
      component: { const: component.name },
      ...Object.fromEntries(component.properties.map(property => [property.name, propertySchema(property)]))
    },
    required: ['component', ...component.properties.filter(property => property.required).map(property => property.name)]
  }]))
  const lines = components.map((component) => {
    const props = component.properties.map(property => `\`${property.name}\`${property.required ? ' (required)' : ''}`).join(', ')
    return `- **${component.name}**${props ? `: ${props}` : ''}`
  })
  return {
    catalogId: options.catalogId,
    protocolVersion: A2UI_VERSION,
    ...(options.title ? { title: options.title } : {}),
    instructions: ['The app\'s own components. Prefer them over generic layouts when one fits.', '', ...lines].join('\n'),
    components: entries
  }
}
