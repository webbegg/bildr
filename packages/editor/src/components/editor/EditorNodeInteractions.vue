<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { ModelNode } from '@bildr/codegen/model'
import { FOCUS_RING } from '../../editorUi.ts'
import { attempt } from '../../editor/dataArtifactActions.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { heldBy, heldKey, placeOf } from '../../editor/useInteractionDraft.ts'
import type { OpenInteraction } from '../../editor/useInteractionDraft.ts'
import { EVENT_LABELS } from '../../shared/interactionPanel.ts'
import { summarize } from '../../shared/interactionSummary.ts'
import { eventChoices, takesEvents } from '../../shared/nodeInteractions.ts'
import type { Env, NodeEvent } from '../../shared/nodeInteractions.ts'

/**
 * The inspector's Interactions on a node of a page, layout or component (B3, S2): "When Change → Set showDrafts (Blog preferences)
 * to the checkbox's value", one row per event, each opening its steps right under it (`EditorNodeInteractionFields`: an editor in
 * the panel, not a popover: the "+" menu hands focus back to its button as it closes, which dismisses a popover opened by the pick,
 * and a form with selects and boxes wants the panel's width anyway); × removes it; "+" picks the event a new one is for (an event
 * the node has, or one being made, is disabled: one interaction per event, and Appear says it is not generated yet). Only a Button,
 * a Checkbox and a Form react to events: on any other node the section is not there.
 *
 * What a form holds that is not written yet is not lost when its row is closed or another node is selected: the draft is kept for
 * the session (`heldBy`), and its row says "not saved" (a new interaction is a row of its own until its first step is written; ×
 * on it drops the draft). An opened row is `{ index, on }`, a new session each time it is opened, so a form is never reused for
 * another interaction; when the interaction at its index is not the one it opened (an earlier one was removed, an undo), the form
 * says so and offers the latest, and the editor of an interaction that is gone stays under the rows until it is closed.
 *
 * Not the component's variant interactions (`EditorInteractionsSection`, "Variant changes": click, then show another variant), which
 * stay as they were and are listed apart on the component view.
 */
const { node } = defineProps<{ node: ModelNode }>()
const editor = useEditor()
const held = heldBy(editor)

const place = computed(() => placeOf(editor, node.id))
const reacts = computed(() => takesEvents(node.type))
const stored = computed(() => node.interactions ?? [])
/** The drafts held for this node: the one in the open form, and the ones that were left not saved. */
const heldHere = computed(() => [...held.values()].filter(entry => entry.file === place.value.file && entry.nodeId === node.id))

/** The row whose steps are open. */
const open = ref<OpenInteraction | null>(null)
let sessions = 0
const failure = ref('')

const env = (on: NodeEvent): Env | null => (editor.model ? { model: editor.model, place: place.value, nodeType: node.type, on } : null)

interface Row {
  /** Stable while its steps are open, even when a new interaction is written and becomes a stored one: the form keeps its focus. */
  key: string
  index: number
  on: NodeEvent
  fresh: boolean
  /** The session that holds a new interaction's draft. */
  session: number | null
  text: string
  unsaved: boolean
}

const isOpen = (row: Row): boolean => !!open.value && (row.fresh ? open.value.index === null && open.value.session === row.session : open.value.index === row.index)

const rows = computed<Row[]>(() => {
  // The new interaction in the open form is its own row until the form has said it is written: while the model has read it back and
  // the form has not yet, its event is stored, and the stored row is not listed beside it.
  const making = heldHere.value.find(item => item.at === null && item.session === open.value?.session)?.current
  const list = stored.value.flatMap((entry, index): Row[] => {
    if (entry.on === making) return []
    const mine = heldHere.value.find(item => item.at === index && item.seen === entry.on)
    const base = env(entry.on)
    const row: Row = { key: `i${index}`, index, on: entry.on, fresh: false, session: null, text: base ? summarize(base, entry.do) : '', unsaved: !!mine?.pending }
    return [open.value?.index === index ? { ...row, key: `s${open.value.session}` } : row]
  })
  const taken = new Set(stored.value.map(entry => entry.on))
  // A new interaction is a row until its first write: the one in the open form (whose form must stay until it has said it is written: the
  // model is read back first, and for that moment its event is stored), and the ones left not saved. Once written, the stored row is its.
  const fresh = heldHere.value
    .filter(item => item.at === null && (item.session === open.value?.session || (item.pending && !taken.has(item.current))))
    .map((item, position): Row => ({ key: `s${item.session}`, index: stored.value.length + position, on: item.current, fresh: true, session: item.session, text: item.drafts.length ? 'not saved yet' : 'choose a step', unsaved: false }))
  return [...list, ...fresh]
})

/** The open form's interaction is no row of the list any more (it was removed elsewhere, or undone): its editor stays, under the rows, until it is closed. */
const orphan = computed(() => open.value?.index != null && open.value.index >= stored.value.length)

const menu = computed(() => eventChoices(node.type, [...stored.value.map(entry => entry.on), ...heldHere.value.filter(item => item.at === null).map(item => item.current)])
  .map(choice => ({ id: choice.on, label: choice.label, disabled: choice.disabled, hint: choice.hint })))

