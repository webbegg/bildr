<script setup lang="ts">
import { computed } from 'vue'
import type { Value } from '@bildr/codegen/model'
import FormBindingPanel from '../../design/FormBindingPanel.vue'
import ListSourcePanel from '../../design/ListSourcePanel.vue'
import { FOCUS_RING } from '../../editorUi.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { findNode, findParent } from '../../design/tree.ts'
import { pathTo } from '../../editor/selection.ts'
import { isOverridden } from '../../shared/componentVariants.ts'
import { groupedProps, isDefaultProp } from '../../shared/propGroups.ts'
import type { PropGroup } from '../../shared/propGroups.ts'
import { nodeDef, propDefsOf } from '../../shared/nodeProps.ts'
import type { PropDef } from '../../shared/nodeProps.ts'
import { sharedStyle } from '../../shared/panel.ts'
import { isFlattenable } from '../../shared/presets.ts'

/**
 * The right panel, one scrolling view: a sticky head with the element's
 * identity, breadcrumb and quick actions, then the node's prop sections
 * (Content, Behaviour, Appearance, Advanced; Behaviour first on an actionable
 * node such as a Button or Link), then its style sections. The page root
 * leads with its Page section (name, path, layout, and the detail page rows
 * and what the page uses), then Layout (see `panelRows`). The
 * styles edit the breakpoint of the canvas frame picked last (or the floating
 * bar's device switch), which a caption names, in the override blue off the
 * Primary Mobile. With several nodes selected the head reads "N selected" and
 * only the styles show: their shared values, "Mixed" where they differ, and an
 * edit goes to all of them (one undo step).
 *
 * The module's data panels sit in the prop sections they belong to (S4): a List's
 * source (ListSourcePanel) and a Form's action and fields (FormBindingPanel) in
 * Behaviour, what a page uses (PageUsesPanel) under the page's rows. After the prop
 * sections, an Interactions section says what the node does on an event ("When Click → …",
 * EditorNodeInteractions, B3): on a Button, Checkbox or Form of a page, layout or component, and not on any other node.
 *
 * In the component and layout views the file's own sections follow (EditorComponentPanel:
 * an Instance's values, the variants, interactions and properties; EditorLayoutPanel:
 * slots and variables). With nothing selected only the hint shows, as in the hosted editor
 * (U-E2): select the root (its layer or the canvas) for the file's own sections.
 */
const editor = useEditor()

const node = computed(() => editor.selected)
const multi = computed(() => editor.selectedNodes.length > 1)
const shared = computed(() => (multi.value ? sharedStyle(editor.selectedNodes.map(n => n.style ?? {})) : { style: node.value?.style ?? {}, mixed: [] }))
/** The type the style sections show fields for: the one all selected nodes share, else the primary's. */
const styleType = computed(() => {
  const types = new Set(editor.selectedNodes.map(n => n.type))
  return types.size === 1 ? [...types][0]! : node.value?.type ?? ''
})
const styleTargets = computed(() => (multi.value ? editor.selectedNodes.map(n => n.id) : node.value?.id ?? []))
const isRoot = computed(() => !!node.value && !multi.value && node.value.id === editor.page?.root.id)
const propDefs = computed(() => (node.value ? propDefsOf(node.value.type) : []))
const icon = (type: string) => nodeDef(type)?.icon ?? 'i-lucide-file'
const parent = computed(() => (node.value && editor.page ? findParent(editor.page.root, node.value.id) : undefined))
const parentType = computed(() => parent.value?.type)
const flattenable = computed(() => !!node.value && !multi.value && !isRoot.value && isFlattenable(node.value))
/** The ancestors of the node, from the root down, for the head's breadcrumb. */
const crumbs = computed(() => (node.value && editor.page ? pathTo(editor.page.root, node.value.id).slice(0, -1).map(id => ({ id, type: findNode(editor.page!.root, id)!.type })) : []))
const crumbLabel = (crumb: { id: string, type: string }) => {
  if (crumb.id === editor.page?.root.id && editor.currentPage && !editor.component && !editor.layout) return editor.currentPage.name
  const ancestor = editor.page ? findNode(editor.page.root, crumb.id) : undefined
  return ancestor ? editor.nodeName(ancestor) : crumb.type
}

