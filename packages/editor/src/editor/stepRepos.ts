import type { Model } from '@bildr/codegen/model'
import { entityById } from '../shared/dataModel.ts'
import type { FieldType } from '../shared/dataModel.ts'

/**
 * What a step may call (S10, D10c): the repositories of the action's module, by the collection each stores, with the lookups a
 * load or a refuse may use and the writes a write step may do. A pure read of the model.
 */

export type WriteOp = 'create' | 'update' | 'delete'

/** A way to find one row: `get` by the key, or a finder by one of the entity's fields. `arg` names the one argument it takes. */
export interface Lookup {
  op: string
  label: string
  arg: string
  type: FieldType
}

/** A repository of the action's module, as its steps may use it: by the collection it stores. */
export interface RepoInfo {
  id: string
  entity: string
  name: string
  /** The type of the key the repository's rows have. */
  key: FieldType
  writes: WriteOp[]
  lookups: Lookup[]
  /** The fields a write sets: the entity's own, not the key. */
  fields: Array<{ name: string, type: FieldType }>
}

const WRITES: WriteOp[] = ['create', 'update', 'delete']
const spaced = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
const pascal = (name: string) => name.split(/[-_\s]+/).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')

/**
 * The repositories the action's steps may name (a use-case reads those of its own module), with the operations each has:
 * the ones the generator writes (`create`, `update`, `delete`) and the ways to find one row (`get`, and a finder by each field
 * the repository lists, `findBy<Field>`). `list` takes a page, which a step cannot give, so it is not offered.
 */
export function repositoriesOf(model: Model, actionId: string): RepoInfo[] {
  const owner = Object.values(model.modules).find(mod => mod.actions.some(action => action.id === actionId))
  if (!owner) return []
  return owner.repositories.flatMap((repository): RepoInfo[] => {
    const entity = entityById(model, repository.entity)
    if (!entity) return []
    const key: FieldType = entity.idStrategy === 'uuid' ? 'uuid' : entity.fields.find(field => field.name === 'id')?.type ?? 'text'
    const finders = (repository.finders ?? []).flatMap((finder) => {
      const field = entity.fields.find(entry => entry.id === finder.by)
      return field ? [{ op: `findBy${pascal(field.name)}`, label: `Find by ${spaced(field.name)}`, arg: field.name, type: field.type }] : []
    })
    return [{
      id: repository.id,
      entity: entity.id,
      name: entity.name,
      key,
      writes: WRITES.filter(op => repository.operations.includes(op)),
      lookups: [...repository.operations.includes('get') ? [{ op: 'get', label: 'Get by id', arg: 'id', type: key }] : [], ...finders],
      fields: entity.fields.filter(field => field.name !== 'id').map(field => ({ name: field.name, type: field.type }))
    }]
  })
}
