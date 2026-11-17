import type { ActionFile, Model } from '@bildr/codegen/model'
import { queryFields } from '../shared/dataArtifacts.ts'
import { entityById, repositoryEntity } from '../shared/dataModel.ts'
import type { FieldType } from '../shared/dataModel.ts'
import type { Step } from './stepExpr.ts'

/**
 * What the steps of an action may read at each step (S10, D10c): the fields of the body and the route parameters (`input`) and the
 * rows the steps before it loaded (`vars`). A pure read of the model, like `shared/dataArtifacts.ts`.
 */

/** A value a step can read: its path (`slug`, `post.title`), its type when it is a field, and `row` (the entity's id) for a variable that holds a row. */
export interface ScopeEntry {
  path: string
  type?: FieldType
  row?: string
}

export interface StepScope {
  /** The fields of the body and the route parameters: `{ $input }`. */
  input: ScopeEntry[]
  /** The names the steps before it gave, each with the fields of its row: `{ $var }`. */
  vars: ScopeEntry[]
}

/**
 * What step `index` of `steps` can read. A variable is the name a `load` step gave (`as`): only steps after it have it, so the
 * step itself and the ones before it never do. (A write step is the last step and gives no name.)
 */
export function scopeAt(model: Model, action: Pick<ActionFile, 'input'>, steps: readonly Step[], index: number): StepScope {
  const input: ScopeEntry[] = []
  const entity = action.input.entity ? entityById(model, action.input.entity) : undefined
  if (entity) {
    const picked = action.input.pick
    for (const field of queryFields(model, entity.id)) {
      if (picked ? picked.includes(field.name) : field.name !== 'createdAt' && field.name !== 'updatedAt') input.push({ path: field.name, type: field.type })
    }
  }
  for (const param of action.input.params ?? []) input.push({ path: param.name, type: param.type })

  const vars: ScopeEntry[] = []
  for (const step of steps.slice(0, index)) {
    if (step.kind !== 'load' || typeof step.as !== 'string' || step.as === '') continue
    const row = typeof step.repository === 'string' ? repositoryEntity(model, step.repository) : undefined
    vars.push({ path: step.as, row: row ?? '' })
    if (row) for (const field of queryFields(model, row)) vars.push({ path: `${step.as}.${field.name}`, type: field.type })
  }
  return { input, vars }
}
