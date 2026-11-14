import { z } from 'zod'
import { ThemeSchema } from '../design/theme.ts'
import { BREAKPOINT_BASES } from '../design/tokens.ts'

/**
 * The `.bildr/` model: one JSON file per artifact. The editor writes these
 * files and the generator reads them (see the codegen reference architecture,
 * §5). Pure zod: no Vue, Nitro or fs, so it runs in the editor, the module
 * and tests alike. Optional fields stay absent when unset, so a file
 * serializes back exactly as it was parsed.
 */

export const SCHEMA_URL = 'https://bildr.dev/schema'

/** Artifact ids: a kind prefix plus a name, for example `ent_post` or `q_featured_posts`. */
export const ArtifactIdSchema = z.string().regex(/^[a-z]+_[a-z0-9_]+$/, 'Use a kind prefix and lowercase letters, digits or underscores, like "ent_post"')
/** Node, slot and field-local ids. */
export const LocalIdSchema = z.string().regex(/^[\w-]{1,64}$/, 'Invalid id')
export const ModuleNameSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, 'Use lowercase letters, digits and dashes (kebab-case)')
export const PascalNameSchema = z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'Use PascalCase, like "BlogPost"')
export const CamelNameSchema = z.string().regex(/^[a-z][A-Za-z0-9]*$/, 'Use camelCase, like "featuredPosts"')
export const EnvNameSchema = z.string().regex(/^NUXT_[A-Z0-9_]+$/, 'Use an env var name starting with NUXT_, like NUXT_DATASOURCES_API_KEY')

const schemaField = { $schema: z.string().optional() }

/** Any JSON value. Expressions inside it are objects with one `$`-key (`$bind`, `$param`, …), checked in `load.ts`. */
export const ValueSchema = z.json()
export type Value = z.infer<typeof ValueSchema>

export const EXPRESSION_KEYS = ['$bind', '$param', '$input', '$route', '$form', '$now', '$var', '$event', '$template'] as const

/** A dot-separated path of identifiers (`post.title`): the only form an expression path takes, because generated code reads it as property access. */
export const PROPERTY_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/

/** Expressions whose string value is a path (`$template` holds `{path}` parts instead). */
export const PATH_EXPRESSIONS = ['$bind', '$param', '$input', '$route', '$form', '$var'] as const

// ── UI trees ────────────────────────────────────────────────────────────

export const INTERACTION_EVENTS = ['click', 'change', 'submit', 'mouseenter', 'mouseleave', 'appear'] as const
export const UI_STEP_KINDS = ['runAction', 'navigate', 'setState', 'toast', 'setVariant'] as const

/** A UI flow step. Business rules never live here; they belong to server actions. */
export const UiStepSchema = z.looseObject({ kind: z.enum(UI_STEP_KINDS) })
export const InteractionSchema = z.object({ on: z.enum(INTERACTION_EVENTS), do: z.array(UiStepSchema).min(1) })

export interface ModelNode {
  id: string
  type: string
  name?: string
  /** Locked on the canvas: editor metadata the generator ignores. */
  locked?: boolean
  props?: Record<string, Value>
  style?: Record<string, string>
  interactions?: Array<z.infer<typeof InteractionSchema>>
  children?: ModelNode[]
}

export const ModelNodeSchema: z.ZodType<ModelNode> = z.lazy(() => z.object({
  id: LocalIdSchema,
  type: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  locked: z.boolean().optional(),
  props: z.record(z.string(), ValueSchema).optional(),
  style: z.record(z.string(), z.string()).optional(),
  interactions: z.array(InteractionSchema).optional(),
  children: z.array(ModelNodeSchema).optional()
}))

// ── Project-level files ────────────────────────────────────────────────

export const ProjectFileSchema = z.object({
  ...schemaField,
  schemaVersion: z.int().min(1),
  generatorVersion: z.string().min(1),
  starterKit: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  defaultModule: ModuleNameSchema,
  modules: z.array(ModuleNameSchema),
  /** Which device the unprefixed style is for: `mobile` (absent; `sm:`/`md:`/`lg:` override wider) or `desktop` (`max-lg:`/`max-md:`/`max-sm:` override narrower). */
  breakpointBase: z.enum(BREAKPOINT_BASES).optional()
})

