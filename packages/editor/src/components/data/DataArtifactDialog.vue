<script setup lang="ts">
/**
 * The shell of the create, rename and delete dialogs of the Queries and Actions sections (S10): the modal with its title, the
 * dialog's own content (the default slot), the error the module gave (shown here, not as the screen's banner, with what was typed
 * kept) and the footer, Cancel and the one button that runs the dialog. `editor/useArtifactDialog.ts` is its state. While it is
 * `saving` it cannot be closed (Cancel is off, Esc and a click outside do nothing): the action is on its way and the answer is for
 * this opening.
 * `submitReason` says why the button is disabled when that is not obvious (a delete of an item that is used).
 */
const { dialog, title, description, error = '', saving = false, submitLabel, submitVariant = 'primary', canSubmit = true, submitReason } = defineProps<{
  dialog: 'create' | 'rename' | 'delete'
  title: string
  description?: string
  error?: string
  saving?: boolean
  submitLabel: string
  submitVariant?: 'primary' | 'danger'
  canSubmit?: boolean
  submitReason?: string
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ submit: [] }>()
</script>

<template>
  <EditorModal
    v-model:open="open"
    :title="title"
    :description="description"
    :dismissible="!saving"
  >
    <div
      class="space-y-3"
      :data-artifact-dialog="dialog"
    >
      <slot />
      <DataInlineError
        v-if="error"
        icon
        data-artifact-error
      >
        {{ error }}
      </DataInlineError>
    </div>

    <template #footer>
      <EditorButton
        label="Cancel"
        :disabled="saving"
        @click="open = false"
      />
      <EditorButton
        :variant="submitVariant"
        :label="submitLabel"
        :loading="saving"
        :disabled="!canSubmit"
        :title="!canSubmit ? submitReason : undefined"
        data-artifact-submit
        @click="emit('submit')"
      />
    </template>
  </EditorModal>
</template>
