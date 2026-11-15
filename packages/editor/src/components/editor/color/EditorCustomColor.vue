<script setup lang="ts">
import { computed } from 'vue'
import { DEFAULT_THEME } from '@bildr/codegen/design'
import { useToast } from '@nuxt/ui/composables/useToast'
import { customColorName, customColorNameProblem } from '@bildr/editor-core/color'
import { useEditor } from '../../../editor/useEditor.ts'

/**
 * One of the theme's own colours (`theme.custom`) in the Design view: its
 * swatch (opening the custom picker, previewed live through `themeDraft`
 * and committed once per gesture), its name and its hex. Renaming and
 * removing go through `theme_update`; the server refuses to drop a colour a
 * style still uses, and its message shows in the error toast (`editor.run`).
 */
const props = defineProps<{ name: string }>()
const editor = useEditor()
const toast = useToast()

/** The theme as saved (`editor.theme` follows the live preview). */
const theme = computed(() => editor.model?.theme ?? DEFAULT_THEME)
const hex = computed(() => theme.value.custom?.[props.name] ?? '#000000')
const shown = computed(() => editor.theme?.custom?.[props.name] ?? hex.value)

function preview(next: string | null) {
  editor.themeDraft = next ? { ...theme.value, custom: { ...theme.value.custom, [props.name]: next } } : null
}

async function commit(next: string) {
  if (next.toLowerCase() !== hex.value.toLowerCase()) await editor.run('theme_update', { custom: { [props.name]: next } })
  editor.themeDraft = null
}

function setHex(text: string) {
  const trimmed = text.trim()
  void commit(trimmed.startsWith('#') ? trimmed : `#${trimmed}`)
}

/** A new name: the colour moves to it in one step (refused while styles use the old name). */
function rename(text: string) {
  const next = customColorName(text)
  if (next === props.name) return
  const problem = customColorNameProblem(next, Object.keys(theme.value.custom ?? {}))
  if (problem) {
    toast.add({ title: 'Colour not renamed', description: problem, color: 'error', icon: 'i-lucide-circle-alert' })
    return
  }
  editor.run('theme_update', { custom: { [props.name]: null, [next]: hex.value } })
}

function remove() {
  editor.run('theme_update', { custom: { [props.name]: null } })
}
</script>

<template>
  <EditorRow
    :label="name"
    :title="`Theme colour ${name}: use it by name on any colour`"
    :name="`custom-${name}`"
    removable
    remove-icon="i-lucide-trash-2"
    :data-custom-color-row="name"
    @remove="remove"
  >
    <UPopover :content="{ side: 'left', align: 'start' }">
      <button
        type="button"
        class="size-[30px] shrink-0 rounded-lg ring-1 ring-white/10 ring-inset"
        :style="{ background: shown }"
        :aria-label="`Edit ${name}`"
      />
      <template #content>
        <div class="w-64 p-2">
          <EditorColorCustom
            :value="hex"
            @preview="preview"
            @commit="commit"
          />
        </div>
      </template>
    </UPopover>
    <EditorCommitInput
      class="min-w-0 flex-1"
      size="xs"
      :aria-label="`${name} colour name`"
      :model-value="name"
      @commit="rename"
    />
    <EditorCommitInput
      class="w-[84px] shrink-0 font-mono"
      size="xs"
      :aria-label="`${name} hex`"
      :model-value="hex"
      @commit="setHex"
    />
  </EditorRow>
</template>
