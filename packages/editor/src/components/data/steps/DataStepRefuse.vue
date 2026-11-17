<script setup lang="ts">
import { patched, record } from '../../../editor/stepExpr.ts'
import type { Step } from '../../../editor/stepExpr.ts'
import type { DraftError, StepsContext } from '../../../editor/stepDraft.ts'
import type { StepScope } from '../../../editor/stepScope.ts'

/**
 * A Refuse step (`assert`, S10, D10c): the action stops with an error if a row is found. Its lookup (`unless`: the collection,
 * how to find the row and what to find it by, `DataStepLookup`) and the error it refuses with, with the values the error carries
 * (`DataStepErrorPicker`).
 */
const { step, scope, ctx, errors } = defineProps<{
  step: Step
  scope: StepScope
  ctx: StepsContext
  errors: DraftError[]
}>()
const emit = defineEmits<{ 'update:step': [step: Step], 'add-error': [error: Partial<DraftError>] }>()
</script>

<template>
  <DataStepLookup
    :call="record(step.unless)"
    :scope="scope"
    :ctx="ctx"
    finder
    help="Refuse if a row is found"
    @change="emit('update:step', patched(step, { unless: patched(record(step.unless), $event) }))"
  />
  <DataStepErrorPicker
    :step="step"
    field="error"
    :scope="scope"
    :errors="errors"
    label="Refuse with"
    @change="emit('update:step', patched(step, $event))"
    @add-error="emit('add-error', $event)"
  />
</template>
