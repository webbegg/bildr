<script setup lang="ts">
const editor = useEditor()
</script>

<template>
  <div
    class="overflow-y-auto py-2"
    @mouseleave="editor.hoveredId = null"
  >
    <EditorLayerItem
      v-if="editor.page"
      :node="editor.page.root"
      :depth="0"
    />
  </div>
</template>
