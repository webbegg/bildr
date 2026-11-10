<script setup lang="ts">
import type { LibraryTheme } from '#shared/design/library'

/**
 * The Design view's left sidebar: the theme library, shared by every
 * project. "Save current as theme" names the project's theme inline (Enter
 * or blur saves, Esc cancels); each row applies it (one undo step) or
 * changes the library, which is not undoable. Delete asks first.
 */
const editor = useEditor()
const toast = useToast()

const themes = ref<LibraryTheme[]>([])
const loaded = ref(false)
const saving = ref(false)
const saveName = ref('')
const deleting = ref<LibraryTheme | null>(null)
/** The last theme asked to delete, so the dialog keeps its text while it closes. */
const deleteName = ref('')
watch(deleting, (entry) => {
  if (entry) deleteName.value = entry.name
})
const deleteOpen = computed({
  get: () => !!deleting.value,
  set: (open: boolean) => {
    if (!open) deleting.value = null
  }
})

const projectTheme = computed(() => JSON.stringify(editor.project?.theme))
const isCurrent = (entry: LibraryTheme) => JSON.stringify(entry.theme) === projectTheme.value

async function reload() {
  themes.value = (await callAction<{ themes: LibraryTheme[] }>('theme_library_list')).themes
  loaded.value = true
}

onMounted(() => void reload().catch(fail))

function fail(error: unknown) {
  toast.add({ title: 'Theme library', description: actionErrorMessage(error), color: 'error', icon: 'i-lucide-circle-alert' })
}

/** Runs a library action, then reloads the list; failures become a toast and return undefined. */
async function library<T>(name: string, input: Record<string, unknown>): Promise<T | undefined> {
  try {
    const result = await callAction<T>(name, input)
    await reload()
    return result
  } catch (error) {
    fail(error)
    return undefined
  }
}

function startSave() {
  saveName.value = ''
  saving.value = true
}

async function commitSave() {
  if (!saving.value) return
  saving.value = false
  const name = saveName.value.trim()
  if (name) await library('theme_library_save', { name, projectId: editor.projectId })
}

async function apply(entry: LibraryTheme) {
  if (await editor.run('theme_apply', { themeId: entry.id })) {
    toast.add({ title: `Applied ${entry.name}`, description: 'Undo restores the previous theme.', color: 'success', icon: 'i-lucide-paintbrush' })
  }
}

async function updateFromProject(entry: LibraryTheme) {
  if (await library('theme_library_update', { themeId: entry.id, projectId: editor.projectId })) {
    toast.add({ title: `Updated ${entry.name}`, description: 'It now holds this project\'s theme.', color: 'success', icon: 'i-lucide-refresh-cw' })
  }
}

async function remove() {
  const entry = deleting.value
  deleting.value = null
  if (entry) await library('theme_library_delete', { themeId: entry.id })
}
</script>

<template>
  <div
    class="flex flex-col"
    data-theme-library
  >
    <div class="flex h-11 shrink-0 items-center justify-between ps-4 pe-2.5">
      <p class="text-[13px] font-semibold text-highlighted">
        Themes
      </p>
      <span class="text-[11px] text-dimmed tabular-nums">{{ themes.length || '' }}</span>
    </div>
    <div class="px-2 pb-2">
      <EditorInput
        v-if="saving"
        v-model="saveName"
        autofocus
        :maxlength="64"
        placeholder="Theme name"
        aria-label="New theme name"
        data-theme-save-name
        @keydown.enter="commitSave"
        @keydown.esc="saving = false"
        @blur="commitSave"
      />
      <EditorButton
        v-else
        variant="soft"
        icon="i-lucide-plus"
        label="Save current as theme"
        block
        data-theme-save
        @click="startSave"
      />
    </div>
    <div class="min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-3">
      <p
        v-if="loaded && !themes.length"
        class="px-4 py-2 text-[12px] text-dimmed"
      >
        No saved themes yet. Save this project's theme to reuse it in any project.
      </p>
      <DesignThemeRow
        v-for="entry in themes"
        :key="entry.id"
        :entry="entry"
        :current="isCurrent(entry)"
        @apply="apply(entry)"
        @update="updateFromProject(entry)"
        @rename="name => library('theme_library_update', { themeId: entry.id, name })"
        @duplicate="library('theme_library_duplicate', { themeId: entry.id })"
        @delete="deleting = entry"
      />
    </div>
    <EditorModal
      v-model:open="deleteOpen"
      title="Delete theme"
      width="sm"
    >
      <p class="text-[13px] text-toned">
        Delete “{{ deleteName }}” from the library? Projects that applied it keep their copy. This can't be undone.
      </p>
      <template #footer>
        <EditorButton
          variant="soft"
          label="Cancel"
          @click="deleting = null"
        />
        <EditorButton
          variant="danger"
          label="Delete"
          data-theme-delete-confirm
          @click="remove"
        />
      </template>
    </EditorModal>
  </div>
</template>
