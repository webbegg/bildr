<script setup lang="ts">
import { patched } from '../../../editor/stepExpr.ts'
import type { Step } from '../../../editor/stepExpr.ts'
import type { DraftError, StepsContext } from '../../../editor/stepDraft.ts'
import type { StepScope } from '../../../editor/stepScope.ts'

/**
 * A Load step (S10, D10c): reads a row and gives it a name later steps read it by (`as`). Its lookup (`DataStepLookup`) and
 * what happens when there is none: it refuses with an error, or carries on without the row (`DataStepErrorPicker`). The name is
 * renamed through `rename`, not `update:step`, because the steps after it read the row by it.
 */
const { step, scope, ctx, errors } = defineProps<{
  step: Step
  scope: StepScope
  ctx: StepsContext
  errors: DraftError[]
}>()
const emit = defineEmits<{ 'update:step': [step: Step], 'add-error': [error: Partial<DraftError>], 'rename': [name: string] }>()
</script>

<template>
  <EditorFormRow
    label="Name"
    help="What later steps call the row"
  >
    <EditorInput
      :model-value="typeof step.as === 'string' ? step.as : ''"
      placeholder="post"
      aria-label="Name of the loaded row"
      mono
      data-step-field="as"
      @update:model-value="emit('rename', $event)"
    />
  </EditorFormRow>
  <DataStepLookup
    :call="step"
    :scope="scope"
    :ctx="ctx"
    @change="emit('update:step', patched(step, $event))"
  />
  <DataStepErrorPicker
    :step="step"
    field="orError"
    :scope="scope"
    :errors="errors"
    label="If there is none"
    help="Refuses with an error, or carries on without the row"
    @change="emit('update:step', patched(step, $event))"
    @add-error="emit('add-error', $event)"
  />
</template>
