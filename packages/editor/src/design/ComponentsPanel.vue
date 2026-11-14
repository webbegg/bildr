<script setup lang="ts">
import { ref } from 'vue'
import CommitInput from './CommitInput.vue'
import { useDesign } from './store.ts'

/**
 * The Components section of the left sidebar: the project's components (a row
 * opens one in the canvas), make one from the selection, rename, duplicate
 * and delete. A delete the module refuses (instances use it) shows its message
 * in the toolbar and offers to delete the instances too (`force`).
 */

const design = useDesign()
const name = ref('')
const renaming = ref<string | null>(null)
/** The component whose delete was refused: it can be deleted with its instances. */
const refused = ref<string | null>(null)

const make = async () => {
  await design.makeComponent(name.value)
  name.value = ''
}
const rename = async (id: string, next: string) => {
  renaming.value = null
  if (next.trim()) await design.edit('component_rename', { component: id, name: next.trim() })
}
const duplicate = (id: string) => design.edit('component_duplicate', { component: id })
const remove = async (id: string, force = false) => {
  const out = await design.edit('component_delete', { component: id, ...(force ? { force: true } : {}) })
  refused.value = out ? null : id
}
</script>

<template>
  <div
    class="flex flex-col gap-2 p-2"
    data-testid="components-panel"
  >
    <div class="flex items-center gap-1">
      <CommitInput
        :model-value="name"
        data-testid="component-new-name"
        placeholder="New component name"
        @commit="name = $event"
      />
      <UButton
        data-testid="component-new"
        icon="i-lucide-plus"
        aria-label="Make a component from the selection"
        title="Make a component from the selection"
        size="xs"
        color="neutral"
        variant="soft"
        :disabled="!design.selectedId.value"
        @click="make()"
      />
    </div>
    <ul class="flex flex-col gap-0.5">
      <li
        v-for="component in design.components.value"
        :key="component.id"
        class="group flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-elevated"
        :class="{ 'bg-elevated': design.fileId.value === component.id }"
      >
        <CommitInput
          v-if="renaming === component.id"
          data-testid="component-rename-input"
          :model-value="component.name"
          @commit="rename(component.id, $event)"
        />
        <button
          v-else
          type="button"
          class="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
          :data-testid="`component-open-${component.id}`"
          @click="design.openFile(component.id)"
        >
          <UIcon
            name="i-lucide-component"
            class="size-4 shrink-0 text-muted"
          />
          <span
            class="truncate"
            data-testid="component-row"
          >{{ component.name }}</span>
        </button>
        <UButton
          :data-testid="`component-rename-${component.id}`"
          icon="i-lucide-pencil"
          aria-label="Rename"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="renaming = component.id"
        />
        <UButton
          :data-testid="`component-duplicate-${component.id}`"
          icon="i-lucide-copy"
          aria-label="Duplicate"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="duplicate(component.id)"
        />
        <UButton
          :data-testid="`component-delete-${component.id}`"
          icon="i-lucide-trash-2"
          aria-label="Delete"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="remove(component.id)"
        />
        <UButton
          v-if="refused === component.id"
          :data-testid="`component-delete-force-${component.id}`"
          label="Delete with its instances"
          size="xs"
          color="error"
          variant="soft"
          @click="remove(component.id, true)"
        />
      </li>
    </ul>
    <p
      v-if="!design.components.value.length"
      class="px-1 text-xs text-muted"
    >
      No components yet. Select layers and make one.
    </p>
  </div>
</template>
