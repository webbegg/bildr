<script setup lang="ts">
/**
 * "Bind…": a select of the names a prop can read (`bindingPaths` of its scope).
 * Picking one emits it; the select goes back to its title, so it can be used again.
 */
defineProps<{ paths: string[], title?: string }>()
const emit = defineEmits<{ pick: [path: string] }>()
const pick = (event: Event) => {
  const select = event.target as HTMLSelectElement
  const path = select.value
  select.value = ''
  if (path) emit('pick', path)
}
</script>

<template>
  <select
    class="w-20 shrink-0 rounded-md border border-default bg-default px-1 py-1 text-xs text-muted"
    :title="title ?? 'Bind to a name in scope: replaces an empty text, adds to a text'"
    aria-label="Bind"
    @change="pick"
  >
    <option value="">
      Bind…
    </option>
    <option
      v-for="path in paths"
      :key="path"
      :value="path"
    >
      {{ path }}
    </option>
  </select>
</template>
