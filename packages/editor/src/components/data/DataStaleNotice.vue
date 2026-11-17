<script setup lang="ts">
import { computed } from 'vue'

/**
 * The notice of a draft form whose item changed since the user started editing (the query Definition, the action Steps): the
 * edits are still there, and Save waits for the choice, "Load the new version" or "Keep my edits" (`useDraftForm`). `prefix` is
 * the form's own test hook (`data-<prefix>-changed`, `-load-new` and `-keep-mine`).
 */
const { prefix } = defineProps<{
  prefix: string
  title: string
  description: string
}>()
const emit = defineEmits<{ loadNew: [], keepMine: [] }>()
const hook = computed(() => (name: string) => ({ [`data-${prefix}-${name}`]: '' }))
</script>

<template>
  <UAlert
    color="warning"
    variant="subtle"
    icon="i-lucide-refresh-cw"
    :title="title"
    :description="description"
    v-bind="hook('changed')"
  >
    <template #actions>
      <UButton
        label="Load the new version"
        color="warning"
        variant="soft"
        size="xs"
        v-bind="hook('load-new')"
        @click="emit('loadNew')"
      />
      <UButton
        label="Keep my edits"
        color="neutral"
        variant="outline"
        size="xs"
        v-bind="hook('keep-mine')"
        @click="emit('keepMine')"
      />
    </template>
  </UAlert>
</template>
