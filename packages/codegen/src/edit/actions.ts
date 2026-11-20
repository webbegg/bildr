import { z } from 'zod'
import { ActionFileSchema, ArtifactIdSchema, ModuleNameSchema } from '../model/schemas.ts'
import type { ActionFile, EntityFile } from '../model/schemas.ts'
import { defineEdit, fail, kebab, snake } from './core.ts'
import type { Draft } from './core.ts'
import { checkRouteFree, createAction, entityById, keyType, repositoryOf } from './entities.ts'
import { callableName, checkActionName, checkCallableFree, composableOf, sentence, spaced } from './naming.ts'
import { describeUses, usesOf } from './usage.ts'

/**
 * Actions of their own (D10a): the Data workspace's Actions section. `action_create` starts from
 * a template, every one of which validates and generates; `action_update` is the partial edit the
 * step editor uses; rename and delete follow the same rules as a query's (a rename changes the
 * name only, a delete is refused while anything uses the action).
 */

const ActionRef = ArtifactIdSchema.describe('An action id, e.g. "act_create_post"')

const findAction = (draft: Draft, id: string): { action: ActionFile, module: string } => {
  for (const [module, mod] of Object.entries(draft.model.modules)) {
    const action = mod.actions.find(entry => entry.id === id)
    if (action) return { action, module }
  }
  return fail('not_found', `No action "${id}"`)
}

/** The generated routes read a route parameter as a uuid and nothing else, so an update or delete by key needs one. */
const needsUuidKey = (entity: EntityFile, verb: string) => {
  const type = keyType(entity)
  if (type !== 'uuid') fail('invalid', `${entity.name} has ${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type} key: generated routes take uuid keys only, so it can't be ${verb} from an action yet`)
}

const KEY_PARAM = { name: 'id', type: 'uuid', from: 'route' } as const

// ── action_create ────────────────────────────────────────────────────────

