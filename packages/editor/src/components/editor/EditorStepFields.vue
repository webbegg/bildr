<script setup lang="ts">
import { computed } from 'vue'
import { BUTTON_COLORS } from '@bildr/codegen/render'
import { expressionText } from '../../shared/bindings.ts'
import { routeParams } from '../../shared/interactionValues.ts'
import {
  actionsFor, actionUse, pagesFor, stateAlias, stateFor, statesFor, STEP_KIND_LABELS, textScope, valueModes
} from '../../shared/nodeInteractions.ts'
import { stateLabel } from '../../shared/stateModel.ts'
import { pageOptionLabel } from '../../shared/sidebar.ts'
import type { Env, StepDraft, ValueDraft } from '../../shared/nodeInteractions.ts'

/**
 * One step of an interaction (B3, S2), the form of its kind:
 *
 * - **Set state:** the state and one of its fields (the states of the page's module, used by the page yet or not: the module makes
 *   the page use it), and the value (`EditorStepValue`);
 * - **Run action:** the action (one it can't run from this node is listed with why it can't) and what it gets: the form's values
 *   inside a Form, else its one parameter's value;
 * - **Go to page:** the page, and a value for each `:segment` of its path;
 * - **Show message:** the title and the description (text where `{name}` binds what the node can read), the color and an icon;
 * - **Written by hand:** a step of a kind the editor doesn't make (a `setVariant`) is a read-only card that can be removed, and is
 *   written back as it was.
 *
 * It edits a draft: each change goes up whole (`update`) and the interaction writes it once every step is complete. What a step
 * still needs shows under it, and the module's refusal of the step in red.
 */
const props = defineProps<{ step: StepDraft, index: number, steps: StepDraft[], env: Env, problems: string[], refusal: string | null, removable: boolean }>()
const emit = defineEmits<{ update: [step: StepDraft], remove: [] }>()

const NONE = '__none'
const label = computed(() => STEP_KIND_LABELS[props.step.kind])
const after = computed(() => props.index > 0 && props.steps[0]?.kind === 'runAction')

const states = computed(() => statesFor(props.env).map(state => ({ label: stateLabel(state), value: state.id })))
const fields = computed(() => {
  const step = props.step
  return step.kind === 'setState' ? stateFor(props.env, step.state)?.fields.map(field => ({ label: field.name, value: field.name })) ?? [] : []
})
const actions = computed(() => actionsFor(props.env).map((action) => {
  const use = actionUse(props.env, action)
  const name = action.label || action.name
  return use.how === 'no' ? { label: `${name} (${use.why.charAt(0).toLowerCase()}${use.why.slice(1)})`, value: action.id, disabled: true } : { label: name, value: action.id }
}))
const pages = computed(() => pagesFor(props.env).map(page => ({ label: pageOptionLabel(page), value: page.id })))
const colors = [{ label: 'None', value: NONE }, ...BUTTON_COLORS.map(color => ({ label: color, value: color }))]
const names = computed(() => textScope(props.env))

/** Whether the page already uses the state or action the step names: when it doesn't, the module makes it use it. */
const adds = computed(() => {
  const step = props.step
  if (step.kind === 'setState' && step.state) return !stateAlias(props.env, step.state)
  if (step.kind === 'runAction' && step.action) return props.env.place.kind === 'page' && !pageUsesAction(step.action)
  return false
})
const pageUsesAction = (id: string): boolean => {
  const page = Object.values(props.env.model.modules).flatMap(mod => mod.pages).find(entry => entry.id === props.env.place.file)
  return !!page?.uses?.actions?.some(use => use.action === id)
}

function chooseState(id: string) {
  if (props.step.kind !== 'setState') return
  const only = stateFor(props.env, id)?.fields
  // A state with one field has nothing to choose between.
  emit('update', { ...props.step, state: id, field: only?.length === 1 ? only[0]!.name : '', value: { kind: 'none' } })
}

