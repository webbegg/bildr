<script setup lang="ts">
import { computed } from 'vue'
import { entityById } from '../../../shared/dataModel.ts'
import type { Step } from '../../../editor/stepExpr.ts'
import type { DraftError, StepsContext } from '../../../editor/stepDraft.ts'
import type { StepScope } from '../../../editor/stepScope.ts'

/**
 * The fields of one step, by its kind (S10, D10c); the kinds are the ones the generator writes (`generate/actions.ts`):
 *
 * - **check** (`validate`): nothing to set; it checks the body against the collection's fields (said here).
 * - **refuse** (`assert`): `DataStepRefuse`. **load**: `DataStepLoad`. **write** (`repository`): `DataStepWrite`.
 *   **return**: `DataStepReturn`.
 *
 * It does not change the step: it says the step it would be (`update:step`), and the card's owner puts it in the draft. An
 * error added by a form (`add-error`) is added to the draft first, and a load's rename (`rename`) goes through the draft too,
 * for the steps after it read the row by its name.
 */
const { step, scope, ctx, errors } = defineProps<{
  step: Step
  scope: StepScope
  ctx: StepsContext
  errors: DraftError[]
}>()
const emit = defineEmits<{ 'update:step': [step: Step], 'add-error': [error: Partial<DraftError>], 'rename': [name: string] }>()

const body = computed(() => ctx.action.input.entity ? entityById(ctx.model, ctx.action.input.entity)?.name : undefined)
</script>

<template>
  <div
    class="space-y-3"
    data-step-form
  >
    <p
      v-if="step.kind === 'validate'"
      class="text-[12px] text-toned"
    >
      {{ body ? `Checks the body against the fields of ${body}: a value that is missing or does not fit is refused.` : 'This action takes no body to check.' }}
    </p>
    <DataStepRefuse
      v-else-if="step.kind === 'assert'"
      :step="step"
      :scope="scope"
      :ctx="ctx"
      :errors="errors"
      @update:step="emit('update:step', $event)"
      @add-error="emit('add-error', $event)"
    />
    <DataStepLoad
      v-else-if="step.kind === 'load'"
      :step="step"
      :scope="scope"
      :ctx="ctx"
      :errors="errors"
      @update:step="emit('update:step', $event)"
      @add-error="emit('add-error', $event)"
      @rename="emit('rename', $event)"
    />
    <DataStepWrite
      v-else-if="step.kind === 'repository'"
      :step="step"
      :scope="scope"
      :ctx="ctx"
      @update:step="emit('update:step', $event)"
    />
    <DataStepReturn
      v-else-if="step.kind === 'return'"
      :step="step"
      :scope="scope"
      :ctx="ctx"
      @update:step="emit('update:step', $event)"
    />
  </div>
</template>
