<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDesign } from './store.ts'

/**
 * A Form submits to an action, and the generator refuses one without: the palette asks which action first
 * (like a component's required values). Only the actions of the page's module that take a collection are
 * offered, since a Form edits a collection's fields; with none, it says so.
 */

const design = useDesign()
const pending = computed(() => design.pendingForm.value)
const choices = computed(() => pending.value ? design.formActions() : [])
const picked = ref('')
watch(pending, () => {
  picked.value = ''
})

const open = computed({
  get: () => !!pending.value,
  set: (on: boolean) => {
    if (!on) design.pendingForm.value = null
  }
})
const field = 'w-full rounded-md border border-default bg-default px-2 py-1 text-sm'
</script>

<template>
  <UModal
    v-model:open="open"
    title="Which action does the form run?"
    description="A form submits its fields to an action that takes a collection (create a post, say)."
  >
    <template #body>
      <div
        v-if="pending"
        class="flex flex-col gap-3"
        data-testid="form-dialog"
      >
        <label
          v-if="choices.length"
          class="grid grid-cols-[7rem_1fr] items-center gap-2 text-sm"
        >
          Action
          <select
            v-model="picked"
            data-testid="form-dialog-action"
            :class="field"
          >
            <option value="">
              Pick an action…
            </option>
            <option
              v-for="action in choices"
              :key="action.id"
              :value="action.id"
            >
              {{ action.label }}
            </option>
          </select>
        </label>
        <p
          v-else
          class="text-xs text-muted"
          data-testid="form-dialog-none"
        >
          This module has no action that takes a collection. Add one (a create action comes with every collection) and insert the form again.
        </p>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          data-testid="form-dialog-cancel"
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="open = false"
        />
        <UButton
          data-testid="form-dialog-confirm"
          label="Insert"
          :disabled="!picked"
          @click="design.confirmForm(picked)"
        />
      </div>
    </template>
  </UModal>
</template>