/** The editor's `Theme` (D11): the same palette colours, font, radius and spacing the canvas paints. */
export const ThemeFileSchema = ThemeSchema.extend(schemaField)

/**
 * Where a repository's rows live: `sqlite` (the app database), `rest` (a remote API) or
 * `memory` (the server process, seeded from the module fixtures at boot, never persisted).
 */
export const DATASOURCE_KINDS = ['sqlite', 'rest', 'memory'] as const

export const DataSourceFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: ModuleNameSchema,
  kind: z.enum(DATASOURCE_KINDS),
  /** Setting name → env var that holds its value at runtime. */
  env: z.record(CamelNameSchema, EnvNameSchema),
  /** Non-secret defaults written into runtimeConfig. */
  defaults: z.record(CamelNameSchema, z.string()).optional(),
  auth: z.object({ type: z.enum(['bearer', 'header']), secret: CamelNameSchema, header: z.string().optional() }).optional()
}).superRefine((source, ctx) => {
  if (source.kind === 'memory') {
    for (const key of ['defaults', 'auth'] as const) {
      if (source[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'A memory data source keeps its rows in the server process: it has no settings' })
    }
    if (Object.keys(source.env).length) ctx.addIssue({ code: 'custom', path: ['env'], message: 'A memory data source keeps its rows in the server process: it has no settings' })
  }
  const secret = source.auth?.secret
  if (!secret) return
  if (!source.env[secret]) ctx.addIssue({ code: 'custom', path: ['auth', 'secret'], message: `Secret "${secret}" needs an env var in "env"` })
  if (source.defaults && secret in source.defaults) {
    ctx.addIssue({ code: 'custom', path: ['defaults', secret], message: `"${secret}" is a secret: set it with ${source.env[secret] ?? 'an env var'}, never in the model` })
  }
})

// ── Component properties and layout variables ──────────────────────────

export const PROPERTY_KINDS = ['text', 'textarea', 'number', 'boolean', 'select', 'image', 'link', 'icon', 'entity', 'field', 'slot'] as const
/** The kinds a layout variable takes: plain values a page sets in `layoutValues`. */
export const LAYOUT_VARIABLE_KINDS = ['text', 'textarea', 'number', 'boolean', 'select', 'image', 'link', 'icon'] as const

/**
 * Which node prop a property drives (the hosted `bindings`); with `target: 'style'`,
 * `prop` is a style key of the node (`bg`, `md:p`) and the property's value is its token.
 * A slot property names its node with `nodeId` instead.
 */
export const PropertyBindingSchema = z.object({ nodeId: LocalIdSchema, prop: z.string().min(1).max(64), target: z.literal('style').optional() })

/**
 * A component property or layout variable. `label`, `description` (a tooltip),
 * `optional` (instances or pages may leave it empty) and `placeholder` only describe
 * it to the editor.
 */
export const PropertySchema = z.object({
  id: ArtifactIdSchema,
  name: CamelNameSchema,
  kind: z.enum(PROPERTY_KINDS),
  label: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  /** `select`: the values it takes, generated as a string-literal union. */
  options: z.array(z.string().min(1).max(100)).min(1).optional(),
  entity: ArtifactIdSchema.optional(),
  pick: z.array(CamelNameSchema).optional(),
  /** `entity`: a list of them (the instance binds it with `$bind`). */
  many: z.boolean().optional(),
  required: z.boolean().optional(),
  optional: z.boolean().optional(),
  placeholder: z.string().max(200).optional(),
  default: ValueSchema.optional(),
  /** A `slot` property: the node whose children an Instance's SlotFill replaces (they stay its default content). */
  nodeId: LocalIdSchema.optional(),
  bindings: z.array(PropertyBindingSchema).optional()
})