export const actionCreate = defineEdit({
  input: z.object({
    module: ModuleNameSchema.optional().describe('The module it belongs to: the one of its entity (a module\'s actions work on its own entities)'),
    entity: ArtifactIdSchema.describe('The entity it works on (ent_*)'),
    template: z.enum(['create', 'update', 'delete', 'blank']).describe('create: POST /<plural>, what entity_create makes; update: PATCH /<plural>/:id, which loads the row and writes it back (add what to set with action_update); delete: DELETE /<plural>/:id; blank: one return step to build on'),
    name: z.string().min(1).max(60).describe('camelCased, e.g. "publish post" → "publishPost"; unique among the module\'s queries and actions. The use-case and the client composable (use<Name>) take it; the id is act_<name>'),
    label: z.string().min(1).max(100).optional().describe('A human name; defaults to the name in words')
  }),
  apply: (draft, { module: given, entity: entityId, template, name: givenName, label }) => {
    if (given !== undefined) draft.module(given)
    const { entity, module: owner } = entityById(draft, entityId)
    const module = given ?? owner
    if (module !== owner) fail('invalid', `${entity.name} isn't in module "${module}": a module's actions work on its own entities`)
    const mod = draft.module(module)
    const repository = repositoryOf(draft, entityId) ?? fail('invalid', `${entity.name} has no repository`)
    const name = callableName(givenName, 'action')
    checkCallableFree(draft, module, name)
    checkActionName(draft, module, name)
    const has = (op: (typeof repository.operations)[number]) => repository.operations.includes(op)
    const listed = Boolean(repository.expose?.list) && has('list')
    const route = `/${kebab(entity.plural)}`
    const own = { id: draft.mint('act', name), name, label: label ?? sentence(spaced(name)) }
    let action: ActionFile

    if (template === 'create') {
      if (!has('create')) fail('invalid', `${entity.name} can't be created: its repository has no create operation`)
      checkRouteFree(mod.actions, 'POST', route)
      action = createAction(entity, repository.id, listed, own)
    } else if (template === 'update') {
      for (const op of ['get', 'update'] as const) if (!has(op)) fail('invalid', `${entity.name} can't be updated: its repository has no ${op} operation`)
      needsUuidKey(entity, 'updated')
      // The use-case stamps updatedAt with now(), but imports it only when a step sets something to { "$now": true }.
      if (entity.timestamps) fail('invalid', `Update isn't generated yet for entities with timestamps (${entity.name}): its stamp needs a field set to { "$now": true }. Use blank and write the steps, or turn timestamps off`)
      // The generated test of a use-case that loads a row reads one from the sample data.
      const sample = Object.values(draft.model.modules).flatMap(entry => entry.fixtures).find(fixtures => fixtures.entity === entityId)
      if (!sample?.rows.length) fail('invalid', `Update needs a sample row of ${entity.name}: its generated test loads one. Add sample data to ${entity.name} first`)
      checkRouteFree(mod.actions, 'PATCH', `${route}/:id`)
      const notFound = `${snake(entity.name)}_not_found`
      action = {
        ...own,
        http: { method: 'PATCH', path: `${route}/:id` },
        input: { params: [{ ...KEY_PARAM }] },
        output: { entity: entityId },
        errors: [{ type: notFound, status: 404, message: `${sentence(spaced(entity.name))} not found.`, data: { id: 'text' } }],
        steps: [
          { kind: 'load', as: 'existing', repository: repository.id, op: 'get', args: { id: { $input: 'id' } }, orError: notFound, errorData: { id: { $input: 'id' } } },
          { kind: 'repository', repository: repository.id, op: 'update', id: { $input: 'id' }, from: { $var: 'existing' } }
        ],
        // Nothing to show ahead of the server (no client.optimistic, so the generated composable calls the route directly); only a listed entity has a collection to refresh.
        client: { invalidates: listed ? [entityId] : [] }
      }
    } else if (template === 'delete') {
      if (!has('delete')) fail('invalid', `${entity.name} can't be deleted: its repository has no delete operation`)
      needsUuidKey(entity, 'deleted')
      checkRouteFree(mod.actions, 'DELETE', `${route}/:id`)
      action = {
        ...own,
        http: { method: 'DELETE', path: `${route}/:id` },
        input: { params: [{ ...KEY_PARAM }] },
        errors: [],
        steps: [{ kind: 'repository', repository: repository.id, op: 'delete', id: { $input: 'id' } }],
        client: { ...(listed ? { optimistic: { kind: 'delete', entity: entityId, key: { $input: 'id' } } } : {}), invalidates: listed ? [entityId] : [] }
      }
    } else {
      // Its input is the entity's body (the one shape the client composable and the route both generate for any key), and
      // it returns nothing: `undefined`, the one value a void result takes.
      if (!has('create') && !has('update') && !has('delete')) fail('invalid', `${entity.name} is read-only: its repository has no create, update or delete operation, so an action over it has nothing to take or do`)
      checkRouteFree(mod.actions, 'POST', `${route}/${kebab(name)}`)
      action = {
        ...own,
        http: { method: 'POST', path: `${route}/${kebab(name)}` },
        input: { entity: entityId, pick: [...(entity.idStrategy === 'external' ? [] : ['id']), ...entity.fields.map(field => field.name)] },
        errors: [],
        steps: [{ kind: 'return', if: true, value: { $var: 'undefined' } }],
        client: { invalidates: [] }
      }
    }
    mod.actions.push(action)
    const filePath = draft.place(action.id, `.bildr/modules/${module}/actions`, kebab(name))
    return { actionId: action.id, filePath }
  }
})

// ── action_update ────────────────────────────────────────────────────────

const HttpPart = z.object({
  method: ActionFileSchema.shape.http.shape.method.optional(),
  path: ActionFileSchema.shape.http.shape.path.optional()
})

