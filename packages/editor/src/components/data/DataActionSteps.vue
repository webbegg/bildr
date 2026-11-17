<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, shallowRef, useTemplateRef, watch } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ActionFile, Model } from '@bildr/codegen/model'
import { attempt } from '../../editor/dataArtifactActions.ts'
import { ADDABLE_KINDS, NOT_GENERATED_KINDS, addError, addStep, changedOutside, changesOf, contextOf, draftOf, duplicateStep, errorsNamed, moveStep, problemsOf, rebaseDraft, removeStep, stepsNamed } from '../../editor/stepDraft.ts'
import type { AddableKind, DraftError, StepsDraft } from '../../editor/stepDraft.ts'
import { scopeAt } from '../../editor/stepScope.ts'
import type { Step } from '../../editor/stepScope.ts'
import { useEditor } from '../../editor/useEditor.ts'

/**
 * An action's Steps tab (S10, D10c): the list of its steps, each a card (`DataStepCard`) with the form of its fields, and below
 * them the errors the steps refuse with (`DataActionErrors`). A step is added from a menu of its kinds, moved (the grip drags;
 * the up and down buttons are the keyboard's way), copied and removed. Edits are a draft, saved with one `action_update` that
 * sends `steps` and, when they changed, `errors` (`editor/stepDraft.ts`); what the module refuses is shown under the form with the
 * draft kept, and the step it names is marked.
 *
 * What the editor can tell before asking (a name used before a step gives it, an error that is not declared, a field left empty,
 * a return that may not run) is said on the card and blocks Save; the module stays the authority and checks it all again.
 *
 * As the query Definition does (`DataQueryDefinition.vue`), the draft keeps its base: the action as it was when the draft was
 * opened or last saved. While the draft has edits and the stored action differs from its base in the steps or the errors, a
 * notice asks to load the new version or keep the edits, and Save waits for the choice. The unsaved draft is the workspace's
 * `dataDirty`: it asks before the workspace moves away from it.
 */
const { action } = defineProps<{ action: ActionFile }>()
const editor = useEditor()
const root = useTemplateRef<HTMLElement>('root')

const ctx = computed(() => contextOf(editor.model as Model, action))

/** A copy of a plain value, so the base and the draft never share what the model's refresh replaces. */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const draft = ref<StepsDraft>(draftOf(action))
/** The action the draft started from: as it was when the draft was opened or last saved. Replaced as a whole, never edited. */
const base = shallowRef<ActionFile>(copy(action))
const error = ref('')
const saving = ref(false)
/** The steps whose form is open, by key. */
const open = reactive(new Set<number>())

const changes = computed(() => changesOf(draft.value, base.value).input)
const dirty = computed(() => Object.keys(changes.value).length > 0)
const problems = computed(() => problemsOf(draft.value, ctx.value))
const stale = computed(() => dirty.value && !saving.value && changedOutside(base.value, action))
const listProblems = computed(() => problems.value.filter(problem => problem.step === undefined && problem.error === undefined).map(problem => problem.message))
const errorProblems = computed(() => problems.value.filter(problem => problem.error !== undefined))
const stepProblems = (index: number) => problems.value.filter(problem => problem.step === index).map(problem => problem.message)
const refusedSteps = computed(() => error.value ? stepsNamed(error.value, draft.value.steps) : [])
const refusedErrors = computed(() => error.value ? errorsNamed(error.value, draft.value.errors) : [])

const name = computed(() => action.label || action.name)
watch([dirty, name], ([unsaved, label]) => {
  editor.dataDirty = unsaved ? label : null
}, { flush: 'sync', immediate: true })
onBeforeUnmount(() => {
  editor.dataDirty = null
})

// Another action, or the model changed under a form with nothing changed in it: the form shows it. Edits that are not saved stay.
watch(() => action.id, () => {
  open.clear()
  discard()
})
watch(() => JSON.stringify(action), () => {
  if (!dirty.value) discard()
})
watch(draft, () => {
  error.value = ''
}, { deep: true })

/** Gives up the edits: the form shows the action as it is saved, which is its base now. The steps that were open stay open, by place. */
function discard() {
  const places = draft.value.steps.flatMap((entry, at) => open.has(entry.key) ? [at] : [])
  base.value = copy(action)
  draft.value = draftOf(action)
  open.clear()
  for (const at of places) if (at < draft.value.steps.length) open.add(draft.value.steps[at]!.key)
  error.value = ''
}

