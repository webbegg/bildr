import { computed, reactive } from 'vue'
import type { ModelNode } from '@bildr/codegen/model'
import { computedUsesOf, queryBehind } from '@bildr/codegen/edit'
import { takeRefusal } from '../editor/dataArtifactActions.ts'
import { STUCK, compensate, withStateUse } from '../editor/stateUse.ts'
import { useEditor } from '../editor/useEditor.ts'
import type { Editor } from '../editor/useEditor.ts'
import { isExpression } from '../shared/bindings.ts'
import { branchChoices, computedInput, computedValues, conditionChoices, conditionOf, conditionSentence } from '../shared/listSource.ts'
import type { ConditionChoice, ConditionDraft } from '../shared/listSource.ts'
import { freeAlias } from '../shared/pageNames.ts'
import { useDesign } from './store.ts'

/**
 * A List's conditional source (B4, S4) for its source panel: "if <a true or false value> then <list> else <list>", the page's computed
 * value (`page_computed_set`) which the List's `items` bind by name. A List already bound to one the panel can read shows it, and an
 * edit writes the same value in place. Choosing "Depends on a condition" on a List with one query starts a condition that is written,
 * with the List bound to it, once the value and both lists are chosen; a State the page does not use yet is added first (`withStateUse`),
 * and what was added is taken off again when the module refuses the rest, so a refusal leaves the page as it was and shows under the
 * condition. When the condition moves to another State, the page's use of the old one goes if nothing reads it. Going back to one list
 * rebinds the List, then drops the computed value when nothing else reads it (one the panel cannot read is left alone).
 *
 * **Per node.** What a List holds while it is edited (the condition not finished, the module's refusal, a write in flight) is kept for
 * that List for the editing session, as the Interactions' drafts are (`useInteractionDraft`): the panel can show another List and come
 * back to it, and a write that finishes after another List was selected lands on the List it was made for, never on the one shown now.
 * A write names the page, the List and its draft when it starts and uses only those.
 */

/** What is held for one List: its unfinished condition, the refusal it shows, whether a write of it is in flight. */
interface Slot {
  draft: ConditionDraft | null
  failure: string
  busy: boolean
  /** Bumped when a refusal leaves the model as it was, so the selects show the model again. */
  key: number
  /** The computed value a write made and could not take back: a retry writes it again instead of making another. */
  orphan: string | null
}

const held = new WeakMap<Editor, Map<string, Slot>>()

/** The slot of the List `nodeId` of `file` for this editor. */
function slotOf(editor: Editor, file: string, nodeId: string): Slot {
  let slots = held.get(editor)
  if (!slots) {
    slots = new Map()
    held.set(editor, slots)
  }
  const key = `${file}\u0000${nodeId}`
  let slot = slots.get(key)
  if (!slot) {
    slot = reactive<Slot>({ draft: null, failure: '', busy: false, key: 0, orphan: null })
    slots.set(key, slot)
  }
  return slot
}

