<script setup lang="ts">
import { getComponent } from '#shared/document/components'
import type { PropDef, PropValue } from '#shared/document/components'
import { findParent } from '#shared/document/tree'
import type { PropGroup } from '#shared/editor/propGroups'
import { groupedProps, isDefaultProp, PROP_GROUPS } from '#shared/editor/propGroups'
import { breadcrumb } from '#shared/editor/selection'
import { sharedStyle } from '#shared/editor/panel'
import { FORM_TYPE, formFields, sampleValues } from '#shared/runtime/form'

/**
 * The right panel: a sticky head with the element's identity, breadcrumb and
 * quick actions, then the Style and Settings tabs (both stay mounted). The
 * Style tab edits the breakpoint of the canvas frame picked last, which a
 * caption names (Framer has one breakpoint control: the frame). With several nodes selected the
 * head reads "N selected" and only the Style tab shows: their shared values,
 * "Mixed" where they differ, and an edit goes to all of them (one undo step).
 */
const editor = useEditor()
const toast = useToast()

const node = computed(() => editor.selected)
const multi = computed(() => editor.selectedNodes.length > 1)
const shared = computed(() => (multi.value ? sharedStyle(editor.selectedNodes.map(n => n.style)) : { style: node.value?.style ?? {}, mixed: [] }))
/** The type the Style tab shows fields for: the one all selected nodes share, else the primary's. */
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

type Tab = 'style' | 'settings'
// Until a tab is picked, nodes with a text prop open on Settings, where it is edited.
const pickedTab = ref<Tab | null>(null)
// Settings edit one node, so a multi-selection shows Style only.
const tab = computed<Tab>(() => (multi.value ? 'style' : pickedTab.value ?? (propDefs.value.some(d => d.name === 'text') ? 'settings' : 'style')))
const tabs = computed<{ value: Tab, label: string }[]>(() => (multi.value
  ? [{ value: 'style', label: 'Style' }]
  : [{ value: 'style', label: 'Style' }, { value: 'settings', label: 'Settings' }]))

function propValue(name: string, fallback: PropValue): PropValue {
  return node.value?.props[name] ?? fallback
}

// Settings: the props in Content, Behaviour, Appearance, Advanced sections; Shift-click toggles them all.
const propGroups = computed(() => groupedProps(propDefs.value))
const openGroups = ref(new Set<PropGroup>(PROP_GROUPS))
const changed = (def: PropDef) => !!node.value && !isDefaultProp(def, node.value.props)

function toggleGroup(group: PropGroup, event: MouseEvent) {
  const open = !openGroups.value.has(group)
  const targets = event.shiftKey ? PROP_GROUPS : [group]
  const next = new Set(openGroups.value)
  for (const target of targets) {
    if (open) next.add(target)
    else next.delete(target)
  }
  openGroups.value = next
}

// The canvas never submits forms (clicks select), so a Form is tried out here instead.
const formCollection = computed(() => {
  if (node.value?.type !== FORM_TYPE) return undefined
  return editor.project?.collections.find(c => c.slug === node.value!.props.collection && c.source.type === 'internal')
})

async function testSubmit() {
  const form = node.value
  const collection = formCollection.value
  if (!form || !collection) return
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
            <UButton
              icon="i-lucide-copy"
              color="neutral"
              variant="ghost"
              size="xs"
              aria-label="Duplicate"
              @click="editor.duplicate()"
            />
          </UTooltip>
          <UTooltip
            text="Delete"
            :kbds="['delete']"
          >
            <UButton
              icon="i-lucide-trash-2"
              color="neutral"
              variant="ghost"
              size="xs"
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

      <div
        class="mx-2.5 mb-2 flex gap-1"
        role="tablist"
      >
        <button
          v-for="item in tabs"
          :key="item.value"
          type="button"
          role="tab"
          class="h-7 rounded-md px-2 text-[13px] font-medium"
          :class="tab === item.value ? 'bg-white/8 text-highlighted' : 'text-muted hover:text-toned'"
          :aria-selected="tab === item.value"
          @click="pickedTab = item.value"
        >
          {{ item.label }}
        </button>
      </div>

      <p
        v-show="tab === 'style'"
        class="-mt-1 px-4 pb-2 text-[11px] text-dimmed"
        :data-editing-caption="editor.deviceId"
      >
        Editing {{ editor.device.label }}
      </p>
    </div>

    <div
      :key="multi ? editor.selectedIds.join() : node.id"
      class="pb-6"
    >
      <div
        v-show="tab === 'style'"
        role="tabpanel"
        data-tab="style"
      >
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

      <div
        v-if="!multi"
        v-show="tab === 'settings'"
        role="tabpanel"
        data-tab="settings"
      >
        <div
          v-if="isRoot && editor.page"
          class="space-y-2 border-b border-default py-3.5 ps-4 pe-3"
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
        </div>

        <EditorStyleSection
          v-for="{ group, props: defs } in propGroups"
          :key="group"
          :label="group"
          :open="openGroups.has(group)"
          :mark="defs.some(changed) ? 'set' : undefined"
          :data-prop-group="group"
          @toggle="toggleGroup(group, $event)"
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
            <UButton
              label="Test submit"
              icon="i-lucide-send"
              color="neutral"
              variant="outline"
              size="xs"
              block
              :disabled="!formCollection"
              @click="testSubmit"
            />
            <p class="text-[11px] text-dimmed">
              {{ formCollection ? `Adds a record with sample values to ${formCollection.name}.` : 'Choose an internal collection to test this Form.' }}
            </p>
          </div>
        </EditorStyleSection>

        <p
          v-if="!propDefs.length && !isRoot"
          class="p-3 text-xs text-dimmed"
        >
          This component has no settings.
        </p>
      </div>
    </div>
  </div>
</template>