/** Closes the open row. What it holds that is not written stays; a draft with nothing to lose goes. */
function close() {
  const closing = open.value
  open.value = null
  if (!closing) return
  for (const [key, entry] of held) if (entry.session === closing.session && !entry.pending) held.delete(key)
}

function add(id: string) {
  failure.value = ''
  const on = id as NodeEvent
  close()
  const session = ++sessions
  held.set(heldKey(place.value.file, node.id, on), { file: place.value.file, nodeId: node.id, session, at: null, seen: null, current: on, drafts: [], written: 'null', base: [], pending: false })
  open.value = { session, index: null, on }
}

/** Opens a row's steps, or closes them. */
function toggle(row: Row) {
  failure.value = ''
  if (isOpen(row)) return close()
  close()
  const session = ++sessions
  if (row.fresh) {
    const key = heldKey(place.value.file, node.id, row.on)
    const entry = held.get(key)
    if (entry) held.set(key, { ...entry, session })
    open.value = { session, index: null, on: row.on }
  } else {
    open.value = { session, index: row.index, on: row.on }
  }
}

function saved(index: number) {
  if (open.value) open.value = { ...open.value, index }
}

async function remove(row: Row) {
  failure.value = ''
  if (row.fresh) {
    held.delete(heldKey(place.value.file, node.id, row.on))
    if (isOpen(row)) open.value = null
    return
  }
  const done = await attempt(editor, 'node_interaction_remove', { file: editor.page?.id, nodeId: node.id, index: row.index, on: row.on }, 'Could not remove the interaction')
  if ('error' in done) {
    failure.value = done.error
    return
  }
  // The ones after it moved down; the drafts held for them follow, and the removed one's goes.
  for (const [key, entry] of [...held]) {
    if (entry.file !== place.value.file || entry.nodeId !== node.id || entry.at === null) continue
    if (entry.at === row.index) held.delete(key)
    else if (entry.at > row.index) held.set(key, { ...entry, at: entry.at - 1 })
  }
  close()
}

// The inspector is rebuilt for each node: a draft with nothing unsaved in it is read from the model again; the rest stays.
onBeforeUnmount(() => {
  for (const [key, entry] of held) if (entry.nodeId === node.id && entry.file === place.value.file && !entry.pending) held.delete(key)
})

const label = (row: { on: NodeEvent }) => `When ${EVENT_LABELS[row.on]}`
</script>

<template>
  <EditorStyleSection
    v-if="editor.model && reacts"
    label="Interactions"
    add-label="Add interaction"
    :menu="menu"
    data-node-interactions
    @add="add"
  >
    <div
      v-for="row in rows"
      :key="row.key"
      :data-node-interaction="row.index"
      :data-interaction-on="row.on"
    >
      <div class="group/interaction relative flex min-h-[30px] items-start">
        <button
          type="button"
          class="flex min-h-[30px] min-w-0 flex-1 items-start gap-2 rounded-lg py-[7px] ps-2 pe-8 text-start text-[12px] leading-4 text-toned hover:bg-white/4"
          :class="[FOCUS_RING, isOpen(row) ? 'bg-white/8 text-highlighted' : '']"
          :aria-label="`Edit ${label(row)}`"
          :aria-expanded="isOpen(row)"
          :title="row.text ? `${label(row)} → ${row.text}` : label(row)"
          data-node-interaction-toggle
          @click="toggle(row)"
        >
          <UIcon
            name="i-lucide-zap"
            class="mt-px size-3.5 shrink-0 text-(--editor-context)"
          />
          <span class="line-clamp-3 min-w-0 break-words">
            <span class="font-[550] text-highlighted">{{ label(row) }}</span>
            →
            <span data-interaction-summary>{{ row.text || 'choose a step' }}</span>
            <span
              v-if="row.unsaved"
              class="text-dimmed"
              data-interaction-unsaved
            > · not saved</span>
          </span>
        </button>
        <EditorButton
          icon="i-lucide-x"
          size="xs"
          variant="ghost"
          :aria-label="`Remove ${label(row)}`"
          class="absolute end-1 top-[3px]"
          data-node-interaction-delete
          @click="remove(row)"
        />
      </div>
      <div
        v-if="isOpen(row) && open"
        class="mt-1.5 mb-1 border-s border-default ps-2.5"
        data-node-interaction-editor
      >
        <EditorNodeInteractionFields
          :key="open.session"
          :node="node"
          :open="open"
          @saved="saved"
          @gone="close"
        />
      </div>
    </div>
    <div
      v-if="orphan && open"
      class="mt-1.5 mb-1 border-s border-default ps-2.5"
      data-node-interaction-editor
      data-node-interaction-orphan
    >
      <EditorNodeInteractionFields
        :key="open.session"
        :node="node"
        :open="open"
        @saved="saved"
        @gone="close"
      />
    </div>
    <p
      v-if="!rows.length && !orphan"
      class="text-[11px] text-dimmed"
      data-interactions-empty
    >
      Nothing happens yet. Use + to choose when.
    </p>
    <p
      v-if="failure"
      class="text-[11px] text-error"
      role="alert"
      data-interactions-error
    >
      {{ failure }}
    </p>
  </EditorStyleSection>
</template>