// ── Variants: states, interactions and transitions ─────────────────────

/** A variant id, or `''` for the primary variant (the component's own tree). */
export const VariantRefSchema = z.union([ArtifactIdSchema, z.literal('')])
export const STATE_KINDS = ['hover', 'pressed'] as const
export const VARIANT_EVENTS = ['click', 'mouseenter', 'mouseleave', 'appear'] as const
export const TRANSITION_TYPES = ['instant', 'ease', 'spring'] as const
export const TRANSITION_EASINGS = ['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear'] as const

/** A variant shown while the pointer is over (`hover`) or pressing (`pressed`) an instance in its base variant `of`. */
export const VariantStateSchema = z.object({ of: VariantRefSchema, kind: z.enum(STATE_KINDS) })

/** On `on`, after `delay` seconds, the instance switches to variant `to` (a `setVariant` step). */
export const VariantInteractionSchema = z.object({
  on: z.enum(VARIANT_EVENTS),
  do: z.tuple([z.object({ kind: z.literal('setVariant'), to: VariantRefSchema, delay: z.number().min(0).max(10).optional() })])
})

/** How style changes animate when an instance changes variant (the hosted `Transition`). */
export const TransitionSchema = z.object({
  type: z.enum(TRANSITION_TYPES),
  duration: z.number().min(0).max(10).optional(),
  easing: z.enum(TRANSITION_EASINGS).optional(),
  stiffness: z.number().min(1).max(1000).optional(),
  damping: z.number().min(0).max(100).optional()
})

export const LayoutFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: ModuleNameSchema,
  slots: z.array(z.object({ id: LocalIdSchema, name: z.string().min(1), nodeId: LocalIdSchema })),
  /** Values pages set (`layoutValues`) and the tree reads with `{ $bind: 'layout.<name>' }`. Absent means none. */
  variables: z.array(PropertySchema).optional(),
  root: ModelNodeSchema
})

export const OWNERS = ['managed', 'scaffold', 'detached', 'deleted', 'orphaned'] as const

/** Every file bildr wrote, with who owns it now (decision D1: detect and detach). */
export const ManifestFileSchema = z.object({
  ...schemaField,
  generatorVersion: z.string().min(1),
  files: z.record(z.string().min(1), z.object({
    owner: z.enum(OWNERS),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    source: z.string().optional()
  }))
})

// ── Module files ───────────────────────────────────────────────────────

/**
 * A module becomes `layers/<name>` with the aliases `#<name>/domain`, so names
 * Nuxt aliases already use (`#app`, `#build`, `#imports`, …) or the core layer's
 * name are refused.
 */
export const RESERVED_MODULE_NAMES = ['app', 'build', 'components', 'core', 'head', 'imports', 'internal', 'layers', 'nitro', 'shared', 'vue'] as const

export const ModuleFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: ModuleNameSchema.refine(name => !(RESERVED_MODULE_NAMES as readonly string[]).includes(name), {
    error: issue => `"${issue.input as string}" is reserved (Nuxt aliases and the core layer use it)`
  }),
  label: z.string().min(1).max(100),
  dependsOn: z.array(ModuleNameSchema)
})

export const FIELD_TYPES = ['text', 'integer', 'number', 'boolean', 'datetime', 'date', 'image', 'uuid'] as const

export const FieldSchema = z.object({
  id: ArtifactIdSchema,
  name: CamelNameSchema,
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  nullable: z.boolean().optional(),
  readonly: z.boolean().optional(),
  default: ValueSchema.optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().optional(),
  patternMessage: z.string().optional()
})

export const EntityFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: PascalNameSchema,
  plural: CamelNameSchema,
  idStrategy: z.enum(['uuid', 'external']),
  timestamps: z.boolean(),
  fields: z.array(FieldSchema).min(1),
  relations: z.array(z.looseObject({ name: CamelNameSchema, to: ArtifactIdSchema, kind: z.enum(['one', 'many']) })),
  // limit: rows an eager collection loads; the list route accepts at most 500 (core PageRequest).
  client: z.object({ sync: z.enum(['eager', 'on-demand']), limit: z.int().min(1).max(500).optional(), staleTime: z.int().min(0).optional() })
})

