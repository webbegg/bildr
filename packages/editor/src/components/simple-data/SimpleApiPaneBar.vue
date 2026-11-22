<script setup lang="ts">
import { computed } from 'vue'

/**
 * The header of an API panel's right pane (api panel P1): what is open on the left (the default slot), and on the right the draft's
 * actions, so they are seen without scrolling: why Save waits (`note`), "Unsaved changes", the pane's own actions (the `actions` slot,
 * Rename), Discard and Save. What the module refused (`error`) is a strip under the bar, outside what scrolls. It takes the place of
 * `DataDraftFooter` and keeps its hooks (`data-<prefix>-error`, `-blocked`, `-unsaved`, `-discard` and `-save`).
 */
const { prefix } = defineProps<{
  prefix: string
  error: string
  /** Why Save waits, when no refusal is shown: "Fix the base URL to save." */
  note?: string
  dirty: boolean
  saving: boolean
  /** Save is not offered: nothing changed, the item changed under the draft, or the editor finds a problem. */
  disabled: boolean
  discardHint?: string
}>()
const emit = defineEmits<{ discard: [], save: [] }>()
const hook = computed(() => (name: string) => ({ [`data-${prefix}-${name}`]: '' }))
</script>

<template>
  <div class="shrink-0">
    <div
      class="flex h-11 items-center gap-2 border-b border-default ps-4 pe-3"
      data-api-pane-bar
    >
      <slot />
      <span class="min-w-2 flex-1" />
      <p
        v-if="note && !error"
        class="min-w-0 truncate text-[12px] text-muted"
        :title="note"
        v-bind="hook('blocked')"
      >
        {{ note }}
      </p>
      <span
        v-if="dirty"
        class="shrink-0 text-[12px] text-muted"
        v-bind="hook('unsaved')"
      >Unsaved changes</span>
      <slot name="actions" />
      <EditorButton
        label="Discard"
        :title="discardHint"
        :disabled="!dirty || saving"
        class="shrink-0"
        v-bind="hook('discard')"
        @click="emit('discard')"
      />
      <EditorButton
        variant="primary"
        label="Save"
        :loading="saving"
        :disabled="disabled"
        class="shrink-0"
        v-bind="hook('save')"
        @click="emit('save')"
      />
    </div>
    <DataInlineError
      v-if="error"
      class="mx-4 mt-3"
      v-bind="hook('error')"
    >
      {{ error }}
    </DataInlineError>
  </div>
</template>