function propValue(def: PropDef): Value {
  return node.value?.props?.[def.name] ?? def.default
}

// The props in Content, Behaviour, Appearance, Advanced sections, above the styles. Props edit one node, so a multi-selection shows styles only.
// A page's List and Form have data panels (S4) that belong in Behaviour, whatever props that group has.
const onPage = computed(() => !editor.component && !editor.layout)
const propGroups = computed<{ group: PropGroup, props: PropDef[] }[]>(() => {
  const groups = groupedProps(propDefs.value, node.value?.type)
  const needsBehaviour = onPage.value && (node.value?.type === 'Form' || node.value?.type === 'List')
  return needsBehaviour && !groups.some(entry => entry.group === 'Behaviour') ? [{ group: 'Behaviour', props: [] }, ...groups] : groups
})
// With a variant shown, blue means overridden in it, and a reset (null) removes the override.
const changed = (def: PropDef) => !!node.value && (editor.variant ? isOverridden(editor.variant, node.value.id, 'props', def.name) : !isDefaultProp(def, node.value.props ?? {}))

/** A prop is written the way the model keeps it: the default is no prop (unless a variant overrides it), an empty text neither. */
function setProp(def: PropDef, value: Value | null) {
  if (!node.value) return
  const same = value === def.default || (def.numeric === true && value !== null && String(value) === String(def.default))
  const patch: Record<string, Value | null> = { [def.name]: value === null || (same && !editor.variant) ? null : value }
  // A link goes to a page or to a URL, not both.
  if (def.name === 'to' && value !== null) patch.href = null
  void editor.updateProps(node.value.id, patch)
}

function renamePage(field: 'name' | 'path', value: string) {
  const next = value.trim()
  if (next && editor.currentPage) void editor.run('page_update', { page: editor.currentPage.id, [field]: next })
}
</script>

