<script setup lang="ts">
import ProblemsList from '../ProblemsList.vue'

/** The one error the Data workspace shows when the model files could not be read (`useModelFiles`), with a way to try again. */
defineProps<{ message: string }>()
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <ProblemsList
    title="Could not read the model files"
    :message="message"
    data-files-error
  >
    <UButton
      label="Retry"
      icon="i-lucide-refresh-cw"
      color="error"
      variant="soft"
      size="sm"
      class="mt-2"
      @click="emit('retry')"
    />
  </ProblemsList>
</template>
