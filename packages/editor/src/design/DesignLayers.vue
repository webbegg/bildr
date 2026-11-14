<script setup lang="ts">
import { reactive } from 'vue'
import LayerItem from './LayerItem.vue'
import { useDesign } from './store.ts'

/** The layers tree of the file being edited (page, component or layout). */

const design = useDesign()
const collapsed = reactive(new Set<string>())
const toggle = (id: string) => {
  if (!collapsed.delete(id)) collapsed.add(id)
}
</script>

<template>
  <ul
    v-if="design.file.value"
    role="tree"
    class="p-1"
    data-testid="layers"
  >
    <LayerItem
      :node="design.file.value.root"
      :depth="0"
      root
      :collapsed="collapsed"
      @toggle="toggle"
    />
  </ul>
  <p
    v-else
    class="p-3 text-sm text-muted"
  >
    Nothing to show yet.
  </p>
</template>
