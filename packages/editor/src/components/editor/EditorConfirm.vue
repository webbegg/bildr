<script setup lang="ts">
import { computed } from 'vue'
import { useEditor } from '../../editor/useEditor.ts'
import DataUsageList from '../data/DataUsageList.vue'

/**
 * The editor's confirm dialog, in the kit's EditorModal instead of the
 * browser's `confirm()`: `editor.confirm({ title, description, items,
 * confirmLabel, danger })` opens it and resolves true on the confirm button,
 * false on Cancel, Esc or a click outside. `items` lists what the action
 * reaches, e.g. where a component is used. `uses` lists the places that use what
 * is deleted or renamed, each a link that opens it and answers no. With `blocked` the change cannot
 * go on: the dialog has one Close button instead of Cancel and the confirm button, and the title and the description say why.
 */
const editor = useEditor()
const request = computed(() => editor.confirmRequest)
const open = computed({
  get: () => !!request.value,
  set: (value) => {
    if (!value) request.value?.answer(false)
  }
})
</script>

<template>
  <EditorModal
    v-model:open="open"
    :title="request?.title ?? ''"
    width="sm"
  >
    <div
      class="space-y-3"
      data-confirm
    >
      <p
        v-if="request?.description"
        class="text-[12px] text-muted"
        data-confirm-description
      >
        {{ request.description }}
      </p>
      <ul
        v-if="request?.items?.length"
        class="max-h-48 space-y-1 overflow-y-auto text-[12px] text-toned"
        data-confirm-items
      >
        <li
          v-for="item in request.items"
          :key="item"
          class="flex items-center gap-2"
        >
          <span class="size-1 shrink-0 rounded-full bg-(--ui-text-dimmed)" />
          <span class="truncate">{{ item }}</span>
        </li>
      </ul>
      <div
        v-if="request?.uses?.length"
        class="max-h-64 overflow-y-auto"
        data-confirm-uses
      >
        <DataUsageList
          :uses="request.uses"
          @open="request.answer(false)"
        />
      </div>
    </div>
    <template #footer>
      <!-- The Close button of a blocked change is the Cancel one: the same hook (`data-confirm-cancel`) closes either dialog. -->
      <EditorButton
        :label="request?.blocked ? 'Close' : 'Cancel'"
        :variant="request?.blocked ? 'primary' : 'ghost'"
        data-confirm-cancel
        @click="request?.answer(false)"
      />
      <EditorButton
        v-if="!request?.blocked"
        :label="request?.confirmLabel ?? 'OK'"
        :variant="request?.danger ? 'danger' : 'primary'"
        data-confirm-ok
        @click="request?.answer(true)"
      />
    </template>
  </EditorModal>
</template>