<template>
  <div v-if="!node">
    <p class="p-4 text-xs text-dimmed">
      Select an element to style it.
    </p>
  </div>
  <div v-else>
    <div
      class="sticky top-0 z-10 border-b border-default bg-default"
      data-inspector-head
    >
      <div class="flex h-11 items-center gap-1.5 ps-4 pe-2">
        <UIcon
          :name="multi ? 'i-lucide-boxes' : icon(node.type)"
          class="size-3.5 shrink-0 text-muted"
        />
        <p
          v-if="multi"
          class="min-w-0 flex-1 truncate text-[12px] font-[550] text-highlighted"
          :data-selection-count="editor.selectedNodes.length"
        >
          {{ editor.selectedNodes.length }} selected
        </p>
        <p
          v-else
          class="min-w-0 flex-1 truncate text-[12px] font-[550] text-highlighted"
        >
          {{ editor.nodeName(node) }}
          <span
            v-if="node.type === 'Instance'"
            class="ms-1 rounded-sm bg-(--editor-component)/15 px-1 text-[10px] leading-4 font-[550] text-(--editor-component)"
            data-inspector-component-tag
          >Component</span>
          <span class="ms-1 font-mono text-[11px] font-[450] text-dimmed">{{ node.id }}</span>
        </p>
        <template v-if="!isRoot">
          <UTooltip
            text="Duplicate"
            :kbds="['meta', 'd']"
          >
            <EditorButton
              variant="ghost"
              size="xs"
              icon="i-lucide-copy"
              aria-label="Duplicate"
              @click="editor.duplicate()"
            />
          </UTooltip>
          <UTooltip
            text="Delete"
            :kbds="['delete']"
          >
            <EditorButton
              variant="ghost"
              size="xs"
              icon="i-lucide-trash-2"
              aria-label="Delete"
              @click="editor.remove()"
            />
          </UTooltip>
        </template>
      </div>

      <nav
        v-if="crumbs.length && !multi"
        class="-mt-1 flex flex-wrap items-center gap-x-0.5 px-3.5 pb-2 text-[11px]"
        aria-label="Ancestors"
        data-inspector-breadcrumb
      >
        <template
          v-for="crumb in crumbs"
          :key="crumb.id"
        >
          <button
            type="button"
            class="max-w-28 truncate rounded-sm px-1 text-muted hover:bg-elevated hover:text-highlighted"
            :class="FOCUS_RING"
            :data-crumb-id="crumb.id"
            @click="editor.selectedId = crumb.id"
            @mouseenter="editor.hoveredId = crumb.id"
          >
            {{ crumbLabel(crumb) }}
          </button>
          <UIcon
            name="i-lucide-chevron-right"
            class="size-3 text-dimmed"
          />
        </template>
        <span class="px-1 text-toned">{{ editor.nodeName(node) }}</span>
      </nav>

      <p
        class="-mt-1 px-4 pb-2 text-[11px]"
        :class="editor.device.breakpoint ? 'text-(color:--editor-selection)' : 'text-dimmed'"
        :data-editing-caption="editor.deviceId"
      >
        Editing {{ editor.device.label }}
      </p>
    </div>

    <div
      :key="multi ? editor.selectedIds.join() : node.id"
      class="pb-6"
    >
      <template v-if="!multi">
        <EditorStyleSection
          v-if="isRoot && editor.currentPage && !editor.component && !editor.layout"
          label="Page"
        >
          <EditorRow label="Page name">
            <EditorCommitInput
              size="xs"
              variant="soft"
              aria-label="Page name"
              :model-value="editor.currentPage.name"
              @commit="renamePage('name', $event)"
            />
          </EditorRow>
          <EditorRow label="Path">
            <EditorCommitInput
              size="xs"
              variant="soft"
              aria-label="Path"
              :model-value="editor.currentPage.path"
              @commit="renamePage('path', $event)"
            />
          </EditorRow>
          <EditorPageLayout />
          <EditorPageCollection />
        </EditorStyleSection>

        <EditorComponentPanel :node="node" />
        <EditorLayoutPanel :node="node" />
        <EditorVariantOverrides :node="node" />

        <EditorStyleSection
          v-for="{ group, props: defs } in propGroups"
          :key="group"
          :label="group"
          :data-prop-group="group"
        >
          <EditorPropField
            v-for="def in defs"
            :key="def.name"
            :def="def"
            :value="propValue(def)"
            :changed="changed(def)"
            bindable
            @update="setProp(def, $event)"
            @reset="setProp(def, null)"
          />
          <ListSourcePanel
            v-if="group === 'Behaviour' && node.type === 'List' && onPage"
            :node="node"
          />
          <FormBindingPanel
            v-if="group === 'Behaviour' && node.type === 'Form' && onPage"
            :node="node"
          />
        </EditorStyleSection>

        <EditorNodeInteractions :node="node" />
      </template>

      <div
        v-if="flattenable"
        class="mx-3 my-2 flex items-center gap-2 rounded-lg bg-elevated px-2 py-1.5 text-[11px] text-toned"
        role="note"
        data-flatten-hint
      >
        <span class="flex-1">This Stack only wraps one element and adds nothing.</span>
        <button
          type="button"
          class="text-primary hover:underline"
          @click="editor.unwrap(node!.id)"
        >
          Flatten
        </button>
      </div>
      <EditorStyleFields
        :styles="shared.style"
        :mixed="shared.mixed"
        :type="styleType"
        :parent-type="parentType"
        :parent-style="parent?.style"
        :root="isRoot"
        @preview="editor.previewStyle(styleTargets, $event)"
        @update="editor.updateStyle(styleTargets, $event)"
        @update-parent="parent && editor.updateStyle([parent.id], $event)"
      />
      <EditorSelectionColors />
    </div>
  </div>
</template>
