<script setup lang="ts">
import { getComponent } from '#shared/document/components'
import type { PropValue } from '#shared/document/components'
import { findParent } from '#shared/document/tree'
import { breadcrumb } from '#shared/editor/selection'
import type { DeviceId } from '#shared/editor/styleFields'
import { DEVICES, hasStyleAt } from '#shared/editor/styleFields'
import { FORM_TYPE, formFields, sampleValues } from '#shared/runtime/form'

/**
 * The right panel: a sticky head with the element's identity, breadcrumb and
 * quick actions, then the Style and Settings tabs (both stay mounted). The
 * Style tab edits the breakpoint of the editor device, which its select and
 * the toolbar's device toggle both change.
 */
const editor = useEditor()
const toast = useToast()

const node = computed(() => editor.selected)
const isRoot = computed(() => !!node.value && node.value.id === editor.page?.root.id)
const propDefs = computed(() => (node.value ? getComponent(node.value.type)?.props ?? [] : []))
const icon = (type: string) => getComponent(type)?.icon ?? 'i-lucide-file'
const parentType = computed(() => (node.value && editor.page ? findParent(editor.page.root, node.value.id)?.parent.type : undefined))
const crumbs = computed(() => (node.value && editor.page ? breadcrumb(editor.page.root, node.value.id) : []))
const crumbLabel = (crumb: { id: string, type: string }) => (crumb.id === editor.page?.root.id ? editor.page.name : crumb.type)

type Tab = 'style' | 'settings'
// Until a tab is picked, nodes with a text prop open on Settings, where it is edited.
const pickedTab = ref<Tab | null>(null)
const tab = computed<Tab>(() => pickedTab.value ?? (propDefs.value.some(d => d.name === 'text') ? 'settings' : 'style'))
const tabs: { value: Tab, label: string }[] = [{ value: 'style', label: 'Style' }, { value: 'settings', label: 'Settings' }]

const devices = computed(() => DEVICES.map(d => ({
  value: d.id,
  label: d.label,
  hint: d.breakpoint ?? 'base',
  icon: d.icon,
  overrides: !!node.value && hasStyleAt(node.value.style, d.id)
})))
const device = computed(() => devices.value.find(d => d.value === editor.deviceId)!)

function propValue(name: string, fallback: PropValue): PropValue {
  return node.value?.props[name] ?? fallback
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
      <div class="flex h-10 items-center gap-1.5 ps-3 pe-1.5">
        <UIcon
          :name="icon(node.type)"
          class="size-3.5 shrink-0 text-muted"
        />
        <p class="min-w-0 flex-1 truncate text-xs font-semibold text-highlighted">
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
        v-if="crumbs.length"
        class="-mt-1 flex flex-wrap items-center gap-x-0.5 px-3 pb-2 text-[11px]"
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
        class="relative mx-3 mb-2 grid grid-cols-2 rounded-md bg-muted p-0.5"
        role="tablist"
      >
        <span
          class="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-[6px] bg-accented transition-transform duration-200"
          :class="{ 'translate-x-full': tab === 'settings' }"
          aria-hidden="true"
        />
        <button
          v-for="item in tabs"
          :key="item.value"
          type="button"
          role="tab"
          class="relative h-6 text-xs font-medium"
          :class="tab === item.value ? 'text-highlighted' : 'text-muted hover:text-toned'"
          :aria-selected="tab === item.value"
          @click="pickedTab = item.value"
        >
          {{ item.label }}
        </button>
      </div>

      <div
        v-show="tab === 'style'"
        class="flex items-center gap-2 px-3 pb-2"
      >
        <span class="w-16 shrink-0 text-[11px] text-dimmed">Breakpoint</span>
        <USelect
          :model-value="editor.deviceId"
          :items="devices"
          :icon="device.icon"
          size="xs"
          class="min-w-0 flex-1"
          aria-label="Breakpoint"
          data-breakpoint-select
          @update:model-value="editor.deviceId = $event as DeviceId"
        >
          <template #default>
            <span class="truncate">{{ device.label }} <span class="font-mono text-dimmed">{{ device.hint }}</span></span>
          </template>
          <template #item-label="{ item }">
            {{ item.label }} <span class="font-mono text-dimmed">{{ item.hint }}</span>
          </template>
          <template #item-trailing="{ item }">
            <span
              v-if="item.overrides"
              class="size-1.5 rounded-full bg-(color:--editor-selection)"
              :data-overrides="item.value"
              :title="`Has styles on ${item.label}`"
            />
          </template>
        </USelect>
      </div>
    </div>

    <div
      :key="node.id"
      class="pb-6"
    >
      <div
        v-show="tab === 'style'"
        role="tabpanel"
        data-tab="style"
      >
        <EditorStyleFields
          :styles="node.style"
          :type="node.type"
          :parent-type="parentType"
          :root="isRoot"
          @preview="editor.previewStyle(node.id, $event)"
          @update="editor.updateStyle(node.id, $event)"
        />
      </div>

      <div
        v-show="tab === 'settings'"
        class="space-y-3 p-3"
        role="tabpanel"
        data-tab="settings"
      >
        <template v-if="isRoot && editor.page">
          <UFormField
            label="Page name"
            size="xs"
          >
            <EditorCommitInput
              :model-value="editor.page.name"
              @commit="renamePage('name', $event)"
            />
          </UFormField>
          <UFormField
            label="Slug"
            size="xs"
          >
            <EditorCommitInput
              :model-value="editor.page.slug"
              @commit="renamePage('slug', $event)"
            />
          </UFormField>
        </template>

        <EditorPropField
          v-for="def in propDefs"
          :key="def.name"
          :def="def"
          :value="propValue(def.name, def.default)"
          @update="editor.updateProps(node.id, { [def.name]: $event })"
        />

        <p
          v-if="!propDefs.length && !isRoot"
          class="text-xs text-dimmed"
        >
          {{ node.type }} has no settings.
        </p>

        <div
          v-if="node.type === FORM_TYPE"
          class="space-y-1.5"
        >
          <UButton
            label="Test submit"
            icon="i-lucide-send"
            color="neutral"
            variant="outline"
            size="sm"
            block
            :disabled="!formCollection"
            @click="testSubmit"
          />
          <p class="text-xs text-dimmed">
            {{ formCollection ? `Adds a record with sample values to ${formCollection.name}.` : 'Choose an internal collection to test this Form.' }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
