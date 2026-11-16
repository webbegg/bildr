<script setup lang="ts">
import type { ModelProblem } from '../types.ts'

/** An error with the model problems behind it, if any. The default slot is for what to do about it (a link). */
withDefaults(defineProps<{ title: string, message?: string, problems?: ModelProblem[] }>(), { message: undefined, problems: () => [] })
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
        >
          <code class="text-xs">{{ problem.path }}</code>: {{ problem.message }}
        </li>
      </ul>
      <slot />
    </template>
  </UAlert>
</template>
