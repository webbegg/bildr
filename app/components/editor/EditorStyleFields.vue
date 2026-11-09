<script setup lang="ts">
import { isResponsiveToken, styleClasses, styleKey } from '#shared/design/tokens'
import type { StyleToken } from '#shared/design/tokens'
import type { StyleSection } from '#shared/editor/styleFields'
import { fieldLabel, sectionMark, spacingItems, STYLE_SECTIONS, styleFieldControl, styleProvenance, styleSections } from '#shared/editor/styleFields'

/**
 * Design-token pickers for a node's style, in Stacki's collapsible sections:
 * swatches from the project theme for colours, the spacing scale in px for
 * the project density, segments or selects for the rest. Every pick is one
 * `update` (one undo step). Responsive tokens edit the editor device's
 * breakpoint (Mobile is the base, Tablet `md:`, Desktop `lg:`); each row's
 * label shows whether the device sets the value or inherits it.
 */
const props = defineProps<{ styles: Record<string, string> }>()
const emit = defineEmits<{ update: [style: Record<string, string | null>] }>()
const editor = useEditor()

const ALIGN_ICONS: Record<string, string> = {
  left: 'i-lucide-align-left',
  center: 'i-lucide-align-center',
  right: 'i-lucide-align-right',
  justify: 'i-lucide-align-justify'
}

const sections = styleSections()
const provenance = (token: StyleToken) => styleProvenance(props.styles, token.key, editor.deviceId)
const value = (token: StyleToken) => {
  const p = provenance(token)
  return p.state === 'set' ? p.value : undefined
}
const inherited = (token: StyleToken) => {
  const p = provenance(token)
  return p.state === 'inherited' ? p.value : undefined
}

// Collapsed sections, per section, across nodes and reloads.
const COLLAPSED_KEY = 'bildr:style-collapsed'
function readCollapsed(): Partial<Record<StyleSection, boolean>> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}')
  } catch {
    return {}
  }
}
const collapsed = ref(readCollapsed())
watch(collapsed, value => localStorage.setItem(COLLAPSED_KEY, JSON.stringify(value)), { deep: true })

/** Shift-click applies the header's next state to every section. */
function toggle(section: StyleSection, event: MouseEvent) {
  const next = !collapsed.value[section]
  const targets = event.shiftKey ? STYLE_SECTIONS : [section]
  collapsed.value = { ...collapsed.value, ...Object.fromEntries(targets.map(s => [s, next])) }
}

function options(token: StyleToken): { value: string, label: string }[] {
  if (styleFieldControl(token) === 'spacing') return spacingItems(token, editor.theme?.spacing ?? 'default')
  return token.values.map(value => ({ value, label: value }))
}

function segments(token: StyleToken) {
  return token.values.map(value => ({ value, label: value, icon: token.key === 'align' ? ALIGN_ICONS[value] : undefined }))
}

function setField(token: StyleToken, next: string | null) {
  const p = provenance(token)
  if (next === null) {
    if (p.state === 'set') emit('update', { [p.key]: null })
    return
  }
  if (p.state === 'set' && p.value === next) return
  emit('update', { [isResponsiveToken(token) ? styleKey(token.key, editor.device.breakpoint) : token.key]: next })
}
</script>

<template>
  <div :data-editing-breakpoint="editor.device.breakpoint ?? 'base'">
    <EditorStyleSection
      v-for="{ section, fields } in sections"
      :key="section"
      :label="section"
      :open="!collapsed[section]"
      :mark="sectionMark(styles, section, editor.deviceId)"
      @toggle="toggle(section, $event)"
    >
      <div
        v-for="field in fields"
        :key="field.key"
        class="grid min-h-7 grid-cols-[64px_minmax(0,1fr)] items-center gap-2"
        :data-style-row="field.key"
      >
        <div
          class="flex min-w-0"
          :data-field-label="field.key"
        >
          <EditorFieldLabel
            :label="fieldLabel(field)"
            :title="field.label"
            :provenance="provenance(field)"
            :device="editor.device.label"
            @reset="setField(field, null)"
          />
        </div>

        <EditorSwatchPicker
          v-if="styleFieldControl(field) === 'color' && editor.theme"
          :token="field"
          :value="value(field)"
          :theme="editor.theme"
          @update="setField(field, $event)"
        />
        <EditorSegmented
          v-else-if="styleFieldControl(field) === 'segmented'"
          :items="segments(field)"
          :model-value="value(field)"
          :inherited="inherited(field)"
          :data-style-key="field.key"
          @update:model-value="setField(field, $event)"
        />
        <USelect
          v-else
          :model-value="value(field)"
          :items="options(field)"
          :placeholder="inherited(field) ?? '—'"
          size="sm"
          class="w-full font-mono"
          :aria-label="field.label"
          :data-style-key="field.key"
          @update:model-value="setField(field, $event)"
        >
          <template
            v-if="field.key === 'font'"
            #item-label="{ item: option }"
          >
            <span :class="styleClasses({ font: option.value })">{{ option.label }}</span>
          </template>
        </USelect>
      </div>
    </EditorStyleSection>
  </div>
</template>