/** "Keep my edits": the stored action is the base now, and the form keeps only the part the user touched over it. */
function keepMine() {
  draft.value = copy(rebaseDraft(draft.value, base.value, action))
  base.value = copy(action)
  error.value = ''
}

async function save() {
  if (stale.value || problems.value.length || !dirty.value) return
  saving.value = true
  const done = await attempt(editor, 'action_update', { action: action.id, ...changes.value }, 'Could not save the action')
  saving.value = false
  if ('error' in done) {
    error.value = done.error
    return
  }
  discard()
}

// ── Editing the list ─────────────────────────────────────────────────────

function add(kind: AddableKind) {
  const added = addStep(draft.value, kind, ctx.value)
  draft.value = added.draft
  open.add(added.draft.steps[added.index]!.key)
}

const menu = computed<DropdownMenuItem[][]>(() => [
  ADDABLE_KINDS.map(entry => ({ label: entry.label, onSelect: () => add(entry.kind) })),
  NOT_GENERATED_KINDS.map(entry => ({ label: `${entry.label} (not generated yet)`, disabled: true }))
])

function update(index: number, step: Step) {
  draft.value = { ...draft.value, steps: draft.value.steps.map((entry, at) => at === index ? { ...entry, step } : entry) }
}

function toggle(key: number) {
  if (open.has(key)) open.delete(key)
  else open.add(key)
}

async function move(index: number, by: -1 | 1) {
  const key = draft.value.steps[index]!.key
  draft.value = moveStep(draft.value, index, index + by)
  // The button that moved the step keeps the focus, at the step's new place.
  await nextTick()
  root.value?.querySelector<HTMLElement>(`[data-step-key="${key}"] ${by < 0 ? '[data-step-up]' : '[data-step-down]'}:not([disabled])`)?.focus()
}

function duplicate(index: number) {
  const next = duplicateStep(draft.value, index)
  draft.value = next
  open.add(next.steps[index + 1]!.key)
}

function remove(index: number) {
  open.delete(draft.value.steps[index]!.key)
  draft.value = removeStep(draft.value, index)
}

function addErrorTo(init: Partial<DraftError>) {
  draft.value = addError(draft.value, init)
}

// ── Dragging a step ──────────────────────────────────────────────────────

const dragKey = ref<number | null>(null)
/** Where the dragged step would land: the insertion slot (0 … step count) in the current order. */
const dropSlot = ref<number | null>(null)

function onDragStart(event: DragEvent, key: number) {
  dragKey.value = key
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(key))
  const card = (event.currentTarget as HTMLElement).closest('[data-step-card]')
  if (card) event.dataTransfer.setDragImage(card, 12, 18)
}

function onDragOver(event: DragEvent, index: number) {
  if (dragKey.value === null) return
  event.preventDefault()
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropSlot.value = event.clientY < box.top + box.height / 2 ? index : index + 1
}

function onDrop() {
  const key = dragKey.value
  const slot = dropSlot.value
  onDragEnd()
  if (key === null || slot === null) return
  const from = draft.value.steps.findIndex(entry => entry.key === key)
  const to = slot > from ? slot - 1 : slot
  if (from >= 0) draft.value = moveStep(draft.value, from, to)
}

function onDragEnd() {
  dragKey.value = null
  dropSlot.value = null
}
</script>