export const REPOSITORY_OPERATIONS = ['list', 'get', 'create', 'update', 'delete'] as const
const OrderSchema = z.object({ field: CamelNameSchema, direction: z.enum(['asc', 'desc']) })

export const REST_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
/** One endpoint of a REST repository operation. `:id` in the path is the entity key. */
export const RestEndpointSchema = z.object({
  method: z.enum(REST_METHODS).optional(),
  path: z.string().regex(/^\/[\w\-/:.]*$/, 'Use a path like /posts/:id')
})

export const RepositoryFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  entity: ArtifactIdSchema,
  datasource: ArtifactIdSchema,
  table: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
  operations: z.array(z.enum(REPOSITORY_OPERATIONS)).min(1),
  finders: z.array(z.object({ by: ArtifactIdSchema })).optional(),
  list: z.object({ orderBy: z.array(OrderSchema) }).optional(),
  /** REST data sources: `list` (paging, items path), `fieldMap`, and the endpoint of each other operation (defaults: GET, POST, PUT, DELETE). */
  // Declared in file order (list, paging, fieldMap first): the canonical form keeps the keys the way they are written.
  rest: z.looseObject({
    list: z.looseObject({}).optional(),
    paging: z.looseObject({}).optional(),
    fieldMap: z.record(z.string(), z.string()).optional(),
    get: RestEndpointSchema.optional(),
    create: RestEndpointSchema.optional(),
    update: RestEndpointSchema.optional(),
    delete: RestEndpointSchema.optional()
  }).superRefine((rest, context) => {
    // A lookup or write by key addresses one item: its path names the key exactly once.
    for (const op of ['get', 'update', 'delete'] as const) {
      const path = rest[op]?.path
      if (path !== undefined && path.split('/').filter(segment => segment === ':id').length !== 1) {
        context.addIssue({ code: 'custom', path: [op, 'path'], message: 'Use exactly one :id segment, like "/items/:id"' })
      }
    }
  }).optional(),
  expose: z.object({ list: z.boolean() }).optional()
})

const ParamSchema = z.object({
  name: CamelNameSchema,
  type: z.enum(FIELD_TYPES),
  default: ValueSchema.optional(),
  reactive: z.boolean().optional(),
  from: z.enum(['route', 'body', 'query']).optional()
})

export const CONDITION_OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'like'] as const

export const QueryFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: CamelNameSchema,
  label: z.string().min(1),
  /** What the query returns, in words; becomes the composable's doc comment. */
  description: z.string().max(500).optional(),
  from: ArtifactIdSchema,
  params: z.array(ParamSchema),
  where: z.object({ op: z.enum(CONDITION_OPS), field: CamelNameSchema, value: ValueSchema }).optional(),
  orderBy: z.array(OrderSchema).optional(),
  limit: ValueSchema.optional(),
  result: z.enum(['one', 'many'])
})

export const ACTION_STEP_KINDS = ['validate', 'assert', 'load', 'return', 'repository', 'call', 'custom'] as const

export const ActionFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: CamelNameSchema,
  label: z.string().min(1),
  /** The business rule in words; becomes the use-case's doc comment. */
  description: z.string().max(500).optional(),
  http: z.object({ method: z.enum(['POST', 'PATCH', 'PUT', 'DELETE']), path: z.string().regex(/^\/[\w\-/:]*$/) }),
  input: z.looseObject({ entity: ArtifactIdSchema.optional(), pick: z.array(CamelNameSchema).optional(), params: z.array(ParamSchema).optional() }),
  output: z.object({ entity: ArtifactIdSchema }).optional(),
  errors: z.array(z.object({
    type: z.string().regex(/^[a-z][a-z0-9_]*$/),
    status: z.int().min(400).max(599),
    message: z.string().min(1),
    data: z.record(CamelNameSchema, z.enum(FIELD_TYPES)).optional()
  })),
  steps: z.array(z.looseObject({ kind: z.enum(ACTION_STEP_KINDS) })).min(1),
  client: z.object({
    optimistic: z.looseObject({ kind: z.enum(['insert', 'update', 'delete']), entity: ArtifactIdSchema }).optional(),
    invalidates: z.array(ArtifactIdSchema)
  })
})

