import { z } from 'zod'
import { ArtifactIdSchema, FIELD_TYPES, ModuleNameSchema, ValueSchema } from '../model/schemas.ts'
import type { StateFile } from '../model/schemas.ts'
import { camel, defineEdit, fail, kebab } from './core.ts'
import type { Draft } from './core.ts'
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
  id: ArtifactIdSchema.optional().describe('state_update: the id of the field this entry is, to keep it when it is renamed; without it, an entry matches the field of the same name, or is a new one'),
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

const fieldName = (given: string): string => {
  const name = /^[a-z][A-Za-z0-9]*$/.test(given) ? given : camel(given)
  if (!/^[a-z][A-Za-z0-9]*$/.test(name)) fail('invalid', `"${given}" can't be a field name: start with a letter, like "showDrafts"`)
  return name
}

/** The keys of a field the input doesn't speak of, which an update keeps unless the type changes. */
const EXTRAS = ['unique', 'nullable', 'readonly', 'min', 'max', 'pattern', 'patternMessage'] as const

/**
 * The fields `given` stands for, against the state's `existing` ones (none for a new state): an entry with an id is that field, one
 * without matches the field of the same name or is new (minted `fld_<name>`). Defaults are checked against the types: the state
 * starts with them, so a required field has to have one.
 */
const buildFields = (draft: Draft, given: FieldGiven[], existing: StateFile['fields'] = []): StateFile['fields'] => {
  const claimed = new Set<string>()
  const names = new Set<string>()
  return given.map((entry) => {
    const name = fieldName(entry.name)
    if (name === 'id') fail('invalid', '"id" is the key of the state\'s row: pick another field name')
    // Every object has these: a field named like one can't be typed by the generated setter (its patch is an object literal).
    if (name in Object.prototype) fail('invalid', `"${name}" is a name every object already has: pick another field name`)
    if (names.has(name)) fail('invalid', `Two fields are named "${name}"`)
    names.add(name)
    let match: StateFile['fields'][number] | undefined
    if (entry.id !== undefined) {
      match = existing.find(field => field.id === entry.id) ?? fail('not_found', `The state has no field "${entry.id}"`)
    } else {
      match = existing.find(field => field.name === name)
    }
    if (match && claimed.has(match.id)) fail('invalid', `Two fields are the field ${match.id}`)
    if (match) claimed.add(match.id)
    if (entry.default === null) fail('invalid', `${name}: a default is a value, not null`)
    if (entry.default !== undefined && (isExpression(entry.default) || !fits(entry.type, entry.default, !entry.required))) {
      fail('invalid', `${name}: the default ${JSON.stringify(entry.default)} doesn't fit ${entry.type}`)
    }
    if (entry.required && entry.default === undefined) fail('invalid', `${name}: a required field needs a default (the state starts with its defaults)`)
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
    name: z.string().min(1).max(60).describe('camelCased, e.g. "preferences"; unique among the module\'s states, and free of the names the generated composable use<Module><Name>, its collection file and the module\'s queries and actions take. The id is st_<name>'),
    label: z.string().min(1).max(100).optional().describe('A human name; defaults to the name in words'),
    persist: z.enum(PERSIST).optional().describe('memory (forgotten on reload; the default), session (kept for this tab) or localStorage (kept in this browser)'),
    shape: z.enum(['single', 'many']).optional().describe('single (the default): one row of values. many is refused: it is not generated yet'),
    fields: z.array(FieldInput.omit({ id: true })).min(1).max(50).optional().describe('Its fields, e.g. [{ "name": "showDrafts", "type": "boolean", "default": false }]. Left out: one text field "value", empty')
  }),
  apply: (draft, { module = draft.model.project.defaultModule, name: given, label, persist = 'memory', shape = 'single', fields }) => {
    if (shape !== 'single') fail('invalid', `A state of shape "${shape}" is not generated yet: only single is`)
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
  if (state.shape !== 'single') fail('invalid', `The state ${state.name} (${state.id}) has shape "${state.shape}", which is not generated yet (only single is): delete it and create it again`)
}

export const stateUpdate = defineEdit({
  input: z.object({
    state: StateRef,
    label: z.string().min(1).max(100).optional(),
    persist: z.enum(PERSIST).optional().describe('memory (forgotten on reload), session (kept for this tab) or localStorage (kept in this browser)'),
    fields: z.array(FieldInput).min(1).max(50).optional().describe('Replaces the whole list of fields. An entry keeps the field of its id, or of its name; a field left out is removed. A field a page binds or a setState step sets can change its default and whether it is required, but not be removed, renamed or change type')
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
        if (uses.length) fail('invalid', `The field ${field.name} of the state ${state.name} (${id}) is still used: ${describeUses(uses)}. It can't be ${what}: change them first`)
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
    name: z.string().min(1).max(60).describe('The new name, camelCased; unique among the module\'s states and free of the names the generated files take')
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