export const actionUpdate = defineEdit({
  input: z.object({
    action: ActionRef,
    label: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional().describe('The business rule in words (the use-case\'s doc comment); null removes it'),
    input: ActionFileSchema.shape.input.optional().describe('Replaces the input whole: { entity, pick } (the body, validated against the entity) or { params: [{ name, type, from }] } (route parameters; only uuid ones generate yet); not both: an action takes a body or route parameters'),
    steps: ActionFileSchema.shape.steps.optional().describe('Replaces the steps whole: validate, assert, load, return, repository (last). call and custom are not generated yet and are refused'),
    http: HttpPart.optional().describe('Method and/or path; the one you leave out stays'),
    errors: ActionFileSchema.shape.errors.optional().describe('Replaces the declared errors whole; steps may only name the ones declared'),
    client: ActionFileSchema.shape.client.optional().describe('Replaces the client part whole: { optimistic?, invalidates }')
  }),
  apply: (draft, { action: id, label, description, input, steps, http, errors, client }) => {
    const { action, module } = findAction(draft, id)
    if (label !== undefined) action.label = label
    if (description !== undefined) {
      if (description === null) delete action.description
      else action.description = description
    }
    if (input !== undefined) {
      const entity = input.entity === undefined ? undefined : Object.values(draft.model.modules).flatMap(mod => mod.entities).find(entry => entry.id === input.entity)
      // An unknown entity is the model's to report; a field it lacks would only crash the generator.
      for (const name of entity && input.pick ? input.pick : []) {
        if (name !== 'id' && !entity!.fields.some(field => field.name === name)) fail('invalid', `input: ${entity!.name} has no field "${name}"`)
      }
      action.input = input
    }
    if (steps !== undefined) {
      // A return answers with the use-case's result type: the entity row when the action has an output, else nothing (void).
      const nothing = (value: unknown) => value === null || (typeof value === 'object' && value !== null && (value as { $var?: unknown }).$var === 'undefined')
      steps.forEach((step, index) => {
        if (step.kind !== 'return') return
        if (action.output && nothing(step.value)) fail('invalid', `steps.${index + 1}: this action returns a row (its output), so the return needs one, like { "$var": "post" }`)
        if (!action.output && !(typeof step.value === 'object' && step.value !== null && (step.value as { $var?: unknown }).$var === 'undefined')) fail('invalid', `steps.${index + 1}: this action returns nothing (it has no output), so the return's value is { "$var": "undefined" }`)
      })
      action.steps = steps
    }
    if (errors !== undefined) action.errors = errors
    if (client !== undefined) action.client = client
    if (http !== undefined) {
      const next = { method: http.method ?? action.http.method, path: http.path ?? action.http.path }
      checkRouteFree(draft.module(module).actions, next.method, next.path, id)
      action.http = next
    }
    // A route parameter is read from the path, so the path must have it.
    const segments = new Set(action.http.path.split('/').filter(segment => segment.startsWith(':')).map(segment => segment.slice(1)))
    for (const param of action.input.params ?? []) {
      if (param.from === 'route' && !segments.has(param.name)) fail('invalid', `The parameter "${param.name}" comes from the route, but ${action.http.path} has no :${param.name}. Set http.path too, e.g. "${action.http.path.replace(/\/$/, '')}/:${param.name}"`)
    }
    return { actionId: id }
  }
})

// ── action_rename and action_delete ──────────────────────────────────────

export const actionRename = defineEdit({
  input: z.object({
    action: ActionRef,
    name: z.string().min(1).max(60).describe('The new name, camelCased; unique among the module\'s queries and actions')
  }),
  apply: (draft, { action: id, name: given }) => {
    const { action, module } = findAction(draft, id)
    const name = callableName(given, 'action')
    checkCallableFree(draft, module, name, id)
    checkActionName(draft, module, name)
    const previousName = action.name
    // Pages and forms hold the id and their own alias: only the generated use-case, route and composable change.
    action.name = name
    return { actionId: id, name, previousName, composable: composableOf(name), previousComposable: composableOf(previousName) }
  }
})

export const actionDelete = defineEdit({
  input: z.object({ action: ActionRef }),
  apply: (draft, { action: id }) => {
    const { action, module } = findAction(draft, id)
    const uses = usesOf(draft.model, id)
    if (uses.length) fail('invalid', `Action ${action.name} (${id}) is still used: ${describeUses(uses)}. Change them first`)
    const mod = draft.module(module)
    mod.actions.splice(mod.actions.indexOf(action), 1)
    return { deleted: [id] }
  }
})
