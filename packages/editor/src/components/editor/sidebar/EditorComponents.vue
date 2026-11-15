<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ComponentFile } from '@bildr/codegen/model'
import { useEditor } from '../../../editor/useEditor.ts'
import { componentDeleteConfirm, componentFolders, insertableComponents, replaceChoiceHint, replaceChoices } from '../../../shared/componentEditor.ts'
import type { ComponentEntry, ComponentUsage } from '../../../shared/componentEditor.ts'
import { DRAG_MIME, instancePayload } from '../../../shared/dropTarget.ts'

/**
 * The Assets panel's Components: the project's components by folder (the
 * part of the name before the last `/`), filtered by the sidebar search. A
 * click opens one in the component view, a drag drops an instance onto the
 * canvas or the layers, and each row counts its instances; the chevron
 * lists where they are (the usage index), each a link to it. Deleting a
 * component in use names its instances and asks before deleting them too.
 * The row menu also duplicates one ("<name>Copy") and replaces all its
 * instances with another component ("Replace all instances with ›").
 * "+" (or ⌥⌘K) opens the "New component" dialog for the selection; its
 * tooltip says why when it can't.
 */
const { query = '' } = defineProps<{ query?: string }>()
const editor = useEditor()

const folders = computed(() => (editor.model ? componentFolders(editor.model, query) : []))
const insertable = computed(() => new Set(editor.model ? insertableComponents(editor.model, editor.componentId).map(c => c.id) : []))
const expanded = ref(new Set<string>())
const renamingId = ref<string | null>(null)
const renameValue = ref('')

/** Why "+" can't make a component now, or '' when it can. */
const cannotCreate = computed(() => {
  if (editor.componentId) return 'Leave the component to create another'
  if (editor.layoutId) return 'Leave the layout to create a component'
  if (!editor.selectedIds.length || (editor.selectedIds.length === 1 && editor.selectedId === editor.page?.root.id)) return 'Select layers on the page to make a component'
  return ''
})

function toggleUsages(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function onDragStart(event: DragEvent, def: ComponentFile) {
  if (!event.dataTransfer || !insertable.value.has(def.id)) return event.preventDefault()
  event.dataTransfer.setData(DRAG_MIME, instancePayload(def.id))
  event.dataTransfer.effectAllowed = 'copy'
}

function goToUsage(usage: ComponentUsage) {
  if (usage.kind === 'page') {
    editor.selectPage(usage.file)
    editor.selectedId = usage.nodeId
  } else if (usage.kind === 'layout') {
    editor.editLayout(usage.file, usage.nodeId)
  } else {
    editor.editComponent(usage.file, usage.nodeId)
  }
}

function startRename(def: ComponentFile) {
  renamingId.value = def.id
  renameValue.value = def.name
}

async function commitRename() {
  const componentId = renamingId.value
  renamingId.value = null
  const def = editor.components.find(c => c.id === componentId)
  const name = renameValue.value.trim()
  if (def && name && name !== def.name) await editor.run('component_rename', { component: componentId, name })
}

// Rename mounts the field focused; the closing menu must not take the focus back (its blur would commit).
function keepRenameFocus(event: Event) {
  if (renamingId.value) event.preventDefault()
}

async function remove({ def, usages }: ComponentEntry) {
  if (!await editor.confirm(componentDeleteConfirm(def, usages))) return
  await editor.run('component_delete', { component: def.id, ...(usages.length ? { force: true } : {}) })
}

/** Replace all instances with ›: the other components, those that would contain themselves disabled; replaces from the first usage with `all`. */
function replaceAllItems({ def, usages }: ComponentEntry): DropdownMenuItem[] {
  const first = usages[0]
  if (!editor.model || !first) return []
  const hosts = usages.filter(usage => usage.kind === 'component').map(usage => usage.file)
  return replaceChoices(editor.model, def.id, hosts).map(choice => ({
    label: choice.def.name,
    icon: 'i-lucide-component',
    description: replaceChoiceHint(choice),
    disabled: choice.disabled,
    onSelect: () => replaceAll(first, choice.def.id)
  }))
}

async function replaceAll(usage: ComponentUsage, component: string) {
  await editor.run('instance_replace', { file: usage.file, nodeId: usage.nodeId, component, all: true })
}

function menu(entry: ComponentEntry): DropdownMenuItem[] {
  const { def, usages } = entry
  const replace = replaceAllItems(entry)
  return [
    { label: 'Insert', icon: 'i-lucide-plus', disabled: !insertable.value.has(def.id) || !editor.page, onSelect: () => editor.insertInstance(def.id) },
    { label: 'Edit component', icon: 'i-lucide-pencil-ruler', onSelect: () => editor.editComponent(def.id) },
    { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => startRename(def) },
    { label: 'Duplicate', icon: 'i-lucide-copy', onSelect: () => editor.run('component_duplicate', { component: def.id }) },
    {
      label: 'Replace all instances with',
      icon: 'i-lucide-replace',
      description: usages.length ? undefined : 'No instances to replace',
      disabled: !usages.length || replace.length < 2,
      content: { class: 'max-h-80 overflow-y-auto' },
      children: replace
    },
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
      <UTooltip
        :text="cannotCreate || 'Create component from the selection'"
        :kbds="cannotCreate ? undefined : ['meta', 'alt', 'k']"
      >
        <!-- A disabled button gets no pointer events, so the tooltip hangs on this wrapper. -->
        <span
          class="inline-flex"
          data-create-component-wrap
        >
          <EditorButton
            icon="i-lucide-plus"
            size="xs"
            variant="ghost"
            aria-label="Create component"
            :disabled="!!cannotCreate"
            @click="editor.createComponent()"
          />
        </span>
      </UTooltip>
    </div>
    <p
      v-if="!editor.components.length"
      class="text-xs text-dimmed"
      data-components-empty
    >
      No components yet. Select layers and press ⌥⌘K, or use +.
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
          <EditorInput
            v-if="renamingId === entry.def.id"
            v-model="renameValue"
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
                class="size-4 shrink-0 text-(--editor-component)"
              />
              <span class="truncate">{{ entry.label }}</span>
              <span
                class="ms-auto shrink-0 text-[11px] text-dimmed tabular-nums"
                :data-usage-count="entry.usages.length"
              >{{ entry.usages.length }}</span>
            </button>
            <EditorMenu
              :items="menu(entry)"
              :content="{ align: 'end' }"
              :on-close-auto-focus="keepRenameFocus"
            >
              <EditorButton
                icon="i-lucide-ellipsis"
                size="xs"
                variant="ghost"
                aria-label="Component actions"
                class="absolute end-1 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
              />
            </EditorMenu>
          </template>
        </div>
        <ul
          v-if="expanded.has(entry.def.id) && entry.usages.length"
          class="mb-1 ms-6 border-l border-default ps-2"
          data-component-usages
        >
          <li
            v-for="usage in entry.usages"
            :key="`${usage.file}:${usage.nodeId}`"
          >
            <button
              type="button"
              class="flex h-6 w-full min-w-0 items-center gap-1.5 rounded px-1 text-left text-xs text-muted hover:bg-white/4 hover:text-highlighted"
              :title="`${usage.where} (${usage.nodeId})`"
              @click="goToUsage(usage)"
            >
              <UIcon
                :name="usage.kind === 'page' ? 'i-lucide-file' : usage.kind === 'layout' ? 'i-lucide-layout-template' : 'i-lucide-component'"
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