export function useListCondition(node: () => ModelNode) {
  const design = useDesign()
  const editor = useEditor()
  const page = computed(() => design.page.value)
  const model = computed(() => design.model.value)
  const slot = computed(() => slotOf(editor, page.value?.id ?? '', node().id))

  /** The name the List's items bind (the first word of the path). */
  const itemsRoot = computed(() => {
    const items = node().props?.items
    return isExpression(items) && typeof items.$bind === 'string' ? items.$bind.split('.')[0]! : ''
  })
  /** The condition the List's items are bound to, when they are bound to a computed value the panel can read. */
  const condition = computed(() => (page.value && itemsRoot.value ? conditionOf(page.value, itemsRoot.value) : undefined))
  /** The condition as the form shows it: the written one, or the one being made. */
  const form = computed<ConditionDraft | null>(() => {
    const written = condition.value
    return written ? { path: written.path, off: written.off, then: written.then, else: written.else } : slot.value.draft
  })
  const summary = computed(() => (page.value && model.value && condition.value ? conditionSentence(model.value, page.value, condition.value) : ''))

  const choices = computed(() => (page.value && model.value ? conditionChoices(model.value, page.value) : []))
  /** The choices of the condition: the value it reads shows even when it is no longer one a condition can read. */
  const ifOptions = computed<ConditionChoice[]>(() => {
    const read = form.value?.path
    return read && !choices.value.some(choice => choice.path === read) ? [...choices.value, { path: read, label: read, title: read }] : choices.value
  })
  const entityOfAlias = (alias: string) => (page.value && model.value && alias ? queryBehind(model.value, page.value, alias)?.from : undefined)
  const thenOptions = computed(() => (page.value && model.value ? branchChoices(model.value, page.value, condition.value ? entityOfAlias(condition.value.then) : undefined) : []))
  const elseOptions = computed(() => (page.value && model.value ? branchChoices(model.value, page.value, entityOfAlias(form.value?.then ?? '')) : []))

  /** Which branch a query behind the List is, for its settings below. */
  const branchOf = (alias: string): 'then' | 'else' | undefined => (condition.value?.then === alias ? 'then' : condition.value?.else === alias ? 'else' : undefined)

  /** Takes the refusal off the banner and shows it under the condition of `mine`. */
  const showRefusal = (mine: Slot, fallback: string) => {
    mine.failure = takeRefusal(editor, fallback).error
    mine.key++
  }

  /** The page's use of the State at the root `alias` goes when nothing reads it: the module refuses while something does, which is the answer. */
  async function dropStateUse(file: string, alias: string) {
    if (!await editor.run('page_use_remove', { page: file, as: alias })) takeRefusal(editor, 'The page still reads it')
  }

  /** Writes `next`: the computed value, in place or new, with the page's use of the State it reads, and the List bound to it. */
  async function writeCondition(next: ConditionDraft, existing: ReturnType<typeof conditionOf>) {
    const onPage = page.value
    const inModel = model.value
    if (!onPage || !inModel) return
    // What the write is for, taken now: the page, the List, and its slot. Nothing after an await reads what is selected then.
    const file = onPage.id
    const nodeId = node().id
    const mine = slot.value
    mine.failure = ''
    mine.busy = true
    try {
      const orphan = mine.orphan && !existing && computedValues(onPage).some(use => use.as === mine.orphan) && !computedUsesOf(inModel, file, mine.orphan).length ? mine.orphan : undefined
      const entity = Object.values(inModel.modules).flatMap(mod => mod.entities).find(item => item.id === entityOfAlias(next.then))
      const as = existing?.as ?? orphan ?? freeAlias(onPage, entity?.plural ?? 'items', 'computed')
      const input = computedInput(file, { as, ...next })
      const writeAll = async () => {
        if (!await editor.run('page_computed_set', input)) return undefined
        if (existing) return {}
        const bound = await design.setProps(nodeId, { items: { $bind: as } })
        if (bound) return bound
        // The List refused it: the computed value just made goes, and the refusal stays.
        const stuck = await compensate(editor, () => editor.run('page_computed_remove', { page: file, as }), `The computed value ${as} could not be taken off again`)
        if (stuck) mine.orphan = as
        return stuck
      }
      const state = conditionChoices(inModel, onPage).find(choice => choice.path === next.path)?.state
      const done = state ? await withStateUse(editor, file, state, writeAll) : await writeAll()
      if (done === undefined || done === STUCK) {
        showRefusal(mine, 'The change was refused')
        return
      }
      mine.draft = null
      mine.orphan = null
      // Moved to another State: the one it read is no longer needed by this condition.
      const before = existing?.path.split('.')[0]
      if (before && before !== next.path.split('.')[0] && onPage.uses?.state?.some(use => use.as === before)) await dropStateUse(file, before)
    } finally {
      mine.busy = false
    }
  }

  /** A change of the condition's form: written when whole (in place for a condition the List has), kept as a draft otherwise. */
  function changeCondition(patch: Partial<ConditionDraft>) {
    const mine = slot.value
    const base = form.value
    if (!base || mine.busy) return
    const next: ConditionDraft = { ...base, ...patch }
    // Another collection's list can't be the other branch: it is chosen again.
    if (!condition.value && patch.then !== undefined && entityOfAlias(patch.then) !== entityOfAlias(next.else)) next.else = ''
    if (!condition.value) mine.draft = next
    if (next.path && next.then && next.else) void writeCondition(next, condition.value)
  }

  /** A computed value that nothing binds any more goes (what the List was bound to before this pick). */
  async function dropComputed(file: string, mine: Slot, as: string) {
    const current = design.model.value
    if (!current || computedUsesOf(current, file, as).length) return
    if (!await design.edit('page_computed_remove', { page: file, as })) mine.failure = takeRefusal(editor, `Could not remove the computed value ${as}`).error
  }

  /** The Items select: a list (a query or a computed value of the page), a new query for a collection, or a condition. */
  async function pickSource(value: string) {
    const onPage = page.value
    if (!value || !onPage) return
    const file = onPage.id
    const nodeId = node().id
    const mine = slot.value
    const before = condition.value?.as
    mine.failure = ''
    if (value === 'cond') {
      if (!form.value) mine.draft = { path: '', off: false, then: model.value && branchChoices(model.value, onPage).some(choice => choice.alias === itemsRoot.value) ? itemsRoot.value : '', else: '' }
      return
    }
    mine.draft = null
    const done = value.startsWith('new:')
      ? await design.edit('query_create_for_list', { page: file, entity: value.slice(4), nodeId })
      : await design.setProps(nodeId, { items: { $bind: value } })
    if (done && before) await dropComputed(file, mine, before)
  }

  return {
    itemsRoot, condition, form, summary, choices, ifOptions, thenOptions, elseOptions, branchOf, changeCondition, pickSource,
    busy: computed(() => slot.value.busy),
    failure: computed(() => slot.value.failure),
    formKey: computed(() => slot.value.key)
  }
}