function chooseAction(id: string) {
  if (props.step.kind !== 'runAction') return
  const action = actionsFor(props.env).find(entry => entry.id === id)
  const use = action ? actionUse(props.env, action) : undefined
  emit('update', {
    ...props.step,
    action: id,
    args: use?.how === 'form' ? { mode: 'form' } : use?.how === 'param' ? { mode: 'param', name: use.name, value: { kind: 'none' } } : { mode: 'none' }
  })
}

function choosePage(id: string) {
  if (props.step.kind !== 'navigate') return
  // The values given for the other page's segments don't carry over.
  emit('update', { ...props.step, page: id, params: {} })
}

function setParam(name: string, value: ValueDraft) {
  if (props.step.kind === 'navigate') emit('update', { ...props.step, params: { ...props.step.params, [name]: value } })
}

const paramNames = computed(() => {
  const step = props.step
  const page = step.kind === 'navigate' ? pagesFor(props.env).find(entry => entry.id === step.page) : undefined
  return page ? routeParams(page) : []
})

const setStateModes = computed(() => (props.step.kind === 'setState' ? valueModes(props.env, props.steps, props.index) : undefined))
/** The chosen action is one that takes no input: the step has nothing to ask. */
const takesNoInput = computed(() => {
  const step = props.step
  const action = step.kind === 'runAction' ? actionsFor(props.env).find(entry => entry.id === step.action) : undefined
  return !!action && actionUse(props.env, action).how === 'none'
})
const paramModes = computed(() => (props.step.kind === 'runAction' && props.step.args.mode === 'param' ? valueModes(props.env, props.steps, props.index) : undefined))
const navigateModes = (name: string) => valueModes(props.env, props.steps, props.index, name)

function setArg(value: ValueDraft) {
  if (props.step.kind === 'runAction' && props.step.args.mode === 'param') emit('update', { ...props.step, args: { ...props.step.args, value } })
}

const text = (value: string | { keep: unknown }): string => (typeof value === 'string' ? value : '')
const kept = (value: string | { keep: unknown }): string | undefined => (typeof value === 'string' ? undefined : expressionText(value.keep as Record<string, never>))
function setText(key: 'title' | 'description', value: string) {
  if (props.step.kind === 'toast') emit('update', { ...props.step, [key]: value })
}
</script>

