import { z } from 'zod'
import { ArtifactIdSchema, FIELD_TYPES, ModuleNameSchema, ValueSchema } from '../model/schemas.ts'
import type { StateFile } from '../model/schemas.ts'
import { camel, defineEdit, fail, kebab } from './core.ts'
import type { Draft, FieldRef } from './core.ts'
import { fits, isExpression } from './entities.ts'
import { checkStateFree, sentence, spaced, stateComposableOf, stateName } from './naming.ts'
import { describeUses, stateFieldUsesOf, usesOf } from './usage.ts'

/**
 * State (B1, S1): the Data workspace's State section. A state is one row of UI values (`.bildr/modules/<module>/state/<name>.json`)
 * the generator turns into a collection and the composable use<Module><Name>, which a page reads through `uses.state` and a
 * `setState` step writes. Only `shape: single` is generated, so that is the only one created (a `many` state still loads; it can be
 * deleted or renamed, not edited). Names follow D10a: checked against what the generated code declares, and against the
 * composables and files of the module's queries, actions and collections.
 */

const StateRef = ArtifactIdSchema.describe('A state id, e.g. "st_preferences"')
const PERSIST = ['memory', 'session', 'localStorage'] as const

const FieldInput = z.object({
  id: ArtifactIdSchema.optional().describe('state_update: the id of the field this entry is, to keep it when it is renamed. When any entry has an id, an entry without one is a new field; when none has, an entry matches the field of the same name, or is a new one'),
  name: z.string().min(1).max(60).describe('camelCased, e.g. "Show drafts" → "showDrafts"; "id" is the row\'s key'),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional().describe('a required field needs a default: the state starts with its defaults'),
  default: ValueSchema.optional().describe('a literal that fits the type; where the state starts')
})

type FieldGiven = z.infer<typeof FieldInput>

const findState = (draft: Draft, id: string): { state: StateFile, module: string } => {
  for (const [module, mod] of Object.entries(draft.model.modules)) {
    const state = mod.state.find(entry => entry.id === id)
    if (state) return { state, module }
  }
  return fail('not_found', `No state "${id}"`)
}

// The refusals about one field of a list carry its `FieldRef` (`field` of the edit's outcome): the editor shows each next to its field by
// that, never by reading the message. The id is the one the entry gave (or the saved field's), the name the one the entry was given.

const fieldName = (given: string, ref: FieldRef): string => {
  const name = /^[a-z][A-Za-z0-9]*$/.test(given) ? given : camel(given)
  if (!/^[a-z][A-Za-z0-9]*$/.test(name)) fail('invalid', `"${given}" can't be a field name: start with a letter, like "showDrafts"`, ref)
  return name
}

/** The keys of a field the input doesn't speak of, which an update keeps unless the type changes. */
const EXTRAS = ['unique', 'nullable', 'readonly', 'min', 'max', 'pattern', 'patternMessage'] as const

/**
 * The fields `given` stands for, against the state's `existing` ones (none for a new state). An entry with an id is that field,
 * whatever its name (so a rename, and a new field that takes the old name in the same save, are told apart). When any entry has an
 * id, the caller keeps ids (the editor sends one for every saved field), so an entry without one is a NEW field (minted
 * `fld_<name>`): never matched by name to a field another entry has by id, nor to one the list leaves out, which would hand a field
 * that was removed and added again its old id and its extras. When no entry has an id, an entry matches the field of the same name
 * or is new. Defaults are checked against the types: the state starts with them, so a required field has to have one.
 */
const buildFields = (draft: Draft, given: FieldGiven[], existing: StateFile['fields'] = []): StateFile['fields'] => {
  const claimed = new Set<string>()
  const names = new Set<string>()
  const keepsIds = given.some(entry => entry.id !== undefined)
  return given.map((entry) => {
    const ref: FieldRef = { ...(entry.id !== undefined ? { id: entry.id } : {}), name: entry.name }
    const name = fieldName(entry.name, ref)
    if (name === 'id') fail('invalid', '"id" is the key of the state\'s row: pick another field name', ref)
    // Every object already has these (`toString`, `constructor`…): the generated code that changes a field takes an object literal, which can't type one.
    if (name in Object.prototype) fail('invalid', `"${name}" is a name every object already has: pick another field name`, ref)
    if (names.has(name)) fail('invalid', `Two fields are named "${name}"`, ref)
    names.add(name)
    let match: StateFile['fields'][number] | undefined
    if (entry.id !== undefined) {
      match = existing.find(field => field.id === entry.id) ?? fail('not_found', `The state has no field "${entry.id}"`, ref)
    } else if (!keepsIds) {
      match = existing.find(field => field.name === name)
    }
    if (match && claimed.has(match.id)) fail('invalid', `Two fields are the field ${match.id}`, ref)
    if (match) claimed.add(match.id)
    if (entry.default === null) fail('invalid', `${name}: a default is a value, not null`, ref)
    if (entry.default !== undefined && (isExpression(entry.default) || !fits(entry.type, entry.default, !entry.required))) {
      fail('invalid', `${name}: the default ${JSON.stringify(entry.default)} doesn't fit ${entry.type}`, ref)
    }
    if (entry.required && entry.default === undefined) fail('invalid', `${name}: a required field needs a default (the state starts with its defaults)`, ref)
    const kept = match && match.type === entry.type ? Object.fromEntries(EXTRAS.filter(key => match![key] !== undefined).map(key => [key, match![key]])) : {}
    return {
      id: match?.id ?? draft.mint('fld', name),
      name,
      type: entry.type,
      ...(entry.required ? { required: true } : {}),
      ...kept,
      ...(entry.default !== undefined ? { default: entry.default } : {})
    } as StateFile['fields'][number]
  })
}

