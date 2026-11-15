<script setup lang="ts">
/**
 * An optional property not set yet, Framer's "Add…" row: the label and a
 * placeholder control; clicking it adds a default token, and the row turns
 * into the real control.
 */
defineProps<{ label: string, icon: string, name: string }>()
const emit = defineEmits<{ add: [] }>()
</script>

<template>
  <EditorRow
    :label="label"
    :name="name"
  >
    <button
      type="button"
      class="flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-lg bg-elevated ps-1 text-left text-[12px] text-dimmed hover:text-toned hover:ring-1 hover:ring-white/10 hover:ring-inset"
      :aria-label="`Add ${label.toLowerCase()}`"
      :data-add-row="name"
      @click="emit('add')"
    >
      <span class="grid size-[22px] shrink-0 place-items-center rounded-md bg-white/10 text-toned">
        <UIcon
          :name="icon"
          class="size-3.5"
        />
      </span>
      Add…
    </button>
  </EditorRow>
</template>
