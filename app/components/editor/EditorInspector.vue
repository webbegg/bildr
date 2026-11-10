<script setup lang="ts">
import { takesFormRecords } from '#shared/data/collections'
import { getComponent } from '#shared/document/components'
import type { PropDef, PropValue } from '#shared/document/components'
import { findParent } from '#shared/document/tree'
import { groupedProps, isDefaultProp } from '#shared/editor/propGroups'
import { breadcrumb } from '#shared/editor/selection'
import { sharedStyle } from '#shared/editor/panel'
import { FORM_TYPE, formFields, sampleValues } from '#shared/runtime/form'

/**
 * The right panel, one scrolling view: a sticky head with the element's
 * identity, breadcrumb and quick actions, then the component's prop sections
 * (Content, Behaviour, Appearance, Advanced), then its style sections. The
 * styles edit the breakpoint of the canvas frame picked last (or the floating
 * bar's device switch), which a caption names, in the override blue off the
 * Primary Mobile. With several nodes selected the head reads "N selected" and
 * only the styles show: their shared values, "Mixed" where they differ, and an
 * edit goes to all of them (one undo step).
 */
const editor = useEditor()
const toast = useToast()

const node = computed(() => editor.selected)
const multi = computed(() => editor.selectedNodes.length > 1)
const shared = computed(() => (multi.value ? sharedStyle(editor.selectedNodes.map(n => n.style)) : { style: node.value?.style ?? {}, mixed: [] }))
/** The type the style sections show fields for: the one all selected nodes share, else the primary's. */
const styleType = computed(() => {
  const types = new Set(editor.selectedNodes.map(n => n.type))
  return types.size === 1 ? [...types][0]! : node.value?.type ?? ''
})
const styleTargets = computed(() => (multi.value ? editor.selectedNodes.map(n => n.id) : node.value?.id ?? []))
const isRoot = computed(() => !!node.value && !multi.value && node.value.id === editor.page?.root.id)
const propDefs = computed(() => (node.value ? getComponent(node.value.type)?.props ?? [] : []))
const icon = (type: string) => getComponent(type)?.icon ?? 'i-lucide-file'
const parentType = computed(() => (node.value && editor.page ? findParent(editor.page.root, node.value.id)?.parent.type : undefined))
const crumbs = computed(() => (node.value && editor.page ? breadcrumb(editor.page.root, node.value.id) : []))
const crumbLabel = (crumb: { id: string, type: string }) => (crumb.id === editor.page?.root.id ? editor.page.name : crumb.type)

function propValue(name: string, fallback: PropValue): PropValue {
  return node.value?.props[name] ?? fallback
}

// The props in Content, Behaviour, Appearance, Advanced sections, above the styles. Props edit one node, so a multi-selection shows styles only.
const propGroups = computed(() => groupedProps(propDefs.value))
const changed = (def: PropDef) => !!node.value && !isDefaultProp(def, node.value.props)

// The canvas never submits forms (clicks select), so a Form is tried out here instead.
const formCollection = computed(() => {
  if (node.value?.type !== FORM_TYPE) return undefined
  return editor.project?.collections.find(c => c.slug === node.value!.props.collection && takesFormRecords(c))
})

async function testSubmit() {
  const form = node.value
  const collection = formCollection.value
  if (!form || !collection) return
  if (collection.source.type === 'connection' && !confirm(`This sends a real ${collection.source.endpoints.create?.method ?? 'POST'} request to the "${collection.name}" API. It cannot be undone.`)) return
  const mapped = formFields(form)
  const values = sampleValues(collection.fields, new Date(), mapped.length ? mapped : undefined)
  const record = await editor.run<{ id: string }>('record_create', { collection: collection.id, values })
  if (record) toast.add({ title: `Test record added to ${collection.name}`, description: record.id, color: 'success', icon: 'i-lucide-check' })
}

function renamePage(field: 'name' | 'slug', value: string) {
  const next = value.trim()
  if (next) editor.runOnPage('page_rename', { [field]: next })
}
</script>

<template>
  <p
    v-if="!node"
    class="p-4 text-xs text-dimmed"
  >
    Select an element to style it.
  </p>
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
          class="min-w-0 flex-1 truncate text-[13px] font-semibold text-highlighted"
          :data-selection-count="editor.selectedNodes.length"
        >
          {{ editor.selectedNodes.length }} selected
        </p>
        <p
          v-else
          class="min-w-0 flex-1 truncate text-[13px] font-semibold text-highlighted"
        >
          {{ node.type }} <span class="ms-1 font-mono text-[11px] font-normal text-dimmed">{{ node.id }}</span>
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
        <span class="px-1 text-toned">{{ node.type }}</span>
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
          v-if="isRoot && editor.page"
          label="Page"
        >
          <EditorRow label="Page name">
            <EditorCommitInput
              size="xs"
              variant="soft"
              aria-label="Page name"
              :model-value="editor.page.name"
              @commit="renamePage('name', $event)"
            />
          </EditorRow>
          <EditorRow label="Slug">
            <EditorCommitInput
              size="xs"
              variant="soft"
              aria-label="Slug"
              :model-value="editor.page.slug"
              @commit="renamePage('slug', $event)"
            />
          </EditorRow>
        </EditorStyleSection>

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
            :value="propValue(def.name, def.default)"
            :changed="changed(def)"
            @update="editor.updateProps(node.id, { [def.name]: $event })"
            @reset="editor.updateProps(node.id, { [def.name]: def.default })"
          />
          <div
            v-if="group === 'Behaviour' && node.type === FORM_TYPE"
            class="space-y-1.5 pt-1.5"
          >
            <EditorButton
              variant="soft"
              size="xs"
              label="Test submit"
              icon="i-lucide-send"
              block
              :disabled="!formCollection"
              @click="testSubmit"
            />
            <p class="text-[11px] text-dimmed">
              {{ formCollection ? `Adds a record with sample values to ${formCollection.name}.` : 'Choose an internal collection to test this Form.' }}
            </p>
          </div>
        </EditorStyleSection>
      </template>

      <EditorStyleFields
        :styles="shared.style"
        :mixed="shared.mixed"
        :type="styleType"
        :parent-type="parentType"
        :root="isRoot"
        @preview="editor.previewStyle(styleTargets, $event)"
        @update="editor.updateStyle(styleTargets, $event)"
      />
    </div>
  </div>
</template>
