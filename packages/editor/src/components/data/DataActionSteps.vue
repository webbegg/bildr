<script setup lang="ts">
import { computed, nextTick, reactive, useTemplateRef } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ActionFile, Model } from '@bildr/codegen/model'
import { attempt } from '../../editor/dataArtifactActions.ts'
import { ADDABLE_KINDS, NOT_GENERATED_KINDS, addError, addStep, changedOutside, changesOf, contextOf, draftOf, duplicateStep, errorsNamed, moveStep, problemsOf, rebaseDraft, removeStep, renameLoad, stepsNamed } from '../../editor/stepDraft.ts'
import type { AddableKind, DraftError, StepsDraft } from '../../editor/stepDraft.ts'
import type { Step } from '../../editor/stepExpr.ts'
import { scopeAt } from '../../editor/stepScope.ts'
import { useDraftForm } from '../../editor/useDraftForm.ts'
import { provideDisabled } from '../kit/formDisabled.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { useStepDrag } from '../../editor/useStepDrag.ts'

/**
 * An action's Steps tab (S10, D10c): the list of its steps, each a card (`DataStepCard`) with the form of its fields, and below
 * them the errors the steps refuse with (`DataActionErrors`). A step is added from a menu of its kinds, moved (the grip drags;
 * the up and down buttons are the keyboard's way), copied and removed. Edits are a draft, saved with one `action_update` that
 * sends `steps` and, when they changed, `errors` (`editor/stepDraft.ts`); what the module refuses is shown under the form with the
 * draft kept, and the step it names is marked (a refusal that names none is shown at the top, with nothing marked). While a save is
 * in flight the form's controls are disabled (`kit/formDisabled.ts`).
 *
 * What the editor can tell before asking (a name used before a step gives it, an error that is not declared, a field left empty,
 * a return that may not run) is said on the card and blocks Save; the module stays the authority and checks it all again.
 *
 * The draft, its base and the notice for an action that changed under it are the shared draft form, as the query Definition has
 * (`useDraftForm`, `DataStaleNotice`, `DataDraftFooter`): the stored action differing from the base in the steps or the errors
 * while the draft has edits asks to load the new version or keep the edits, and the unsaved draft is the workspace's `dataDirty`.
 * The first step's card is open to start with.
 */
const { action } = defineProps<{ action: ActionFile }>()
const editor = useEditor()
const root = useTemplateRef<HTMLElement>('root')

const ctx = computed(() => contextOf(editor.model as Model, action))

/** The steps whose form is open, by key. */
const open = reactive(new Set<number>())

/** The cards that were open stay open, by place, as the draft is replaced; another action starts with its first card open. */
function reopen(before: StepsDraft, after: StepsDraft, switched: boolean) {
  const places = switched ? [0] : before.steps.flatMap((entry, at) => open.has(entry.key) ? [at] : [])
  open.clear()
  for (const at of places) if (at < after.steps.length) open.add(after.steps[at]!.key)
}

const { draft, base, error, saving, dirty, stale, discard, keepMine } = useDraftForm<ActionFile, StepsDraft>({
  stored: () => action,
  id: () => action.id,
  label: () => action.label || action.name,
  open: draftOf,
  dirty: (current, was) => Object.keys(changesOf(current, was).input).length > 0,
  changedOutside,
  rebase: rebaseDraft,
  reset: reopen
})
reopen({ steps: [], errors: [] }, draft.value, true)
provideDisabled(saving)

const changes = computed(() => changesOf(draft.value, base.value).input)
const problems = computed(() => problemsOf(draft.value, ctx.value))
const listProblems = computed(() => problems.value.filter(problem => problem.step === undefined && problem.error === undefined).map(problem => problem.message))
const errorProblems = computed(() => problems.value.filter(problem => problem.error !== undefined))
const stepProblems = (index: number) => problems.value.filter(problem => problem.step === index).map(problem => problem.message)
const refusedSteps = computed(() => error.value ? stepsNamed(error.value, draft.value.steps) : [])
const refusedErrors = computed(() => error.value ? errorsNamed(error.value, draft.value.errors) : [])
/** The module's refusal names nothing the form shows: it is said at the top, and nothing is marked. */
const unplaced = computed(() => error.value !== '' && !refusedSteps.value.length && !refusedErrors.value.length)
const blocked = computed(() => dirty.value && problems.value.length ? `Fix ${problems.value.length} ${problems.value.length === 1 ? 'problem' : 'problems'} to save.` : undefined)

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
  ADDABLE_KINDS.map(entry => ({ label: entry.label, description: entry.hint, onSelect: () => add(entry.kind) })),
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

const drag = useStepDrag(() => draft.value.steps, (from, to) => {
  draft.value = moveStep(draft.value, from, to)
}, () => saving.value)

function jumpToErrors() {
  root.value?.querySelector('[data-action-errors]')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
}
</script>

<template>
  <!-- The footer is at the bottom of the area when the list is short, and sticks to it when it scrolls. -->
  <div
    ref="root"
    class="flex size-full flex-col overflow-y-auto"
    data-action-steps
  >
    <div class="w-full max-w-3xl flex-1 space-y-6 px-4 py-4">
      <DataStaleNotice
        v-if="stale"
        prefix="steps"
        title="This action changed since you started editing"
        description="Your edits are still here. Load the new version to drop them, or keep them: only the part you changed (the steps or the errors) replaces the new version when you save."
        @load-new="discard"
        @keep-mine="keepMine"
      />

      <p
        v-if="unplaced"
        class="rounded-lg bg-error/10 px-3 py-2 text-[12px] leading-4 text-error"
        role="alert"
        data-steps-refusal
      >
        {{ error }}
      </p>

      <div
        class="min-w-0 space-y-6"
        data-steps-fields
      >
        <section class="space-y-3">
          <div class="flex items-center gap-2">
            <div class="min-w-0 flex-1">
              <h3 class="text-[12px] font-[550] text-highlighted">
                Steps
              </h3>
              <p class="text-xs text-dimmed">
                They run in order. A write, or a return that always runs, comes last.
              </p>
            </div>
            <EditorButton
              :label="`Errors (${draft.errors.length})`"
              icon="i-lucide-arrow-down"
              variant="ghost"
              size="xs"
              data-errors-jump
              @click="jumpToErrors"
            />
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
              @dragover="drag.over($event, index)"
              @drop.prevent="drag.drop"
            >
              <div
                v-if="drag.dropSlot.value === index"
                class="pointer-events-none absolute inset-x-1 -top-1.5 h-0.5 rounded-full bg-(--editor-selection)"
              />
              <div
                v-if="drag.dropSlot.value === index + 1 && index === draft.steps.length - 1"
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
                :dragging="drag.dragKey.value === entry.key"
                :locked="saving"
                @toggle="toggle(entry.key)"
                @update:step="update(index, $event)"
                @rename="draft = renameLoad(draft, index, $event)"
                @add-error="addErrorTo"
                @move="move(index, $event)"
                @duplicate="duplicate(index)"
                @remove="remove(index)"
                @json="editor.dataTab = 'json'"
                @drag-start="drag.start($event, entry.key)"
                @drag-end="drag.end"
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
    </div>

    <DataDraftFooter
      prefix="steps"
      inner="max-w-3xl px-4"
      :error="error"
      :note="blocked"
      :dirty="dirty"
      :saving="saving"
      :disabled="!dirty || stale || problems.length > 0"
      @discard="discard"
      @save="save"
    />
  </div>
</template>
