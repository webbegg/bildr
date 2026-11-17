<script setup lang="ts">
import { computed } from 'vue'
import { entityById } from '../../../shared/dataModel.ts'
import { isObject } from '../../../model.ts'
import { patched } from '../../../editor/stepExpr.ts'
import type { Step } from '../../../editor/stepExpr.ts'
import type { StepsContext } from '../../../editor/stepDraft.ts'
import type { StepScope } from '../../../editor/stepScope.ts'

/**
 * A Return step (S10, D10c): when it returns (always, or when a condition holds) and the row it returns. An action with no
 * output returns nothing.
 */
const { step, scope, ctx } = defineProps<{
  step: Step
  scope: StepScope
  ctx: StepsContext
}>()
const emit = defineEmits<{ 'update:step': [step: Step] }>()

const WHEN = [{ label: 'Always', value: 'always' }, { label: 'When…', value: 'when' }]
const output = computed(() => ctx.action.output ? entityById(ctx.model, ctx.action.output.entity)?.name : undefined)
const returnsNothing = computed(() => isObject(step.value) && step.value.$var === 'undefined')
const change = (patch: Record<string, unknown>) => emit('update:step', patched(step, patch))
</script>

<template>
  <EditorFormRow label="Runs">
    <EditorSelect
      :model-value="step.if === true ? 'always' : 'when'"
      :items="WHEN"
      aria-label="When it returns"
      class="w-32 shrink-0"
      data-step-field="if"
      @update:model-value="change({ if: $event === 'always' ? true : undefined })"
    />
    <DataStepValue
      v-if="step.if !== true"
      :value="step.if"
      :scope="scope"
      type="boolean"
      label="Condition"
      :allow="['input', 'var']"
      data-step-field="condition"
      @update:value="change({ if: $event })"
    />
  </EditorFormRow>
  <EditorFormRow
    label="Returns"
    :help="output ? undefined : 'This action has no output'"
  >
    <DataStepValue
      v-if="output"
      :value="step.value"
      :scope="scope"
      :label="`The ${output} to return`"
      :allow="['var']"
      rows
      data-step-field="value"
      @update:value="change({ value: $event })"
    />
    <template v-else>
      <span
        class="flex h-[30px] items-center text-[12px] text-toned"
        data-step-nothing
      >Nothing</span>
      <EditorButton
        v-if="!returnsNothing"
        label="Return nothing"
        size="xs"
        data-step-reset-value
        @click="change({ value: { $var: 'undefined' } })"
      />
    </template>
  </EditorFormRow>
</template>
