import { computed, nextTick, ref, shallowReactive, shallowRef, watch } from 'vue'
import type { ModelNode } from '@bildr/codegen/model'
import { draftOfStep, stepsOfDrafts } from '../shared/interactionConversion.ts'
import { draftProblems } from '../shared/interactionProblems.ts'
import { refusalAt } from '../shared/interactionSummary.ts'
import type { Place } from '../shared/interactionValues.ts'
import { newStep } from '../shared/nodeInteractions.ts'
import type { Env, NewKind, NodeEvent, Stored, StepDraft } from '../shared/nodeInteractions.ts'
import { attempt } from './dataArtifactActions.ts'
import { useEditor } from './useEditor.ts'
import type { Editor } from './useEditor.ts'

/**
 * The draft of one node interaction under edit (B3, S2): the steps as the form holds them, what they still need, and the one queue
 * the writes go through.
 *
 * **The write.** An edit changes the draft, and the draft is written (`node_interaction_add` for a new interaction, `_update` after)
 * once every step is complete: a step that is not complete yet stays in the form and says what it needs, and nothing half-made is
 * sent. A write waits for the one before it, so the form never writes over its own earlier write. Every write names the event the
 * form saw at that place (`expectedOn`): when the interaction there is another, the module refuses it as changed since opened. The
 * module's refusal is kept (`refusal`) and the draft stays so it can be fixed.
 *
 * **What the model says meanwhile.** The model read again (an undo, another editor) is compared with what the form last saw, the
 * interaction's whole JSON, so an event or a step changed elsewhere both show, and an earlier interaction removed (the index moves)
 * does too. A form that holds no edit of its own shows what the model has now. A form that does (`pending`) is `stale`: it keeps its
 * draft and writes nothing, until `reload` brings in the latest, so a write never lands on an interaction the person did not see.
 *
 * **What outlives the form.** Edits that are not written yet are not lost when the row is closed or another node is selected (the
 * inspector's content is rebuilt for each node): the draft is kept per node and event for the editing session (`heldBy`), and the
 * row it belongs to says it is not saved. The Design screen has no leave-guard to ask through (a selection is changed from the
 * canvas, the layers, the keyboard), so the draft is kept rather than a question asked.
 */

/** Where a node interaction is edited: the file (a page, layout or component id), what it is, and the node. */
export function placeOf(editor: Editor, nodeId: string): Place {
  // `editor.page` is the file open on the canvas, whatever it is: a page, a layout or a component. Its id is the file the module's
  // `node_interaction_*` edits take (`file`), and the one `bindingScope` and the generator resolve a node against.
  return { file: editor.page?.id ?? '', kind: editor.component ? 'component' : editor.layout ? 'layout' : 'page', nodeId }
}

/** An interaction's draft kept for the session: what a form holds, so another can pick it up. */
export interface Held {
  file: string
  nodeId: string
  /** The editor (an opened row) that holds it now. */
  session: number
  /** Its place in the node's list: none until the first write of a new one. */
  at: number | null
  /** The event the form saw at that place, and after each write. */
  seen: NodeEvent | null
  current: NodeEvent
  drafts: StepDraft[]
  /** What the module held for it as of the last write or read (JSON of the interaction, `null` when none). */
  written: string
  /** The steps the draft was made from. */
  base: Stored[]
  /** An edit the form holds that the module doesn't (a step still being made, or a refused one). */
  pending: boolean
}

const stores = new WeakMap<object, Map<string, Held>>()

/** The drafts held for this editor, by node and event: reactive, so a row can say its interaction is not saved. */
export function heldBy(editor: Editor): Map<string, Held> {
  let store = stores.get(editor)
  if (!store) {
    store = shallowReactive(new Map<string, Held>())
    stores.set(editor, store)
  }
  return store
}

export const heldKey = (file: string, nodeId: string, on: NodeEvent): string => `${file}\u0000${nodeId}\u0000${on}`

export interface OpenInteraction {
  /** Which opened editor this is: a new one each time a row is opened, so a form is never reused for another interaction. */
  session: number
  /** Its place in the node's list, or null for a new one. */
  index: number | null
  /** Its event when it was opened. */
  on: NodeEvent
}

interface Options {
  node: () => ModelNode
  open: OpenInteraction
  /** The first write of a new interaction is done: it is at `index`. */
  saved: (index: number) => void
  /** The latest was asked for, and there is none: the interaction is gone. */
  gone: () => void
}

