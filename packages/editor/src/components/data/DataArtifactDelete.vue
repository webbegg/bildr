<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ARTIFACT_KINDS, attempt, openUse, useKey, useKindLabel, usesOfArtifact } from '../../editor/dataArtifacts.ts'
import type { ArtifactKind, UseEntry } from '../../editor/dataArtifacts.ts'
import { useEditor } from '../../editor/useEditor.ts'

/**
 * The Delete dialog of a query or an action (S10, DW-7e): a confirm that calls `query_delete` / `action_delete`. The module
 * refuses while the item is used, so a used one lists where (the same list as its Used in tab, each place a link to the
 * Canvas) and the refusal is shown when it is asked anyway; nothing is deleted then. What the module refuses is shown
 * in the dialog, not as the screen's banner.
 */
const { target } = defineProps<{ target: { kind: ArtifactKind, id: string } | null }>()
const emit = defineEmits<{ close: [] }>()
const editor = useEditor()

/** The target last asked for, so the dialog keeps its words while it closes. */
const shown = ref(target)
const error = ref('')
const saving = ref(false)
watch(() => target, (next) => {
  if (!next) return
  shown.value = next
  error.value = ''
})

const item = computed(() => shown.value ? (shown.value.kind === 'query' ? editor.queries : editor.actions).find(entry => entry.id === shown.value!.id) : undefined)
const words = computed(() => ARTIFACT_KINDS[shown.value?.kind ?? 'query'])
const uses = computed<UseEntry[]>(() => shown.value ? usesOfArtifact(editor.model, shown.value.id, shown.value.kind) : [])

const open = computed({
  get: () => target !== null,
  set: (value) => {
    if (!value) emit('close')
  }
})

function go(use: UseEntry) {
  emit('close')
  openUse(editor, use)
}

async function submit() {
  if (!shown.value || saving.value) return
  saving.value = true
  const done = await attempt(editor, words.value.delete, { [shown.value.kind]: shown.value.id }, `Could not delete the ${words.value.label.toLowerCase()}`)
  saving.value = false
  if ('error' in done) error.value = done.error
  else emit('close')
}
</script>

<template>
  <EditorModal
    v-model:open="open"
    :title="`Delete ${words.label.toLowerCase()}`"
    :description="item ? `${item.label} (${item.name}). Undo brings it back.` : undefined"
  >
    <div
      class="space-y-3"
      data-artifact-dialog="delete"
    >
      <div
        v-if="uses.length"
        class="space-y-2"
        data-artifact-uses
      >
        <p class="text-[12px] leading-4 text-muted">
          Used in {{ uses.length }} {{ uses.length === 1 ? 'place' : 'places' }}. It is not deleted while it is used: change {{ uses.length === 1 ? 'it' : 'them' }} first.
        </p>
        <div class="space-y-0.5">
          <button
            v-for="use in uses"
            :key="useKey(use)"
            type="button"
            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-toned hover:bg-white/4"
            :title="use.what.join('; ')"
            :data-use-open="useKey(use)"
            @click="go(use)"
          >
            <span class="truncate">{{ use.name }}</span>
            <span class="text-[11px] text-dimmed">{{ useKindLabel(use.kind) }}</span>
            <UIcon
              name="i-lucide-arrow-up-right"
              class="ms-auto size-3.5 shrink-0 text-dimmed"
            />
          </button>
        </div>
      </div>
      <p
        v-else
        class="text-[12px] leading-4 text-muted"
      >
        Nothing uses it. Its file is deleted, and with it the generated code.
      </p>
      <p
        v-if="error"
        class="flex items-start gap-2 rounded-lg bg-error/10 px-3 py-2 text-[12px] leading-4 text-error"
        role="alert"
        data-artifact-error
      >
        <UIcon
          name="i-lucide-circle-alert"
          class="size-4 shrink-0"
        />
        {{ error }}
      </p>
    </div>

    <template #footer>
      <EditorButton
        label="Cancel"
        @click="open = false"
      />
      <EditorButton
        variant="danger"
        :label="`Delete ${words.label.toLowerCase()}`"
        :loading="saving"
        data-artifact-submit
        @click="submit"
      />
    </template>
  </EditorModal>
</template>
