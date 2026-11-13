<script setup lang="ts">
/** A yes/no confirmation for an operation that loses something. */
const open = defineModel<boolean>('open', { required: true })

withDefaults(defineProps<{
  title: string
  description?: string
  confirmLabel: string
  confirmTestId: string
  loading?: boolean
}>(), { description: undefined, loading: false })

const emit = defineEmits<{ confirm: [] }>()
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :description="description"
  >
    <template
      v-if="$slots.default"
      #body
    >
      <slot />
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="open = false"
        />
        <UButton
          :data-testid="confirmTestId"
          color="error"
          :label="confirmLabel"
          :loading="loading"
          @click="emit('confirm')"
        />
      </div>
    </template>
  </UModal>
</template>