export function useInteractionDraft(options: Options) {
  const editor = useEditor()
  const held = heldBy(editor)
  const { open } = options
  const nodeId = () => options.node().id
  const file = () => editor.page?.id ?? ''

  const kept = held.get(heldKey(file(), nodeId(), open.on))
  const resumed = kept && (kept.at === null) === (open.index === null) ? kept : undefined
  const first = open.index === null ? undefined : options.node().interactions?.[open.index]

  const at = ref<number | null>(resumed?.at ?? open.index)
  const seen = ref<NodeEvent | null>(resumed ? resumed.seen : first?.on ?? null)
  const current = ref<NodeEvent>(resumed?.current ?? open.on)
  const env = computed<Env | null>(() => (editor.model ? { model: editor.model, place: placeOf(editor, nodeId()), nodeType: options.node().type, on: current.value } : null))

  const draftsOf = (steps: ReadonlyArray<Record<string, unknown>> | undefined): StepDraft[] => (env.value && steps ? steps.map(step => draftOfStep(env.value!, step)) : [])
  // Replaced whole on each edit, never changed in place: a shallow ref (a deep one unwraps the model's recursive value type).
  const drafts = shallowRef<StepDraft[]>(resumed?.drafts ?? draftsOf(first?.do))
  const base = shallowRef<Stored[]>(resumed?.base ?? (first?.do as Stored[] | undefined) ?? [])
  const written = ref(resumed?.written ?? JSON.stringify(first ?? null))
  const pending = ref(resumed?.pending ?? false)
  const refusal = ref<{ step: number | null, text: string } | null>(null)

  const stored = computed(() => (at.value === null ? undefined : options.node().interactions?.[at.value]))
  const storedJson = computed(() => JSON.stringify(stored.value ?? null))
  /** The writes asked for and not done: while there are some the form is ahead of the model, and what it reads back is its own. */
  const busy = ref(0)
  const outdated = () => at.value !== null && storedJson.value !== written.value
  /** The module's interaction at this place is not the one the form last saw: it changed since (its event or its steps), or moved or went. */
  const stale = computed(() => busy.value === 0 && outdated())

  const problems = computed(() => (env.value ? draftProblems(env.value, drafts.value) : []))
  const complete = computed(() => drafts.value.length > 0 && problems.value.every(list => !list.length))

  /** Takes the latest the module holds for this place as what the form has seen, steps and all. */
  function adopt(latest: NonNullable<typeof stored.value>) {
    drafts.value = draftsOf(latest.do)
    base.value = latest.do as Stored[]
    written.value = JSON.stringify(latest)
    seen.value = latest.on
    current.value = latest.on
    pending.value = false
    refusal.value = null
  }

  /** The model read again: the form that holds no edit of its own shows what the module holds; one that does keeps its draft and is stale. */
  function reconcile() {
    if (busy.value || !outdated()) return
    const latest = stored.value
    if (!pending.value && latest && latest.on === seen.value) adopt(latest)
  }
  watch(storedJson, reconcile)
  // A draft that was kept while the model moved on: the same check, once, as it is picked up.
  if (resumed) reconcile()

  /** The latest the module holds, in place of the draft; when there is none (it was removed) the interaction is gone. */
  function reload() {
    if (stored.value) return adopt(stored.value)
    forget()
    options.gone()
  }

  // ── What outlives the form ──
  let heldAs: string | null = null
  function persist() {
    const key = heldKey(file(), nodeId(), seen.value ?? current.value)
    if (heldAs && heldAs !== key) held.delete(heldAs)
    heldAs = key
    held.set(key, { file: file(), nodeId: nodeId(), session: open.session, at: at.value, seen: seen.value, current: current.value, drafts: drafts.value, written: written.value, base: base.value, pending: pending.value })
  }
  function forget() {
    if (heldAs) held.delete(heldAs)
    heldAs = null
  }
  watch([drafts, current, seen, at, written, pending, base], persist, { flush: 'sync', immediate: true })

  // ── The write queue ──
  let queue: Promise<void> = Promise.resolve()
  /** Writes the draft once it is complete: after the writes before it. */
  function commit() {
    busy.value++
    queue = queue.then(write).catch(() => undefined).finally(() => {
      busy.value--
    })
    return queue
  }

  async function write() {
    refusal.value = null
    const where = env.value
    if (!where) return
    if (outdated()) {
      // The draft stays, and nothing is written over what changed.
      pending.value = true
      return
    }
    if (!complete.value) {
      pending.value = true
      return
    }
    const steps = stepsOfDrafts(where, drafts.value, base.value)
    const target = editor.page?.id
    if (at.value === null) {
      const done = await attempt<{ index: number }>(editor, 'node_interaction_add', { file: target, nodeId: nodeId(), on: current.value, do: steps }, 'Could not save the interaction')
      if ('error' in done) return refuse(done.error)
      // The node the form reads is the one the model has now once the screen has caught up with the read.
      await nextTick()
      at.value = done.result.index
      options.saved(done.result.index)
    } else {
      const done = await attempt(editor, 'node_interaction_update', { file: target, nodeId: nodeId(), index: at.value, expectedOn: seen.value, ...(current.value !== seen.value ? { on: current.value } : {}), do: steps }, 'Could not save the interaction')
      if ('error' in done) return refuse(done.error)
      await nextTick()
    }
    seen.value = current.value
    pending.value = false
    written.value = storedJson.value
    base.value = (stored.value?.do as Stored[] | undefined) ?? steps
  }

  function refuse(message: string) {
    pending.value = true
    refusal.value = refusalAt(message, drafts.value.length)
  }

  function setStep(index: number, step: StepDraft) {
    drafts.value = drafts.value.map((entry, position) => (position === index ? step : entry))
    void commit()
  }

  function addStep(kind: NewKind) {
    drafts.value = [...drafts.value, newStep(kind)]
    void commit()
  }

  function removeStep(index: number) {
    drafts.value = drafts.value.filter((_, position) => position !== index)
    void commit()
  }

  function setEvent(on: NodeEvent) {
    current.value = on
    // The control's value belongs to a Checkbox's change.
    if (on !== 'change') drafts.value = drafts.value.map(step => (step.kind === 'setState' && step.value.kind === 'event' ? { ...step, value: { kind: 'none' } } : step))
    void commit()
  }

  return { env, at, seen, current, drafts, problems, pending, refusal, stale, setStep, addStep, removeStep, setEvent, reload }
}
