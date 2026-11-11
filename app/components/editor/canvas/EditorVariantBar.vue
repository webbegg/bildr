<script setup lang="ts">
/**
 * A variant board frame's label chip, Framer's purple "Variant 1 · Primary":
 * above the frame inside the zoomed content, at its screen size at any zoom.
 * Filled purple on the active variant. A click makes that variant the active
 * one; a double-click renames it in place (Enter or blur commits, Esc
 * cancels). The primary is the component itself, so it is not renamed here.
 */
const props = defineProps<{ label: string, primary: boolean, active: boolean, zoom: number, width: number }>()
const emit = defineEmits<{ activate: [], rename: [name: string] }>()

const renaming = ref(false)

function startRename() {
  if (!props.primary) renaming.value = true
}

function commit(name: string) {
  renaming.value = false
  emit('rename', name)
}
</script>

<template>
  <div
    class="absolute bottom-full left-0 flex origin-bottom-left items-end pb-2"
    :style="{ width: `${width * zoom}px`, transform: `scale(${1 / zoom})` }"
    data-board-bar
    :data-active="active || undefined"
  >
    <div
      v-if="renaming"
      class="w-40"
    >
      <EditorInput
        :model-value="label"
        commit="change"
        autofocus
        :aria-label="`${label} variant name`"
        data-board-rename
        @commit="commit"
        @blur="renaming = false"
        @keydown.esc="renaming = false"
      />
    </div>
    <button
      v-else
      type="button"
      class="flex h-6 min-w-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-[550] whitespace-nowrap"
      :class="[FOCUS_RING, active ? 'bg-(--editor-context) text-white' : 'bg-(--editor-context)/15 text-(--editor-context) hover:bg-(--editor-context)/25']"
      :aria-pressed="active"
      :aria-label="`Edit the ${label} variant`"
      :title="primary ? 'The component as defined' : 'Click to edit, double-click to rename'"
      data-board-label
      @click="emit('activate')"
      @dblclick="startRename"
    >
      <UIcon
        name="i-lucide-component"
        class="size-3.5 shrink-0"
      />
      <span class="truncate">{{ label }}</span>
    </button>
  </div>
</template>