<template>
  <div
    class="space-y-2 rounded-lg bg-white/3 p-2"
    :data-step="index"
    :data-step-kind="step.kind"
  >
    <div class="flex h-6 items-center gap-1.5">
      <span class="grid size-4 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] font-[550] text-toned tabular-nums">{{ index + 1 }}</span>
      <span class="min-w-0 flex-1 truncate text-[12px] font-[550] text-highlighted">{{ label }}</span>
      <span
        v-if="after"
        class="shrink-0 text-[10px] text-dimmed"
        data-step-when
      >if it worked</span>
      <EditorButton
        v-if="removable"
        icon="i-lucide-x"
        size="xs"
        variant="ghost"
        :aria-label="`Remove step ${index + 1}, ${label}`"
        data-step-remove
        @click="emit('remove')"
      />
    </div>

    <p
      v-if="step.kind === 'unknown'"
      class="text-[11px] text-dimmed"
      data-step-unknown
    >
      This step was written by hand and can't be edited here.
    </p>

    <template v-else-if="step.kind === 'setState'">
      <EditorRow label="State">
        <EditorSelect
          :model-value="step.state || undefined"
          :items="states"
          placeholder="Choose a state"
          aria-label="State"
          data-step-state
          @update:model-value="chooseState"
        />
      </EditorRow>
      <EditorRow
        v-if="step.state"
        label="Field"
      >
        <EditorSelect
          :model-value="step.field || undefined"
          :items="fields"
          placeholder="Choose a field"
          aria-label="Field"
          data-step-field
          @update:model-value="emit('update', { ...step, field: $event, value: { kind: 'none' } })"
        />
      </EditorRow>
      <EditorRow
        v-if="step.field && setStateModes"
        label="To"
      >
        <EditorStepValue
          :modes="setStateModes"
          :value="step.value"
          label="Value"
          @update="emit('update', { ...step, value: $event })"
        />
      </EditorRow>
    </template>

    <template v-else-if="step.kind === 'runAction'">
      <EditorRow label="Action">
        <EditorSelect
          :model-value="step.action || undefined"
          :items="actions"
          placeholder="Choose an action"
          aria-label="Action"
          data-step-action
          @update:model-value="chooseAction"
        />
      </EditorRow>
      <EditorRow
        v-if="step.args.mode === 'form'"
        label="Input"
      >
        <p
          class="text-[11px] text-dimmed"
          data-step-form
        >
          The values of the form
        </p>
      </EditorRow>
      <EditorRow
        v-else-if="step.args.mode === 'none' && takesNoInput"
        label="Input"
      >
        <p
          class="text-[11px] text-dimmed"
          data-step-no-input
        >
          This action takes no input
        </p>
      </EditorRow>
      <EditorRow
        v-else-if="step.args.mode === 'param' && paramModes"
        :label="step.args.name"
      >
        <EditorStepValue
          :modes="paramModes"
          :value="step.args.value"
          :label="step.args.name"
          @update="setArg"
        />
      </EditorRow>
    </template>

    <template v-else-if="step.kind === 'navigate'">
      <EditorRow label="Page">
        <EditorSelect
          :model-value="step.page || undefined"
          :items="pages"
          placeholder="Choose a page"
          aria-label="Page"
          data-step-page
          @update:model-value="choosePage"
        />
      </EditorRow>
      <EditorRow
        v-for="name in paramNames"
        :key="name"
        :label="name"
        :title="`The :${name} of the page's address`"
      >
        <EditorStepValue
          :modes="navigateModes(name)"
          :value="step.params[name] ?? { kind: 'none' }"
          :label="name"
          @update="setParam(name, $event)"
        />
      </EditorRow>
    </template>

    <template v-else>
      <EditorRow label="Title">
        <p
          v-if="kept(step.title)"
          class="truncate font-mono text-[11px] text-toned"
          :title="kept(step.title)"
        >
          {{ kept(step.title) }}
        </p>
        <EditorCommitInput
          v-else
          :model-value="text(step.title)"
          variables
          :names="names"
          aria-label="Title"
          data-step-title
          @commit="setText('title', $event)"
        />
      </EditorRow>
      <EditorRow label="Description">
        <p
          v-if="kept(step.description)"
          class="truncate font-mono text-[11px] text-toned"
          :title="kept(step.description)"
        >
          {{ kept(step.description) }}
        </p>
        <EditorCommitInput
          v-else
          :model-value="text(step.description)"
          variables
          :names="names"
          placeholder="Optional"
          aria-label="Description"
          data-step-description
          @commit="setText('description', $event)"
        />
      </EditorRow>
      <EditorRow label="Color">
        <EditorSelect
          :model-value="step.color || NONE"
          :items="colors"
          aria-label="Color"
          data-step-color
          @update:model-value="emit('update', { ...step, color: $event === NONE ? '' : $event })"
        />
      </EditorRow>
      <EditorRow label="Icon">
        <EditorIconInput
          :model-value="step.icon"
          aria-label="Icon"
          data-step-icon
          @commit="emit('update', { ...step, icon: $event })"
        />
      </EditorRow>
    </template>

    <p
      v-if="adds && !refusal"
      class="text-[11px] text-dimmed"
      data-step-adds
    >
      {{ step.kind === 'setState' ? 'The page starts using this state.' : 'The page starts using this action.' }}
    </p>
    <p
      v-for="problem in problems"
      :key="problem"
      class="text-[11px] text-dimmed"
      data-step-problem
    >
      {{ problem }}
    </p>
    <p
      v-if="refusal"
      class="text-[11px] text-error"
      role="alert"
      data-step-error
    >
      {{ refusal }}
    </p>
  </div>
</template>
