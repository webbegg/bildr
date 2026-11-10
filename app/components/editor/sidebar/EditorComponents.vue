<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ComponentDefinition } from '#shared/document/schema'
import type { ComponentUsage } from '#shared/document/usages'
import { DRAG_MIME } from '#shared/editor/dropTarget'
import type { ComponentEntry } from '~/composables/componentEditor'
import { componentDeleteMessage, componentFolders, insertableComponents, instanceDragPayload } from '~/composables/componentEditor'

/**
 * The Assets panel's Components: the project's components by folder (the
 * part of the name before the last `/`), filtered by the sidebar search. A
 * click opens one in the component view, a drag drops an instance onto the
 * canvas or the layers, and each row counts its instances; the chevron
 * lists where they are (the usage index), each a link to it. Deleting a
 * component in use names its instances and asks before deleting them too.
 */
const { query = '' } = defineProps<{ query?: string }>()
const editor = useEditor()

const folders = computed(() => (editor.project ? componentFolders(editor.project, query) : []))
const insertable = computed(() => new Set(editor.project ? insertableComponents(editor.project, editor.componentId).map(c => c.id) : []))
const expanded = ref(new Set<string>())
const renamingId = ref<string | null>(null)
const renameValue = ref('')

function toggleUsages(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function onDragStart(event: DragEvent, def: ComponentDefinition) {
  if (!event.dataTransfer || !insertable.value.has(def.id)) return event.preventDefault()
  event.dataTransfer.setData(DRAG_MIME, instanceDragPayload(def.id))
  event.dataTransfer.effectAllowed = 'copy'
}

function goToUsage(usage: ComponentUsage) {
  if (usage.pageId !== undefined) {
    editor.selectPage(usage.pageId)
    editor.selectedId = usage.nodeId
  } else if (usage.layoutId !== undefined) {
    editor.editLayout(usage.layoutId, usage.nodeId)
  } else {
    editor.editComponent(usage.componentId, usage.nodeId)
  }
}

function startRename(def: ComponentDefinition) {
  renamingId.value = def.id
  renameValue.value = def.name
}

async function commitRename() {
  const componentId = renamingId.value
  renamingId.value = null
  const def = editor.project?.components.find(c => c.id === componentId)
  const name = renameValue.value.trim()
  if (def && name && name !== def.name) await editor.run('component_rename', { componentId, name })
}

async function remove({ def, usages }: ComponentEntry) {
  if (!confirm(componentDeleteMessage(def, usages))) return
  await editor.run('component_delete', { componentId: def.id, ...(usages.length ? { force: true } : {}) })
}

function menu(entry: ComponentEntry): DropdownMenuItem[] {
  const { def } = entry
  return [
    { label: 'Insert', icon: 'i-lucide-plus', disabled: !insertable.value.has(def.id) || !editor.page, onSelect: () => editor.insertInstance(def.id) },
    { label: 'Edit component', icon: 'i-lucide-pencil-ruler', onSelect: () => editor.editComponent(def.id) },
    { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => startRename(def) },
    { label: 'Delete…', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => remove(entry) }
  ]
}
</script>

<template>
  <section data-assets-components>
    <div class="mb-1 flex items-center justify-between">
      <p class="text-xs font-[550] text-muted uppercase">
        Components
      </p>
      <UTooltip text="Create component from the selection">
        <UButton
          icon="i-lucide-plus"
          size="xs"
          color="neutral"
          variant="ghost"
          aria-label="Create component"
          :disabled="!editor.selectedIds.length || !!editor.componentId || !!editor.layoutId"
          @click="editor.createComponent()"
        />
      </UTooltip>
    </div>
    <p
      v-if="!editor.project?.components.length"
      class="text-xs text-dimmed"
    >
      None yet. Select elements, then right-click › Create component.
    </p>
    <p
      v-else-if="!folders.length"
      class="text-xs text-dimmed"
    >
      No components match “{{ query }}”.
    </p>
    <div
      v-for="folder in folders"
      :key="folder.name"
      :data-component-folder="folder.name"
    >
      <p
        v-if="folder.name"
        class="mt-1.5 flex items-center gap-1.5 px-1 py-1 text-xs text-muted"
      >
        <UIcon
          name="i-lucide-folder"
          class="size-3.5"
        />
        {{ folder.name }}
      </p>
      <div
        v-for="entry in folder.entries"
        :key="entry.def.id"
        :class="folder.name ? 'ps-3' : ''"
        :data-component-id="entry.def.id"
      >
        <div class="group relative flex items-center">
          <UInput
            v-if="renamingId === entry.def.id"
            v-model="renameValue"
            size="sm"
            autofocus
            class="flex-1"
            aria-label="Component name"
            @keydown.enter="commitRename"
            @keydown.esc="renamingId = null"
            @blur="commitRename"
          />
          <template v-else>
            <button
              type="button"
              class="grid size-5 shrink-0 place-items-center rounded text-dimmed hover:text-highlighted disabled:opacity-40"
              :aria-expanded="expanded.has(entry.def.id)"
              :aria-label="`Where ${entry.def.name} is used`"
              :disabled="!entry.usages.length"
              @click="toggleUsages(entry.def.id)"
            >
              <UIcon
                name="i-lucide-chevron-right"
                class="size-3 transition-transform"
                :class="{ 'rotate-90': expanded.has(entry.def.id) }"
              />
            </button>
            <button
              type="button"
              draggable="true"
              class="flex h-8 min-w-0 flex-1 cursor-grab items-center gap-2 rounded-lg ps-1.5 pe-8 text-left text-[12px] active:cursor-grabbing"
              :class="entry.def.id === editor.componentId ? 'bg-white/8 font-medium text-highlighted' : 'text-toned hover:bg-white/4'"
              :title="`${entry.def.name}: click to edit, drag to insert`"
              :aria-current="entry.def.id === editor.componentId ? 'true' : undefined"
              @click="editor.editComponent(entry.def.id)"
              @dblclick="startRename(entry.def)"
              @dragstart="onDragStart($event, entry.def)"
            >
              <UIcon
                name="i-lucide-component"
                class="size-4 shrink-0 text-violet-400"
              />
              <span class="truncate">{{ entry.label }}</span>
              <span
                class="ms-auto shrink-0 text-[11px] text-dimmed tabular-nums"
                :data-usage-count="entry.usages.length"
              >{{ entry.usages.length }}</span>
            </button>
            <UDropdownMenu :items="menu(entry)">
              <UButton
                icon="i-lucide-ellipsis"
                size="xs"
                color="neutral"
                variant="ghost"
                aria-label="Component actions"
                class="absolute end-1 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
              />
            </UDropdownMenu>
          </template>
        </div>
        <ul
          v-if="expanded.has(entry.def.id) && entry.usages.length"
          class="mb-1 ms-6 border-l border-default ps-2"
          data-component-usages
        >
          <li
            v-for="usage in entry.usages"
            :key="`${usage.pageId ?? usage.componentId ?? usage.layoutId}:${usage.nodeId}`"
          >
            <button
              type="button"
              class="flex h-6 w-full min-w-0 items-center gap-1.5 rounded px-1 text-left text-xs text-muted hover:bg-white/4 hover:text-highlighted"
              :title="`${usage.where} (${usage.nodeId})`"
              @click="goToUsage(usage)"
            >
              <UIcon
                :name="usage.pageId !== undefined ? 'i-lucide-file' : usage.layoutId !== undefined ? 'i-lucide-layout-template' : 'i-lucide-component'"
                class="size-3 shrink-0"
              />
              <span class="truncate">{{ usage.where }}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
