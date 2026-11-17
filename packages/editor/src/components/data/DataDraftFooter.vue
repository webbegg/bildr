<script setup lang="ts">
import { computed } from 'vue'

/**
 * The footer of a draft form (the query Definition, the action Steps): what the module refused (`error`) or what stops Save
 * (`note`), "Unsaved changes", Discard and Save. It sticks to the bottom of the area when the form scrolls, and is at the bottom
 * of it when the form is short. `prefix` is the form's own test hook (`data-<prefix>-footer`, `-error`, `-blocked`, `-unsaved`,
 * `-discard` and `-save`); `inner` is the width and padding of its content, the form's own.
 */
const { prefix, inner = 'max-w-2xl px-0.5' } = defineProps<{
  prefix: string
  error: string
  /** Why Save waits, when no refusal is shown: "Fix 2 problems to save." */
  note?: string
  dirty: boolean
  saving: boolean
  /** Save is not offered: nothing changed, the item changed under the draft, or the editor finds a problem. */
  disabled: boolean
  inner?: string
}>()
const emit = defineEmits<{ discard: [], save: [] }>()
const hook = computed(() => (name: string) => ({ [`data-${prefix}-${name}`]: '' }))
</script>

<template>
  <footer
    class="sticky bottom-0 border-t border-white/6 bg-(--editor-canvas) py-3"
    v-bind="hook('footer')"
  >
    <div
      class="flex w-full items-start gap-3"
      :class="inner"
    >
      <p
        v-if="error"
        class="min-w-0 flex-1 rounded-lg bg-error/10 px-3 py-2 text-[12px] leading-4 text-error"
        role="alert"
        v-bind="hook('error')"
      >
        {{ error }}
      </p>
      <p
        v-else-if="note"
        class="min-w-0 flex-1 self-center text-[12px] text-muted"
        v-bind="hook('blocked')"
      >
        {{ note }}
      </p>
      <span
        v-else
        class="flex-1"
      />
      <span
        v-if="dirty"
        class="flex h-[30px] shrink-0 items-center text-[12px] text-muted"
        v-bind="hook('unsaved')"
      >Unsaved changes</span>
      <EditorButton
        label="Discard"
        :disabled="!dirty || saving"
        v-bind="hook('discard')"
        @click="emit('discard')"
      />
      <EditorButton
        variant="primary"
        label="Save"
        :loading="saving"
        :disabled="disabled"
        v-bind="hook('save')"
        @click="emit('save')"
      />
    </div>
  </footer>
</template>
