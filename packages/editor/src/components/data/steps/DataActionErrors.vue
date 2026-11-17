<script setup lang="ts">
import { addError, renameError } from '../../../editor/stepDraft.ts'
import type { DraftError, StepProblem, StepsDraft } from '../../../editor/stepDraft.ts'
import { fieldTypeItems } from '../../../shared/dataModel.ts'
import type { FieldType } from '../../../shared/dataModel.ts'

/**
 * The errors an action declares (S10, D10c), below its steps: a refuse or a load names one by its name, so they are edited
 * with the steps and saved with them. Each has a name, an HTTP status and a message (`{name}` in it reads what the error
 * carries) and a list of what it carries: a step that raises it gives each one a value. Renaming an error renames it in the
 * steps that raise it; removing one that a step raises is left for the step to say.
 */
const { draft, problems, refused } = defineProps<{
  draft: StepsDraft
  /** The problems of the errors (those with an `error` place). */
  problems: StepProblem[]
  /** The errors a refusal of the module names. */
  refused: number[]
}>()
const emit = defineEmits<{ 'update:draft': [draft: StepsDraft] }>()

const edit = (index: number, patch: Partial<DraftError>) => emit('update:draft', { ...draft, errors: draft.errors.map((error, at) => at === index ? { ...error, ...patch } : error) })
const here = (index: number) => problems.filter(problem => problem.error === index).map(problem => problem.message)
const editData = (index: number, at: number, patch: Partial<DraftError['data'][number]>) => edit(index, { data: draft.errors[index]!.data.map((entry, place) => place === at ? { ...entry, ...patch } : entry) })
</script>

<template>
  <section
    class="space-y-2"
    data-action-errors
  >
    <div class="flex items-center">
      <h3 class="flex-1 text-[12px] font-[550] text-highlighted">
        Errors
      </h3>
      <EditorButton
        icon="i-lucide-plus"
        variant="ghost"
        size="xs"
        aria-label="Add error"
        data-error-add
        @click="emit('update:draft', addError(draft, {}))"
      />
    </div>
    <p
      v-if="!draft.errors.length"
      class="text-xs text-dimmed"
    >
      No errors. A step that refuses names one of these: its name, the HTTP status the client gets and a message.
    </p>
    <div
      v-for="(error, index) in draft.errors"
      :key="index"
      class="space-y-2 rounded-xl border bg-white/3 p-3"
      :class="here(index).length || refused.includes(index) ? 'border-error/50' : 'border-white/8'"
      :data-error-row="index"
      :data-error-refused="refused.includes(index) ? '' : undefined"
    >
      <div class="grid grid-cols-[minmax(0,1fr)_72px_minmax(0,2fr)_auto] items-center gap-2">
        <EditorInput
          :model-value="error.type"
          placeholder="slug_taken"
          aria-label="Error name"
          mono
          data-error-field="type"
          @update:model-value="emit('update:draft', renameError(draft, index, $event))"
        />
        <EditorInput
          :model-value="error.status"
          inputmode="numeric"
          placeholder="409"
          aria-label="Error status"
          data-error-field="status"
          @update:model-value="edit(index, { status: $event })"
        />
        <EditorInput
          :model-value="error.message"
          placeholder="The message the client gets"
          aria-label="Error message"
          data-error-field="message"
          @update:model-value="edit(index, { message: $event })"
        />
        <EditorButton
          icon="i-lucide-x"
          variant="ghost"
          size="xs"
          :aria-label="`Remove error ${error.type}`"
          data-error-remove
          @click="emit('update:draft', { ...draft, errors: draft.errors.filter((_, at) => at !== index) })"
        />
      </div>
      <div
        v-for="(entry, at) in error.data"
        :key="at"
        class="grid grid-cols-[minmax(0,1fr)_132px_auto] items-center gap-2 ps-4"
        :data-error-data="at"
      >
        <EditorInput
          :model-value="entry.name"
          placeholder="carries…"
          :aria-label="`Name of what ${error.type} carries`"
          mono
          data-error-data-name
          @update:model-value="editData(index, at, { name: $event })"
        />
        <EditorSelect
          :model-value="entry.type"
          :items="fieldTypeItems"
          :aria-label="`Type of ${entry.name}`"
          data-error-data-type
          @update:model-value="editData(index, at, { type: $event as FieldType })"
        />
        <EditorButton
          icon="i-lucide-x"
          variant="ghost"
          size="xs"
          :aria-label="`Remove ${entry.name} from ${error.type}`"
          data-error-data-remove
          @click="edit(index, { data: error.data.filter((_, place) => place !== at) })"
        />
      </div>
      <EditorButton
        label="Carries a value…"
        variant="ghost"
        size="xs"
        :aria-label="`Add a value ${error.type} carries`"
        data-error-data-add
        @click="edit(index, { data: [...error.data, { name: '', type: 'text' }] })"
      />
      <ul
        v-if="here(index).length"
        class="space-y-0.5"
      >
        <li
          v-for="message in here(index)"
          :key="message"
          class="text-[12px] leading-4 text-error"
          data-error-problem
        >
          {{ message }}
        </li>
      </ul>
    </div>
  </section>
</template>
