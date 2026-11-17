<script setup lang="ts">
import { computed } from 'vue'
import { KIND_LABELS, isEditable } from '../../../editor/stepDraft.ts'
import type { DraftError, DraftStep, StepsContext } from '../../../editor/stepDraft.ts'
import type { Step, StepScope } from '../../../editor/stepScope.ts'
import { FOCUS_RING } from '../../../editorUi.ts'
import { stepSummary } from '../../../shared/dataArtifacts.ts'

/**
 * One step of the Steps tab (S10, D10c): its place and kind, a sentence of what it does (`stepSummary`) and, opened, the form of
 * its fields (`DataStepForm`). The problems the editor found in it are always shown, and the card is marked when the module's
 * refusal names it. Its controls move it one place (the buttons are the keyboard's way: the grip drags), copy it and remove it.
 * `call` and `custom` are not generated yet: they show read-only, with a way to the JSON tab, and can still be moved or removed.
 */
const { entry, index, count, scope, ctx, errors, problems, refused, open } = defineProps<{
  entry: DraftStep
  index: number
  count: number
  scope: StepScope
  ctx: StepsContext
  errors: DraftError[]
  problems: string[]
  /** The module's refusal named this step. */
  refused: boolean
  open: boolean
  dragging: boolean
}>()
const emit = defineEmits<{
  'toggle': []
  'update:step': [step: Step]
  'add-error': [error: Partial<DraftError>]
  'move': [by: -1 | 1]
  'duplicate': []
  'remove': []
  'json': []
  'drag-start': [event: DragEvent]
  'drag-end': []
}>()

const place = computed(() => index + 1)
const editable = computed(() => isEditable(entry.step))
const summary = computed(() => stepSummary(entry.step, ctx.model))
</script>

<template>
  <div
    class="group/step rounded-xl border bg-white/3"
    :class="[problems.length || refused ? 'border-error/50' : 'border-white/8', { 'opacity-40': dragging }]"
    :data-step-card="index"
    :data-step-kind="entry.step.kind"
    :data-step-invalid="problems.length || refused ? '' : undefined"
    :data-step-refused="refused ? '' : undefined"
  >
    <div class="flex items-center gap-1 ps-1 pe-2">
      <span
        draggable="true"
        class="grid h-10 w-5 shrink-0 cursor-grab place-items-center text-dimmed opacity-0 group-hover/step:opacity-100 hover:text-highlighted focus-within:opacity-100 active:cursor-grabbing"
        :aria-label="`Drag to reorder step ${place}`"
        title="Drag to reorder"
        data-step-handle
        @dragstart="emit('drag-start', $event)"
        @dragend="emit('drag-end')"
      >
        <UIcon
          name="i-lucide-grip-vertical"
          class="size-3.5"
        />
      </span>
      <button
        type="button"
        class="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left"
        :class="FOCUS_RING"
        :aria-expanded="open"
        :aria-label="`Step ${place}: ${KIND_LABELS[entry.step.kind] ?? entry.step.kind}`"
        data-step-toggle
        @click="emit('toggle')"
      >
        <UIcon
          :name="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="size-3.5 shrink-0 text-dimmed"
        />
        <span class="w-4 shrink-0 text-[11px] text-dimmed">{{ place }}</span>
        <span
          class="shrink-0 rounded-md bg-white/8 px-1.5 py-0.5 text-[11px] font-[550] text-highlighted"
          data-step-label
        >{{ KIND_LABELS[entry.step.kind] ?? entry.step.kind }}</span>
        <span
          class="min-w-0 flex-1 truncate text-[12px] text-toned"
          data-step-summary
        >{{ summary }}</span>
        <span
          v-if="!editable"
          class="shrink-0 rounded-md bg-warning/15 px-1.5 py-0.5 text-[11px] text-warning"
          data-step-not-generated
        >Not generated yet</span>
      </button>
      <EditorButton
        icon="i-lucide-arrow-up"
        variant="ghost"
        size="xs"
        :disabled="index === 0"
        :aria-label="`Move step ${place} up`"
        data-step-up
        @click="emit('move', -1)"
      />
      <EditorButton
        icon="i-lucide-arrow-down"
        variant="ghost"
        size="xs"
        :disabled="index === count - 1"
        :aria-label="`Move step ${place} down`"
        data-step-down
        @click="emit('move', 1)"
      />
      <EditorButton
        v-if="editable"
        icon="i-lucide-copy"
        variant="ghost"
        size="xs"
        :aria-label="`Duplicate step ${place}`"
        data-step-duplicate
        @click="emit('duplicate')"
      />
      <EditorButton
        icon="i-lucide-trash-2"
        variant="ghost"
        size="xs"
        :aria-label="`Remove step ${place}`"
        data-step-remove
        @click="emit('remove')"
      />
    </div>

    <ul
      v-if="problems.length"
      class="space-y-0.5 px-4 pb-2.5 ps-10"
      data-step-problems
    >
      <li
        v-for="problem in problems"
        :key="problem"
        class="text-[12px] leading-4 text-error"
        data-step-problem
      >
        {{ problem }}
      </li>
    </ul>

    <p
      v-if="!editable"
      class="border-t border-white/6 px-4 py-2.5 ps-10 text-[12px] text-toned"
      data-step-readonly
    >
      This step is not generated yet, so it cannot be edited here.
      <button
        type="button"
        class="text-muted underline underline-offset-2 hover:text-highlighted"
        data-step-json
        @click="emit('json')"
      >
        Edit it in JSON
      </button>
    </p>
    <div
      v-else-if="open"
      class="border-t border-white/6 px-4 py-3"
    >
      <DataStepForm
        :step="entry.step"
        :scope="scope"
        :ctx="ctx"
        :errors="errors"
        @update:step="emit('update:step', $event)"
        @add-error="emit('add-error', $event)"
      />
    </div>
  </div>
</template>
