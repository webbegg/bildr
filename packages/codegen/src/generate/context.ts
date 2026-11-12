import type { Model, ModuleModel } from '../model/load.ts'
import type { DataSourceFile, EntityFile, FieldSchema, RepositoryFile } from '../model/schemas.ts'
import type { z } from 'zod'
import { camel, kebab, pascal } from './text.ts'

export type Field = z.infer<typeof FieldSchema>

/** One module's view of the model, with the lookups every emitter needs. */
export interface ModuleContext {
  model: Model
  /** Folder and layer name, e.g. `blog`. */
  name: string
  module: ModuleModel
  /** `useBlog`: the composition root, also the API routes' entry point. */
  root: string
  /** Where a model artifact lives, for headers and manifest sources. */
  source: (id: string) => string
}

export const moduleContext = (model: Model, name: string): ModuleContext => ({
  model,
  name,
  module: model.modules[name]!,
  root: `use${pascal(name)}`,
  source: id => model.paths[id] ?? `.bildr/modules/${name}`
})

/** Names derived from an entity: `Post`, `post`, `posts`, `post-repository`… */
export const entityNames = (entity: EntityFile) => ({
  type: entity.name,
  variable: camel(entity.name),
  plural: entity.plural,
  file: kebab(entity.name),
  port: `${entity.name}Repository`,
  portFile: `${kebab(entity.name)}-repository`,
  collection: `${entity.plural}Collection`
})

export const repositoryOf = (context: ModuleContext, entity: EntityFile): RepositoryFile | undefined =>
  context.module.repositories.find(repository => repository.entity === entity.id)

export const datasourceOf = (context: ModuleContext, repository: RepositoryFile): DataSourceFile =>
  context.model.datasources.find(source => source.id === repository.datasource)!

export const entityById = (context: ModuleContext, id: string): EntityFile => {
  const entity = context.module.entities.find(entry => entry.id === id)
  if (!entity) throw new Error(`Entity ${id} is not in module ${context.name}`)
  return entity
}

/** The entity's key: a client-generated uuid, or the `id` field an external source owns. */
export const keyOf = (entity: EntityFile): { name: string, type: 'string' | 'number' } => {
  if (entity.idStrategy === 'uuid') return { name: 'id', type: 'string' }
  const field = entity.fields.find(entry => entry.name === 'id')
  if (!field) throw new Error(`${entity.id}: an external entity needs an "id" field`)
  return { name: 'id', type: field.type === 'integer' || field.type === 'number' ? 'number' : 'string' }
}

const ID_FIELD: Field = { id: 'fld_id', name: 'id', type: 'uuid', required: true }
const TIMESTAMP_FIELDS: Field[] = [
  { id: 'fld_created_at', name: 'createdAt', type: 'datetime', required: true, readonly: true },
  { id: 'fld_updated_at', name: 'updatedAt', type: 'datetime', required: true, readonly: true }
]

/** Entity fields plus the implicit id and timestamps, in column order. */
export const allFields = (entity: EntityFile): Field[] => [
  ...(entity.idStrategy === 'uuid' ? [ID_FIELD] : []),
  ...entity.fields,
  ...(entity.timestamps ? TIMESTAMP_FIELDS : [])
]

export const isWritable = (repository: RepositoryFile | undefined) =>
  !!repository && repository.operations.some(op => op === 'create' || op === 'update' || op === 'delete')
