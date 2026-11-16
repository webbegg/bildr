<script setup lang="ts">
import { computed } from 'vue'
import { useEditor } from '../../editor/useEditor.ts'
import type { DataConnection } from '../../shared/dataModel.ts'

/**
 * A connection's Endpoints tab: its settings (name, base URL, auth), then the endpoints of each
 * collection read through it. A collection is added under the connection in the tree.
 */
const props = defineProps<{ connection: DataConnection }>()
const editor = useEditor()
const collections = computed(() => editor.collections.filter(entry => entry.datasource === props.connection.id))
</script>

<template>
  <div data-connection-endpoints>
    <DataPanelConnection
      :key="connection.id"
      :connection="connection"
    />
    <template v-if="collections.length">
      <div
        v-for="collection in collections"
        :key="collection.id"
        :data-endpoints-of="collection.plural"
      >
        <div class="flex h-9 items-center gap-2 ps-4 pt-2 text-[11px] text-dimmed">
          <UIcon
            name="i-lucide-globe"
            class="size-3.5 shrink-0"
          />
          <span class="truncate">{{ collection.name }}</span>
        </div>
        <DataPanelEndpoints :collection="collection" />
      </div>
    </template>
    <p
      v-else
      class="px-4 py-4 text-xs text-dimmed"
      data-connection-endpoints-empty
    >
      No collection reads through this connection yet. Use Add… under it in the tree.
    </p>
  </div>
</template>
