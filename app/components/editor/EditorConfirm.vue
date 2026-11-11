<script setup lang="ts">
/**
 * The editor's confirm dialog, in the kit's EditorModal instead of the
 * browser's `confirm()`: `editor.confirm({ title, description, items,
 * confirmLabel, danger })` opens it and resolves true on the confirm button,
 * false on Cancel, Esc or a click outside. `items` lists what the action
 * reaches, e.g. where a component is used.
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
    </div>
    <template #footer>
      <EditorButton
        label="Cancel"
        variant="ghost"
        data-confirm-cancel
        @click="request?.answer(false)"
      />
      <EditorButton
        :label="request?.confirmLabel ?? 'OK'"
        :variant="request?.danger ? 'danger' : 'primary'"
        data-confirm-ok
        @click="request?.answer(true)"
      />
    </template>
  </EditorModal>
</template>
