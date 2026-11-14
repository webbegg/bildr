<script setup lang="ts">
import { ref } from 'vue'
import type { LayoutFile } from '@bildr/codegen/model'
import CommitInput from './CommitInput.vue'
import PropertyList from './PropertyList.vue'
import { LAYOUT_VARIABLE_KINDS } from './kinds.ts'
import { useDesign } from './store.ts'

/**
 * What the inspector shows of the layout being edited: its named slots (a
 * container of the layout whose children are the default content; pages fill
 * them) and its variables (values pages set, read in the layout as
 * `layout.<name>`). A slot takes the selected node.
 */

const props = defineProps<{ layout: LayoutFile }>()
const design = useDesign()

const name = ref('')
const selected = () => design.selected.value
const edit = (action: string, input: Record<string, unknown>) => design.edit(action, { layout: props.layout.id, ...input })
const add = async () => {
  const node = selected()
  if (!node || !name.value.trim()) return
  const out = await edit('layout_slot_add', { name: name.value.trim(), nodeId: node.id })
  if (out) name.value = ''
}
</script>

<template>
  <div
    class="flex flex-col"
    data-testid="layout-panel"
  >
    <section class="flex flex-col gap-2 border-b border-default p-3">
      <h3 class="text-xs font-semibold">
        Slots
      </h3>
      <div
        v-for="slot in layout.slots"
        :key="slot.id"
        class="flex items-center gap-1 text-xs"
        :data-testid="`slot-${slot.id}`"
      >
        <span
          v-if="slot.id === 'children'"
          class="min-w-0 flex-1 truncate"
          title="The children slot shows each page's own content"
        >{{ slot.name }} <code class="text-muted">{{ slot.nodeId }}</code></span>
        <template v-else>
          <CommitInput
            :data-testid="`slot-name-${slot.id}`"
            :model-value="slot.name"
            @commit="edit('layout_slot_update', { slot: slot.id, name: $event })"
          />
          <code class="shrink-0 text-muted">{{ slot.nodeId }}</code>
          <UButton
            :data-testid="`slot-rebind-${slot.id}`"
            icon="i-lucide-crosshair"
            aria-label="Use the selected node"
            title="Use the selected node"
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="!design.selected.value"
            @click="edit('layout_slot_update', { slot: slot.id, nodeId: design.selected.value!.id })"
          />
          <UButton
            :data-testid="`slot-remove-${slot.id}`"
            icon="i-lucide-trash-2"
            aria-label="Remove slot"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="edit('layout_slot_remove', { slot: slot.id })"
          />
        </template>
      </div>
      <div class="flex items-center gap-1">
        <CommitInput
          data-testid="slot-add-name"
          :model-value="name"
          placeholder="New slot"
          @commit="name = $event"
        />
        <UButton
          data-testid="slot-add"
          icon="i-lucide-plus"
          aria-label="Add a slot on the selected container"
          title="Add a slot on the selected container"
          size="xs"
          color="neutral"
          variant="soft"
          :disabled="!design.selected.value"
          @click="add()"
        />
      </div>
    </section>
    <section class="flex flex-col gap-2 p-3">
      <h3 class="text-xs font-semibold">
        Variables
      </h3>
      <PropertyList
        :owner="{ kind: 'layout', id: layout.id }"
        :items="layout.variables ?? []"
        :kinds="LAYOUT_VARIABLE_KINDS"
      />
    </section>
  </div>
</template>
