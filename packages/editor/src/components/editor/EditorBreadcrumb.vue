<script setup lang="ts">
import { computed } from 'vue'
import { levelTrail } from '@bildr/editor-core/editStack'
import { FOCUS_RING } from '../../editorUi.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { componentUsages, PRIMARY_VARIANT, variantItems } from '../../shared/componentEditor.ts'
import { layoutPages } from '../../shared/layoutEditor.ts'

/**
 * The toolbar centre while editing a component or a layout, Framer's
 * breadcrumb: `📄 Home › ◇ Card › ◇ Button` (or `› ▭ Site layout`) in the
 * context purple. Each crumb goes to its level; Done (or Esc with nothing
 * selected) goes up one. Beside it: how many instances (or pages) the edits
 * reach and, for a component with variants, the variant the canvas shows
 * and edits, and the Board toggle, which lays every variant out side by side
 * on the canvas (on by default with 2 or more, counting the primary).
 */
const editor = useEditor()

const ICONS = { page: 'i-lucide-file', component: 'i-lucide-component', layout: 'i-lucide-layout-template' } as const

const crumbs = computed(() => levelTrail(editor.currentPage?.name ?? 'Page', editor.editStack, id =>
  editor.components.find(c => c.id === id)?.name ?? editor.layouts.find(l => l.id === id)?.name))
const reach = computed(() => {
  if (!editor.model) return ''
  if (editor.component) {
    const n = componentUsages(editor.model, editor.component.id).length
    return `${n} instance${n === 1 ? '' : 's'}`
  }
  if (editor.layout) {
    const n = layoutPages(editor.model, editor.layout.id).length
    return `${n} page${n === 1 ? '' : 's'}`
  }
  return ''
})
const variantChoices = computed(() => (editor.component ? variantItems(editor.component) : []))
</script>

<template>
  <nav
    aria-label="Breadcrumb"
    class="flex min-w-0 items-center gap-2"
    :data-component-view="editor.component ? '' : undefined"
    :data-layout-view="editor.layout ? '' : undefined"
    data-breadcrumb
  >
    <ol class="flex min-w-0 items-center gap-0.5">
      <li
        v-for="(crumb, i) in crumbs"
        :key="crumb.index"
        class="flex min-w-0 items-center gap-0.5"
        :class="i === crumbs.length - 1 ? 'shrink-0' : 'shrink'"
      >
        <UIcon
          v-if="i > 0"
          name="i-lucide-chevron-right"
          class="size-3.5 shrink-0 text-dimmed"
          aria-hidden="true"
        />
        <span
          v-if="i === crumbs.length - 1"
          class="flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-2 font-[550] text-(--editor-context)"
          aria-current="location"
          :data-crumb="crumb.kind"
        >
          <UIcon
            :name="ICONS[crumb.kind]"
            class="size-4 shrink-0"
          />
          <span class="truncate">{{ crumb.label }}</span>
        </span>
        <button
          v-else
          type="button"
          class="flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-2 text-toned hover:bg-white/8 hover:text-highlighted"
          :class="FOCUS_RING"
          :title="`Back to ${crumb.label}`"
          :data-crumb="crumb.kind"
          @click="editor.goToCrumb(crumb.index)"
        >
          <UIcon
            :name="ICONS[crumb.kind]"
            class="size-4 shrink-0"
            :class="crumb.kind === 'page' ? 'text-dimmed' : 'text-(--editor-component)'"
          />
          <span class="truncate">{{ crumb.label }}</span>
        </button>
      </li>
    </ol>
    <span
      class="shrink-0 text-dimmed tabular-nums"
      data-breadcrumb-reach
    >{{ reach }}</span>
    <div
      v-if="editor.component?.variants.length"
      class="w-32 shrink-0"
    >
      <EditorSelect
        :model-value="editor.variant?.id ?? PRIMARY_VARIANT"
        :items="variantChoices"
        aria-label="Variant to show and edit"
        data-component-view-variant
        @update:model-value="editor.selectVariant($event === PRIMARY_VARIANT ? null : $event)"
      />
    </div>
    <div
      v-if="editor.component"
      class="shrink-0"
      title="Show every variant side by side"
    >
      <EditorSwitch
        :model-value="editor.variantBoard"
        label="Board"
        aria-label="Variant board"
        data-variant-board-toggle
        @update:model-value="editor.setVariantBoard($event)"
      />
    </div>
    <EditorButton
      label="Done"
      variant="soft"
      size="xs"
      :aria-label="editor.component ? 'Leave the component view' : 'Leave the layout view'"
      :title="crumbs.length > 2 ? `Back to ${crumbs.at(-2)?.label} (Esc)` : 'Back to the page (Esc)'"
      data-breadcrumb-done
      @click="editor.leaveView()"
    />
  </nav>
</template>