<template>
  <!-- The footer is at the bottom of the area when the list is short, and sticks to it when it scrolls. -->
  <div
    ref="root"
    class="flex size-full flex-col overflow-y-auto"
    data-action-steps
  >
    <div class="w-full max-w-2xl flex-1 space-y-6 px-0.5 py-4">
      <UAlert
        v-if="stale"
        color="warning"
        variant="subtle"
        icon="i-lucide-refresh-cw"
        title="This action changed since you started editing"
        description="Your edits are still here. Load the new version to drop them, or keep them: only the part you changed (the steps or the errors) replaces the new version when you save."
        data-steps-changed
      >
        <template #actions>
          <UButton
            label="Load the new version"
            color="warning"
            variant="soft"
            size="xs"
            data-steps-load-new
            @click="discard"
          />
          <UButton
            label="Keep my edits"
            color="neutral"
            variant="outline"
            size="xs"
            data-steps-keep-mine
            @click="keepMine"
          />
        </template>
      </UAlert>

      <section class="space-y-3">
        <div class="flex items-center gap-2">
          <div class="min-w-0 flex-1">
            <h3 class="text-[12px] font-[550] text-highlighted">
              Steps
            </h3>
            <p class="text-xs text-dimmed">
              They run in order. A repository step, or a return that always runs, comes last.
            </p>
          </div>
          <EditorMenu :items="menu">
            <EditorButton
              icon="i-lucide-plus"
              label="Add step"
              size="xs"
              data-step-add
            />
          </EditorMenu>
        </div>

        <ul
          v-if="listProblems.length"
          class="space-y-0.5"
          data-steps-problems
        >
          <li
            v-for="message in listProblems"
            :key="message"
            class="text-[12px] leading-4 text-error"
            data-steps-problem
          >
            {{ message }}
          </li>
        </ul>

        <div
          class="space-y-2"
          data-step-list
        >
          <div
            v-for="(entry, index) in draft.steps"
            :key="entry.key"
            class="relative"
            :data-step-key="entry.key"
            @dragover="onDragOver($event, index)"
            @drop.prevent="onDrop"
          >
            <div
              v-if="dropSlot === index"
              class="pointer-events-none absolute inset-x-1 -top-1.5 h-0.5 rounded-full bg-(--editor-selection)"
            />
            <div
              v-if="dropSlot === index + 1 && index === draft.steps.length - 1"
              class="pointer-events-none absolute inset-x-1 -bottom-1.5 h-0.5 rounded-full bg-(--editor-selection)"
            />
            <DataStepCard
              :entry="entry"
              :index="index"
              :count="draft.steps.length"
              :scope="scopeAt(ctx.model, ctx.action, draft.steps.map(item => item.step), index)"
              :ctx="ctx"
              :errors="draft.errors"
              :problems="stepProblems(index)"
              :refused="refusedSteps.includes(index)"
              :open="open.has(entry.key)"
              :dragging="dragKey === entry.key"
              @toggle="toggle(entry.key)"
              @update:step="update(index, $event)"
              @add-error="addErrorTo"
              @move="move(index, $event)"
              @duplicate="duplicate(index)"
              @remove="remove(index)"
              @json="editor.dataTab = 'json'"
              @drag-start="onDragStart($event, entry.key)"
              @drag-end="onDragEnd"
            />
          </div>
          <p
            v-if="!draft.steps.length"
            class="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-dimmed"
            data-steps-empty
          >
            No steps yet. Add the first one with “Add step”.
          </p>
        </div>
      </section>

      <DataActionErrors
        v-model:draft="draft"
        :problems="errorProblems"
        :refused="refusedErrors"
      />
    </div>

    <footer
      class="sticky bottom-0 border-t border-white/6 bg-(--editor-canvas) px-0.5 py-3"
      data-steps-footer
    >
      <div class="flex w-full max-w-2xl items-start gap-3">
        <p
          v-if="error"
          class="min-w-0 flex-1 rounded-lg bg-error/10 px-3 py-2 text-[12px] leading-4 text-error"
          role="alert"
          data-steps-error
        >
          {{ error }}
        </p>
        <p
          v-else-if="dirty && problems.length"
          class="min-w-0 flex-1 self-center text-[12px] text-muted"
          data-steps-blocked
        >
          Fix {{ problems.length }} {{ problems.length === 1 ? 'problem' : 'problems' }} to save.
        </p>
        <span
          v-else
          class="flex-1"
        />
        <span
          v-if="dirty"
          class="flex h-[30px] shrink-0 items-center text-[12px] text-muted"
          data-steps-unsaved
        >Unsaved changes</span>
        <EditorButton
          label="Discard"
          :disabled="!dirty"
          data-steps-discard
          @click="discard"
        />
        <EditorButton
          variant="primary"
          label="Save"
          :loading="saving"
          :disabled="!dirty || stale || problems.length > 0"
          data-steps-save
          @click="save"
        />
      </div>
    </footer>
  </div>
</template>
