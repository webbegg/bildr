<script setup lang="ts">
import type { Model } from '@bildr/codegen/model'
import { problemTarget } from '../editor/findingTargets.ts'
import type { ModelProblem } from '../types.ts'
import TargetLinks from './TargetLinks.vue'

/**
 * An error with the model problems behind it, if any. The default slot is for what to do about it (a link). With `linked` (the Data, Design and Checks
 * screens, S8) each problem links to where it is fixed: its file in All model files, or the item its file holds when the `model` loads.
 */
withDefaults(defineProps<{ title: string, message?: string, problems?: ModelProblem[], linked?: boolean, model?: Model | null }>(), { message: undefined, problems: () => [], linked: false, model: null })
</script>

<template>
  <UAlert
    color="error"
    variant="subtle"
    icon="i-lucide-circle-alert"
    :title="title"
  >
    <template #description>
      <p v-if="message">
        {{ message }}
      </p>
      <ul
        v-if="problems.length"
        class="mt-1 list-disc space-y-0.5 pl-4"
      >
        <li
          v-for="(problem, index) in problems"
          :key="index"
          data-problem
        >
          <code class="text-xs">{{ problem.path }}</code>: {{ problem.message }}
          <TargetLinks
            v-if="linked"
            :targets="problemTarget(problem, model)"
          />
        </li>
      </ul>
      <slot />
    </template>
  </UAlert>
</template>