export const stateCreate = defineEdit({
  input: z.object({
    module: ModuleNameSchema.optional().describe('The module it belongs to; defaults to the project\'s defaultModule'),
    name: z.string().min(1).max(60).describe('camelCased, e.g. "preferences"; unique among the module\'s states, and free of the names the module\'s queries, actions and collections take and the names the generated code of a state already uses. The id is st_<name>'),
    label: z.string().min(1).max(100).optional().describe('A human name; defaults to the name in words'),
    persist: z.enum(PERSIST).optional().describe('memory (forgotten on reload; the default), session (kept for this tab) or localStorage (kept in this browser)'),
    shape: z.enum(['single', 'many']).optional().describe('single (the default): one row of values. many (a state with several rows) is not generated yet'),
    fields: z.array(FieldInput.omit({ id: true })).min(1).max(50).optional().describe('Its fields, e.g. [{ "name": "showDrafts", "type": "boolean", "default": false }]. Left out: one text field "value", empty')
  }),
  apply: (draft, { module = draft.model.project.defaultModule, name: given, label, persist = 'memory', shape = 'single', fields }) => {
    if (shape !== 'single') fail('invalid', 'A state with several rows is not generated yet: a state holds one row of values')
    const mod = draft.module(module)
    const name = stateName(given)
    checkStateFree(draft, module, name)
    const state: StateFile = {
      id: draft.mint('st', name),
      name,
      label: label ?? sentence(spaced(name)),
      persist,
      shape,
      fields: buildFields(draft, fields ?? [{ name: 'value', type: 'text', default: '' }])
    }
    mod.state.push(state)
    const filePath = draft.place(state.id, `.bildr/modules/${module}/state`, kebab(name))
    return { stateId: state.id, filePath }
  }
})

const single = (state: StateFile) => {
  if (state.shape !== 'single') fail('invalid', `The state ${state.name} (${state.id}) has several rows, which is not generated yet (a state holds one row of values): delete it and create it again`)
}

export const stateUpdate = defineEdit({
  input: z.object({
    state: StateRef,
    label: z.string().min(1).max(100).optional(),
    persist: z.enum(PERSIST).optional().describe('memory (forgotten on reload), session (kept for this tab) or localStorage (kept in this browser)'),
    fields: z.array(FieldInput).min(1).max(50).optional().describe('Replaces the whole list of fields. An entry keeps the field of its id (when any entry has an id, one without is a new field), or of its name when none has an id; a field left out is removed. A field a page binds or a setState step sets can change its default and whether it is required, but not be removed, renamed or change type')
  }),
  apply: (draft, { state: id, label, persist, fields }) => {
    const { state } = findState(draft, id)
    single(state)
    if (fields !== undefined) {
      const next = buildFields(draft, fields, state.fields)
      for (const field of state.fields) {
        const now = next.find(entry => entry.id === field.id)
        const what = !now ? 'removed' : now.name !== field.name ? `renamed to ${now.name}` : now.type !== field.type ? `changed to ${now.type}` : undefined
        if (!what) continue
        const uses = stateFieldUsesOf(draft.model, id, field.name)
        if (uses.length) fail('invalid', `The field ${field.name} of the state ${state.name} (${id}) is still used: ${describeUses(uses)}. It can't be ${what}: change them first`, { id: field.id, name: field.name })
      }
      state.fields = next
    }
    if (label !== undefined) state.label = label
    if (persist !== undefined) state.persist = persist
    return { stateId: id }
  }
})

export const stateRename = defineEdit({
  input: z.object({
    state: StateRef,
    name: z.string().min(1).max(60).describe('The new name, camelCased; unique among the module\'s states and free of the names the app already takes, as in state_create')
  }),
  apply: (draft, { state: id, name: given }) => {
    const { state, module } = findState(draft, id)
    const name = stateName(given)
    checkStateFree(draft, module, name, id)
    const previousName = state.name
    // Pages hold the id and their own alias, steps the id: only the generated collection, file and composable change.
    state.name = name
    return { stateId: id, name, previousName, composable: stateComposableOf(module, name), previousComposable: stateComposableOf(module, previousName) }
  }
})

export const stateDelete = defineEdit({
  input: z.object({ state: StateRef }),
  apply: (draft, { state: id }) => {
    const { state, module } = findState(draft, id)
    const uses = usesOf(draft.model, id)
    if (uses.length) fail('invalid', `State ${state.name} (${id}) is still used: ${describeUses(uses)}. Change them first`)
    const mod = draft.module(module)
    mod.state.splice(mod.state.indexOf(state), 1)
    return { deleted: [id] }
  }
})