export const StateFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: CamelNameSchema,
  label: z.string().min(1),
  persist: z.enum(['memory', 'session', 'localStorage']),
  shape: z.enum(['single', 'many']),
  fields: z.array(FieldSchema).min(1)
})

export const ComponentFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: PascalNameSchema,
  properties: z.array(PropertySchema),
  variants: z.array(z.object({
    id: ArtifactIdSchema,
    name: CamelNameSchema,
    /** Sparse, per node id: `unset` lists style keys the variant removes. */
    overrides: z.record(LocalIdSchema, z.object({
      props: z.record(z.string(), ValueSchema).optional(),
      style: z.record(z.string(), z.string()).optional(),
      unset: z.array(z.string()).optional()
    })),
    state: VariantStateSchema.optional(),
    interactions: z.array(VariantInteractionSchema).max(20).optional(),
    transition: TransitionSchema.optional()
  })),
  /** The primary variant's interactions; `transition` is the primary's and every variant's default. */
  interactions: z.array(VariantInteractionSchema).max(20).optional(),
  transition: TransitionSchema.optional(),
  root: ModelNodeSchema
})

export const PageFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Use a kebab-case route name'),
  path: z.string().regex(/^\/[\w\-/:]*$/, 'Use a path like /posts/:slug'),
  layout: ArtifactIdSchema.optional(),
  /** The page's value per layout variable id; static, generated into `definePageMeta({ layoutValues })`. */
  layoutValues: z.record(ArtifactIdSchema, ValueSchema).optional(),
  params: z.array(z.object({ name: CamelNameSchema, validate: z.object({ field: ArtifactIdSchema }).optional() })).optional(),
  seo: z.object({ title: ValueSchema.optional(), description: ValueSchema.optional() }).optional(),
  uses: z.object({
    state: z.array(z.object({ as: CamelNameSchema, state: ArtifactIdSchema })).optional(),
    queries: z.array(z.object({ as: CamelNameSchema, query: ArtifactIdSchema, args: z.record(CamelNameSchema, ValueSchema).optional() })).optional(),
    actions: z.array(z.object({ as: CamelNameSchema, action: ArtifactIdSchema })).optional(),
    computed: z.array(z.looseObject({ as: CamelNameSchema })).optional()
  }).optional(),
  root: ModelNodeSchema
})

export const FixturesFileSchema = z.object({
  ...schemaField,
  entity: ArtifactIdSchema,
  rows: z.array(z.record(z.string(), ValueSchema))
})

export type ProjectFile = z.infer<typeof ProjectFileSchema>
export type ThemeFile = z.infer<typeof ThemeFileSchema>
export type DataSourceFile = z.infer<typeof DataSourceFileSchema>
export type LayoutFile = z.infer<typeof LayoutFileSchema>
export type ManifestFile = z.infer<typeof ManifestFileSchema>
export type ModuleFile = z.infer<typeof ModuleFileSchema>
export type EntityFile = z.infer<typeof EntityFileSchema>
export type RepositoryFile = z.infer<typeof RepositoryFileSchema>
export type QueryFile = z.infer<typeof QueryFileSchema>
export type ActionFile = z.infer<typeof ActionFileSchema>
export type StateFile = z.infer<typeof StateFileSchema>
export type ComponentFile = z.infer<typeof ComponentFileSchema>
export type PropertyDef = z.infer<typeof PropertySchema>
export type Transition = z.infer<typeof TransitionSchema>
export type PageFile = z.infer<typeof PageFileSchema>
export type FixturesFile = z.infer<typeof FixturesFileSchema>
