import { z } from 'zod'

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
  props?: Record<string, Value>
  style?: Record<string, string>
  interactions?: Array<z.infer<typeof InteractionSchema>>
  children?: ModelNode[]
}

export const ModelNodeSchema: z.ZodType<ModelNode> = z.lazy(() => z.object({
  id: LocalIdSchema,
  type: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
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
  modules: z.array(ModuleNameSchema)
})

export const ThemeFileSchema = z.object({
  ...schemaField,
  colors: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.string()),
  fonts: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.string())
})

export const DataSourceFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: ModuleNameSchema,
  kind: z.enum(['sqlite', 'rest']),
  /** Setting name → env var that holds its value at runtime. */
  env: z.record(CamelNameSchema, EnvNameSchema),
  /** Non-secret defaults written into runtimeConfig. */
  defaults: z.record(CamelNameSchema, z.string()).optional(),
  auth: z.object({ type: z.enum(['bearer', 'header']), secret: CamelNameSchema, header: z.string().optional() }).optional()
}).superRefine((source, ctx) => {
  const secret = source.auth?.secret
  if (!secret) return
  if (!source.env[secret]) ctx.addIssue({ code: 'custom', path: ['auth', 'secret'], message: `Secret "${secret}" needs an env var in "env"` })
  if (source.defaults && secret in source.defaults) {
    ctx.addIssue({ code: 'custom', path: ['defaults', secret], message: `"${secret}" is a secret: set it with ${source.env[secret] ?? 'an env var'}, never in the model` })
  }
})

export const LayoutFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: ModuleNameSchema,
  slots: z.array(z.object({ id: LocalIdSchema, name: z.string().min(1), nodeId: LocalIdSchema })),
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

export const ModuleFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: ModuleNameSchema,
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
  client: z.object({ sync: z.enum(['eager', 'on-demand']), limit: z.int().min(1).max(10_000).optional(), staleTime: z.int().min(0).optional() })
})

export const REPOSITORY_OPERATIONS = ['list', 'get', 'create', 'update', 'delete'] as const
const OrderSchema = z.object({ field: CamelNameSchema, direction: z.enum(['asc', 'desc']) })

export const RepositoryFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  entity: ArtifactIdSchema,
  datasource: ArtifactIdSchema,
  table: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
  operations: z.array(z.enum(REPOSITORY_OPERATIONS)).min(1),
  finders: z.array(z.object({ by: ArtifactIdSchema })).optional(),
  list: z.object({ orderBy: z.array(OrderSchema) }).optional(),
  rest: z.looseObject({}).optional(),
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
  properties: z.array(z.object({
    id: ArtifactIdSchema,
    name: CamelNameSchema,
    kind: z.enum(['text', 'number', 'boolean', 'image', 'link', 'entity', 'slot']),
    entity: ArtifactIdSchema.optional(),
    pick: z.array(CamelNameSchema).optional(),
    required: z.boolean().optional(),
    default: ValueSchema.optional()
  })),
  variants: z.array(z.object({
    id: ArtifactIdSchema,
    name: CamelNameSchema,
    overrides: z.record(LocalIdSchema, z.object({ props: z.record(z.string(), ValueSchema).optional(), style: z.record(z.string(), z.string()).optional() }))
  })),
  root: ModelNodeSchema
})

export const PageFileSchema = z.object({
  ...schemaField,
  id: ArtifactIdSchema,
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Use a kebab-case route name'),
  path: z.string().regex(/^\/[\w\-/:]*$/, 'Use a path like /posts/:slug'),
  layout: ArtifactIdSchema.optional(),
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
export type PageFile = z.infer<typeof PageFileSchema>
export type FixturesFile = z.infer<typeof FixturesFileSchema>
