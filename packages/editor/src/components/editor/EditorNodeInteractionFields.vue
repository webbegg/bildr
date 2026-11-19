<script setup lang="ts">
import { computed } from 'vue'
import type { ModelNode } from '@bildr/codegen/model'
import { heldBy, useInteractionDraft } from '../../editor/useInteractionDraft.ts'
import type { OpenInteraction } from '../../editor/useInteractionDraft.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { addableKinds, eventChoices, STEP_KIND_LABELS } from '../../shared/nodeInteractions.ts'
import type { NodeEvent } from '../../shared/nodeInteractions.ts'

/**
 * A node's interaction opened under its row in the inspector (B3, S2): "When <event> → steps". The event, the steps in order
 * (`EditorStepFields`) and the "Add step" menu that lists only the kinds the module accepts next. It edits a draft and writes it on
 * commit (a choice, or a box left) once every step is complete (`useInteractionDraft`: the queue the writes go through, the
 * draft's refusals, and what happens when the model changes under it). A step that is not complete yet stays in the form and says
 * what it needs; nothing half-made is sent. The interaction is removed from its row, not from here.
 *
 * The module's refusal shows on the step it names ("step 2 (…)"), else under the steps; the draft stays so it can be fixed. When
 * the interaction changed since it was opened, the form says so and offers the latest: it writes nothing before.
 */
const props = defineProps<{ node: ModelNode, open: OpenInteraction }>()
const emit = defineEmits<{ saved: [index: number], gone: [] }>()

const draft = useInteractionDraft({ node: () => props.node, open: props.open, saved: index => emit('saved', index), gone: () => emit('gone') })
const { env, drafts, problems, pending, refusal, stale, current, at } = draft

const held = heldBy(useEditor())
/** The events the node has, and the ones another new interaction of it is being made for (not saved yet). */
const taken = computed<NodeEvent[]>(() => [
  ...(props.node.interactions ?? []).flatMap((entry, position) => (position === at.value ? [] : [entry.on])),
  ...[...held.values()].filter(entry => entry.nodeId === props.node.id && entry.file === env.value?.place.file && entry.at === null && entry.session !== props.open.session).map(entry => entry.current)
])
const usesSetState = computed(() => drafts.value.some(step => step.kind === 'setState'))
const usesEvent = computed(() => drafts.value.some(step => step.kind === 'setState' && step.value.kind === 'event'))
const events = computed(() => eventChoices(props.node.type, taken.value).map((choice) => {
  if (choice.disabled) return { label: choice.hint ? `${choice.label} (${choice.hint.toLowerCase()})` : choice.label, value: choice.on, disabled: true }
  if (usesSetState.value && choice.on === 'submit') return { label: `${choice.label} (can't set state)`, value: choice.on, disabled: true }
  if (usesEvent.value && choice.on !== 'change') return { label: `${choice.label} (uses the control's value)`, value: choice.on, disabled: true }
  return { label: choice.label, value: choice.on }
}))

const addable = computed(() => (env.value ? addableKinds(drafts.value.map(step => step.kind), current.value, env.value.place.kind) : []))
const addItems = computed(() => addable.value.map(kind => ({ label: STEP_KIND_LABELS[kind], onSelect: () => draft.addStep(kind) })))
const noMore = computed(() => {
  if (!drafts.value.length || addable.value.length) return ''
  if (drafts.value.some(step => step.kind === 'unknown')) return 'Remove the step written by hand to add others.'
  return drafts.value[0]!.kind === 'setState' ? 'Set state runs on its own. Remove it to run an action, go to a page or show a message.' : 'No more steps fit after these.'
})
</script>

<template>
  <div
    v-if="env"
    class="space-y-2"
    data-node-interaction-fields
  >
    <div
      v-if="stale"
      class="space-y-1.5 rounded-lg bg-warning/10 p-2 text-[11px] text-warning"
      role="alert"
      data-interaction-stale
    >
      <p>This interaction changed since you opened it. Nothing is written until you load the latest{{ pending ? '; what you changed here stays until then' : '' }}.</p>
      <EditorButton
        label="Load the latest"
        size="xs"
        variant="soft"
        data-interaction-reload
        @click="draft.reload()"
      />
    </div>
    <EditorRow label="When">
      <EditorSelect
        :model-value="current"
        :items="events"
        :disabled="stale"
        aria-label="Event"
        data-interaction-event
        @update:model-value="draft.setEvent($event as NodeEvent)"
      />
    </EditorRow>

    <EditorStepFields
      v-for="(step, position) in drafts"
      :key="position"
      :step="step"
      :index="position"
      :steps="drafts"
      :env="env"
      :problems="problems[position] ?? []"
      :refusal="refusal?.step === position ? refusal.text : null"
      :removable="at === null || drafts.length > 1"
      @update="draft.setStep(position, $event)"
      @remove="draft.removeStep(position)"
    />

    <p
      v-if="!drafts.length"
      class="text-[11px] text-dimmed"
      data-interaction-empty
    >
      What should happen? Add a step.
    </p>
    <p
      v-if="noMore"
      class="text-[11px] text-dimmed"
      data-interaction-no-more
    >
      {{ noMore }}
    </p>
    <p
      v-if="refusal && refusal.step === null"
      class="text-[11px] text-error"
      role="alert"
      data-interaction-error
    >
      {{ refusal.text }}
    </p>
    <p
      v-if="pending && drafts.length && !refusal && !stale"
      class="text-[11px] text-dimmed"
      data-interaction-pending
    >
      Not saved yet: finish the steps above.
    </p>

    <EditorMenu
      v-if="addItems.length"
      :items="addItems"
    >
      <EditorButton
        label="Add step"
        icon="i-lucide-plus"
        size="xs"
        variant="soft"
        :disabled="stale"
        data-interaction-add-step
      />
    </EditorMenu>
  </div>
</template>
