<script setup lang="ts">
import { getStyleToken, isResponsiveToken, styleClasses, styleKey } from '#shared/design/tokens'
import { structuralStyle } from '#shared/document/components'
import { naturalDisplay, visibilityAt, visibilityToggle } from '#shared/editor/layers'
import type { LayoutType, PanelSection, RowId, SplitToken } from '#shared/editor/panel'
import { joinSplit, layoutType, layoutTypeWrite, PANEL_SECTIONS, panelRows, panelSectionMark, rowAdd, rowKeys, rowProvenance, rowReset, sectionRemove, SPLIT_KEYS, splitMode } from '#shared/editor/panel'
import { previewFocusedOption } from '#shared/editor/preview'
import type { SizeKey, SizeMode } from '#shared/editor/sizeModes'
import { SIZE_MODE_LABELS, sizeMode, sizeModes, sizeModeValue } from '#shared/editor/sizeModes'
import type { Provenance } from '#shared/editor/styleFields'
import { styleProvenance } from '#shared/editor/styleFields'

/**
 * Design-token controls for a node's style, in Framer's sections (Size,
 * Layout, Styles, Typography) of label-column rows: a grey label on the left
 * (drag it to scrub a number; blue when the device overrides the value, with
 * Reset override) and the control on the right. A section none of whose
 * tokens applies shows its title and a "+"; optional props show as "Add…"
 * rows that add a default token (see `panelRows`). Responsive tokens edit the
 * editor device's breakpoint (Mobile is the base, Tablet `md:`, Desktop `lg:`).
 *
 * Token mappings: Type Stack/Grid is the `display` token (see
 * `layoutTypeWrite`), Distribute is `justify`, Align is `items`, Wrap is
 * `flexWrap` (over a Row's `wrap` prop), Height is `minH` with Framer's size
 * modes (see `sizeModes`), Padding and Margin write `p`/`m` or their sides
 * (see `boxWrite`).
 *
 * Controls `preview` what a gesture holds and `commit` once; this panel emits
 * the commit as one `update` (one undo step) and passes previews on.
 * For a multi-selection `styles` holds the shared values and `mixed` the
 * tokens that differ, whose fields read "Mixed".
 */
const props = defineProps<{
  styles: Record<string, string>
  /** Base token keys whose values differ across the selected nodes. */
  mixed?: string[]
  type: string
  /** The parent's type; a Grid child gets a column span. */
  parentType?: string
  root?: boolean
}>()
const emit = defineEmits<{
  update: [style: Record<string, string | null>]
  preview: [style: Record<string, string | null> | null]
}>()
const editor = useEditor()

const token = (key: string) => getStyleToken(key)!
const provenance = (key: string) => styleProvenance(props.styles, key, editor.deviceId)
const own = (key: string) => {
  const p = provenance(key)
  return p.state === 'set' ? p.value : undefined
}
const inherited = (key: string) => {
  const p = provenance(key)
  return p.state === 'inherited' ? p.value : undefined
}
const current = (key: string) => own(key) ?? inherited(key)
const isMixed = (...keys: string[]) => keys.some(key => props.mixed?.includes(key))
/** A field's placeholder: "Mixed" when the selected nodes differ, else `fallback`. */
const ph = (key: string, fallback?: string) => (isMixed(key) ? 'Mixed' : fallback)

const breakpoint = computed(() => editor.device.breakpoint)
/** The key a token is written to on the current device. */
const keyAt = (key: string) => (isResponsiveToken(token(key)) ? styleKey(key, breakpoint.value) : key)

function setField(key: string, next: string | null) {
  const p = provenance(key)
  if (next === null) {
    if (p.state === 'set') emit('update', { [p.key]: null })
    return
  }
  if (p.state === 'set' && p.value === next) return
  emit('update', { [keyAt(key)]: next })
}

const preview = (key: string, value: string | null) => emit('preview', value === null ? null : { [keyAt(key)]: value })
const atDevice = (patch: Record<string, string>) => Object.fromEntries(Object.entries(patch).map(([key, value]) => [keyAt(key), value]))
const update = (patch: Record<string, string | null>) => Object.keys(patch).length && emit('update', patch)

/** Select content that previews the option under the pointer or keyboard focus (items carry `data-option-value`). */
const optionPreview = (key: string) => previewFocusedOption(value => preview(key, value))

const natural = computed(() => naturalDisplay({ type: props.type, props: {} }))
/** Optional rows added this session, before (or, for Display, without) a token. */
const added = ref<RowId[]>([])
const sections = computed(() => panelRows(
  { type: props.type, parentType: props.parentType, root: props.root, style: props.styles, natural: natural.value },
  { device: editor.deviceId, added: added.value, mixed: props.mixed }
))

// Sections: a present one is open unless collapsed (remembered across nodes and reloads);
// an empty one shows its title and "+" until opened.
const COLLAPSED_KEY = 'bildr:panel-collapsed-v2'
function readCollapsed(): Partial<Record<PanelSection, boolean>> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}')
  } catch {
    return {}
  }
}
const collapsed = ref(readCollapsed())
watch(collapsed, value => localStorage.setItem(COLLAPSED_KEY, JSON.stringify(value)), { deep: true })
const opened = ref<PanelSection[]>([])
const present = (section: PanelSection) => sections.value.find(s => s.section === section)!.present
const isOpen = (section: PanelSection) => (present(section) ? !collapsed.value[section] : opened.value.includes(section))

/** Shift-click applies the header's next state to every section. */
function toggle(section: PanelSection, event: MouseEvent) {
  const next = !isOpen(section)
  for (const target of event.shiftKey ? PANEL_SECTIONS : [section]) {
    collapsed.value = { ...collapsed.value, [target]: !next }
    opened.value = next ? [...new Set([...opened.value, target])] : opened.value.filter(s => s !== target)
  }
}

/** A section's "−": its values go, at every breakpoint, and it closes back to its title. */
function removeSection(section: PanelSection) {
  opened.value = opened.value.filter(s => s !== section)
  added.value = added.value.filter(row => !sections.value.find(s => s.section === section)!.rows.some(r => r.id === row))
  update(sectionRemove(props.styles, section))
}

function addRow(row: RowId) {
  added.value = [...added.value, row]
  update(atDevice(rowAdd(row)))
}

/** Reset override on a row: its keys set at this breakpoint; an optional row unset everywhere turns back into "Add…". */
function resetRow(row: RowId) {
  added.value = added.value.filter(other => other !== row)
  const responsive = isResponsiveToken(token(rowKeys(row)[0]!))
  update(rowReset(props.styles, row, responsive ? breakpoint.value : undefined))
}

const rowLabel = (row: RowId) => ({ provenance: rowProvenance(props.styles, row, editor.deviceId), device: editor.device.label })

const LABELS: Record<RowId, string> = {
  width: 'Width', height: 'Height', minMax: 'Min Max', type: 'Type', direction: 'Direction', distribute: 'Distribute',
  align: 'Align', wrap: 'Wrap', columns: 'Columns', gap: 'Gap', padding: 'Padding', span: 'Span', margin: 'Margin', self: 'Self',
  visible: 'Visible', opacity: 'Opacity', fill: 'Fill', border: 'Border', shadows: 'Shadows', radius: 'Radius',
  overflow: 'Overflow', display: 'Display', fontSize: 'Size', fontWeight: 'Weight', textAlign: 'Align', textColor: 'Color'
}
const ADD_ICONS: Partial<Record<RowId, string>> = {
  minMax: 'i-lucide-move-horizontal', padding: 'i-lucide-square-dashed', margin: 'i-lucide-square-dashed-bottom',
  self: 'i-lucide-align-center-vertical', opacity: 'i-lucide-blend', fill: 'i-lucide-paint-bucket', border: 'i-lucide-square',
  shadows: 'i-lucide-copy', overflow: 'i-lucide-scan', display: 'i-lucide-eye'
}

// Size: Fixed / Fit / Fill / Relative over `w` and `minH`.
const modeItems = (key: SizeKey) => sizeModes(key).map(mode => ({ value: mode, label: SIZE_MODE_LABELS[mode] }))
function setMode(key: SizeKey, mode: SizeMode) {
  const next = sizeModeValue(key, mode, current(key))
  // Fit clears the minimum height; over an inherited one it writes 0.
  if (next === null) return own(key) !== undefined ? setField(key, null) : inherited(key) !== undefined && setField(key, '0')
  setField(key, next)
}

// Layout: Type, Direction, Distribute and Align.
const layout = computed(() => layoutType(props.type, props.styles, editor.deviceId))
const typeProvenance = computed((): Provenance => {
  const p = provenance('display')
  return p.state !== 'unset' && ['grid', 'flex'].includes(p.value) ? p : { state: 'unset' }
})
const TYPE_ITEMS = [{ value: 'stack', label: 'Stack' }, { value: 'grid', label: 'Grid' }]
const setType = (next: string) => update(layoutTypeWrite(props.type, props.styles, editor.deviceId, next as LayoutType))

const direction = computed(() => current('direction') ?? structuralStyle(props.type).direction ?? 'row')
const DIRECTION_ITEMS = [{ value: 'row', label: 'Horizontal', icon: 'i-lucide-move-horizontal' }, { value: 'col', label: 'Vertical', icon: 'i-lucide-move-vertical' }]
const DISTRIBUTE_LABELS: Record<string, string> = { start: 'Start', center: 'Center', end: 'End', between: 'Space between', around: 'Space around', evenly: 'Space evenly' }
const alignItems = computed(() => {
  const row = direction.value.startsWith('row')
  const [axis, names] = row ? ['horizontal', ['Top', 'Middle', 'Bottom']] : ['vertical', ['Left', 'Center', 'Right']]
  return (['start', 'center', 'end'] as const).map((value, i) => ({ value, label: names[i]!, icon: `i-lucide-align-${value}-${axis}` }))
})

// Wrap: without a token, a Row wraps when its `wrap` prop is on; other stacks don't.
const WRAP_ITEMS = [{ value: 'wrap', label: 'Yes' }, { value: 'nowrap', label: 'No' }]
const wrapFallback = computed(() => (props.type === 'Row' && editor.selectedNodes.length > 0 && editor.selectedNodes.every(n => n.props.wrap) ? 'wrap' : 'nowrap'))

// Styles: Visible reads and writes `display` at the device, like the layers eye.
const visible = computed(() => !visibilityAt(props.styles, editor.deviceId).hidden)
const VISIBLE_ITEMS = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]
function setVisible(next: string) {
  if ((next === 'yes') === visible.value) return
  update(visibilityToggle(props.styles, editor.deviceId, layout.value === 'grid' ? 'grid' : natural.value))
}

// Radius and border width: all sides, or per corner or side (Framer's split toggle).
const splitOf = () => ({ rounded: splitMode(props.styles, 'rounded') === 'split', border: splitMode(props.styles, 'border') === 'split' })
const split = ref(splitOf())
watch(splitOf, (value) => {
  split.value = { rounded: split.value.rounded || value.rounded, border: split.value.border || value.border }
})
/** Leaving split mode writes the first corner or side as the all-sides value. */
function setSplit(target: SplitToken, next: boolean) {
  split.value = { ...split.value, [target]: next }
  if (!next) update(joinSplit(props.styles, target))
}
const SPLIT_LETTERS: Record<SplitToken, string[]> = { rounded: ['TL', 'TR', 'BR', 'BL'], border: ['T', 'R', 'B', 'L'] }
/** The joined corner or side cells; each shows the all-sides value until it overrides it. */
const splitCells = (target: SplitToken) => SPLIT_KEYS[target].map((key, i) => ({
  key,
  letter: SPLIT_LETTERS[target][i]!,
  token: token(key),
  value: own(key),
  inherited: own(key) === undefined ? current(target) : undefined,
  placeholder: ph(key, target === 'rounded' ? 'none' : '0')
}))

const segments = (key: string, labels: Record<string, string> = {}, icons: Record<string, string> = {}) =>
  token(key).values.map(value => ({ value, label: labels[value] ?? value, icon: icons[value] }))

const ALIGN_ICONS: Record<string, string> = { left: 'i-lucide-align-left', center: 'i-lucide-align-center', right: 'i-lucide-align-right', justify: 'i-lucide-align-justify' }
const ALIGN_LABELS: Record<string, string> = { left: 'Left', center: 'Center', right: 'Right', justify: 'Justify' }
const SELF_ICONS: Record<string, string> = {
  start: 'i-lucide-align-start-vertical',
  center: 'i-lucide-align-center-vertical',
  end: 'i-lucide-align-end-vertical',
  stretch: 'i-lucide-stretch-vertical'
}
const SELF_LABELS: Record<string, string> = { auto: 'Auto', start: 'Start', center: 'Center', end: 'End', stretch: 'Stretch' }
const DISPLAY_LABELS: Record<string, string> = { hidden: 'Hidden', block: 'Block', flex: 'Flex', grid: 'Grid' }
const OVERFLOW_LABELS: Record<string, string> = { visible: 'Visible', hidden: 'Hidden', auto: 'Auto', scroll: 'Scroll', clip: 'Clip' }
const SHADOW_LABELS: Record<string, string> = { 'none': 'None', 'xs': 'Extra small', 'sm': 'Small', 'md': 'Medium', 'lg': 'Large', 'xl': 'Extra large', '2xl': 'Huge' }

// A select in a field shell.
const SELECT = 'h-full min-w-0 flex-1 ps-2.5 text-[13px]'
const SELECT_UI = { trailingIcon: 'size-3.5 text-dimmed', placeholder: 'text-dimmed' }
</script>

<template>
  <div :data-editing-breakpoint="editor.device.breakpoint ?? 'base'">
    <EditorStyleSection
      v-for="{ section, rows } in sections"
      :key="section"
      :label="section"
      :open="isOpen(section)"
      :mark="panelSectionMark(styles, section, editor.deviceId)"
      removable
      @toggle="toggle(section, $event)"
      @remove="removeSection(section)"
    >
      <template
        v-for="row in rows"
        :key="row.id"
      >
        <EditorAddRow
          v-if="row.add"
          :label="LABELS[row.id]"
          :icon="ADD_ICONS[row.id] ?? 'i-lucide-plus'"
          :name="row.id"
          @add="addRow(row.id)"
        />

        <EditorScaleRow
          v-else-if="row.id === 'width' || row.id === 'height'"
          v-bind="rowLabel(row.id)"
          :label="LABELS[row.id]"
          :token="token(row.id === 'width' ? 'w' : 'minH')"
          :value="own(row.id === 'width' ? 'w' : 'minH')"
          :inherited="inherited(row.id === 'width' ? 'w' : 'minH')"
          :placeholder="ph(row.id === 'width' ? 'w' : 'minH', 'auto')"
          :data-style-row="row.id === 'width' ? 'w' : 'minH'"
          @preview="preview(row.id === 'width' ? 'w' : 'minH', $event)"
          @commit="setField(row.id === 'width' ? 'w' : 'minH', $event)"
          @reset="resetRow(row.id)"
        >
          <template #after>
            <EditorField class="w-[100px] shrink-0">
              <USelect
                :model-value="sizeMode(row.id === 'width' ? 'w' : 'minH', current(row.id === 'width' ? 'w' : 'minH'))"
                :items="modeItems(row.id === 'width' ? 'w' : 'minH')"
                placeholder="Auto"
                variant="none"
                size="sm"
                :class="SELECT"
                :ui="SELECT_UI"
                :aria-label="`${LABELS[row.id]} mode`"
                :data-size-mode="row.id === 'width' ? 'w' : 'minH'"
                @update:model-value="setMode(row.id === 'width' ? 'w' : 'minH', $event as SizeMode)"
              />
            </EditorField>
          </template>
        </EditorScaleRow>

        <EditorScaleRow
          v-else-if="row.id === 'minMax'"
          v-bind="rowLabel(row.id)"
          label="Max W"
          :token="token('maxW')"
          :value="own('maxW')"
          :inherited="inherited('maxW')"
          :placeholder="ph('maxW', 'none')"
          data-style-row="maxW"
          @preview="preview('maxW', $event)"
          @commit="setField('maxW', $event)"
          @reset="resetRow(row.id)"
        />

        <EditorRow
          v-else-if="row.id === 'type'"
          :label="LABELS.type"
          title="Layout type"
          :provenance="typeProvenance"
          :device="editor.device.label"
          name="type"
          data-style-row="type"
          @reset="setField('display', null)"
        >
          <EditorSegmented
            dense
            :items="TYPE_ITEMS"
            :model-value="typeProvenance.state === 'set' ? layout : undefined"
            :fallback="layout"
            aria-label="Layout type"
            data-style-key="type"
            @update:model-value="setType"
          />
        </EditorRow>

        <EditorRow
          v-else-if="row.id === 'direction'"
          v-bind="rowLabel(row.id)"
          :label="LABELS.direction"
          :title="token('direction').label"
          name="direction"
          data-style-row="direction"
          @reset="resetRow(row.id)"
        >
          <EditorSegmented
            dense
            tooltips
            :items="DIRECTION_ITEMS"
            :model-value="own('direction')"
            :inherited="inherited('direction')"
            :fallback="direction"
            aria-label="Direction"
            data-style-key="direction"
            @update:model-value="setField('direction', $event)"
          />
        </EditorRow>

        <EditorRow
          v-else-if="row.id === 'distribute'"
          v-bind="rowLabel(row.id)"
          :label="LABELS.distribute"
          :title="token('justify').label"
          name="justify"
          data-style-row="justify"
          @reset="resetRow(row.id)"
        >
          <EditorField class="flex-1">
            <USelect
              :model-value="own('justify')"
              :items="segments('justify', DISTRIBUTE_LABELS)"
              :placeholder="ph('justify', DISTRIBUTE_LABELS[inherited('justify') ?? 'start'])"
              variant="none"
              size="sm"
              :class="SELECT"
              :ui="SELECT_UI"
              :aria-label="token('justify').label"
              data-style-key="justify"
              :content="optionPreview('justify')"
              @update:model-value="setField('justify', $event)"
              @update:open="!$event && preview('justify', null)"
            >
              <template #item-label="{ item: option }">
                <span :data-option-value="option.value">{{ option.label }}</span>
              </template>
            </USelect>
          </EditorField>
        </EditorRow>

        <EditorRow
          v-else-if="row.id === 'align'"
          v-bind="rowLabel(row.id)"
          :label="LABELS.align"
          :title="token('items').label"
          name="items"
          data-style-row="items"
          @reset="resetRow(row.id)"
        >
          <EditorSegmented
            dense
            tooltips
            :items="alignItems"
            :model-value="own('items')"
            :inherited="inherited('items')"
            :aria-label="token('items').label"
            data-style-key="items"
            @update:model-value="setField('items', $event)"
          />
        </EditorRow>

        <EditorRow
          v-else-if="row.id === 'wrap'"
          v-bind="rowLabel(row.id)"
          :label="LABELS.wrap"
          :title="token('flexWrap').label"
          name="flexWrap"
          data-style-row="flexWrap"
          @reset="resetRow(row.id)"
        >
          <EditorSegmented
            dense
            :items="WRAP_ITEMS"
            :model-value="own('flexWrap')"
            :inherited="inherited('flexWrap')"
            :fallback="wrapFallback"
            aria-label="Wrap"
            data-style-key="flexWrap"
            @update:model-value="setField('flexWrap', $event)"
          />
        </EditorRow>

        <EditorScaleRow
          v-else-if="row.id === 'columns' || row.id === 'span' || row.id === 'gap'"
          v-bind="rowLabel(row.id)"
          :label="LABELS[row.id]"
          :token="token(rowKeys(row.id)[0]!)"
          :value="own(rowKeys(row.id)[0]!)"
          :inherited="inherited(rowKeys(row.id)[0]!)"
          :placeholder="ph(rowKeys(row.id)[0]!, row.id === 'gap' ? '0' : undefined)"
          :stepper="row.id !== 'gap'"
          :slider="row.id === 'gap'"
          :data-style-row="rowKeys(row.id)[0]"
          @preview="preview(rowKeys(row.id)[0]!, $event)"
          @commit="setField(rowKeys(row.id)[0]!, $event)"
          @reset="resetRow(row.id)"
        />

        <EditorBoxRow
          v-else-if="row.id === 'padding' || row.id === 'margin'"
          v-bind="rowLabel(row.id)"
          :box="row.id === 'padding' ? 'p' : 'm'"
          :label="LABELS[row.id]"
          :styles="styles"
          :breakpoint="breakpoint"
          :mixed="isMixed(...rowKeys(row.id))"
          @preview="emit('preview', $event)"
          @commit="update"
          @reset="resetRow(row.id)"
        />

        <EditorRow
          v-else-if="row.id === 'self'"
          v-bind="rowLabel(row.id)"
          :label="LABELS.self"
          :title="token('self').label"
          name="self"
          data-style-row="self"
          @reset="resetRow(row.id)"
        >
          <EditorSegmented
            dense
            tooltips
            :items="segments('self', SELF_LABELS, SELF_ICONS).filter(item => item.value !== 'auto')"
            :model-value="own('self')"
            :inherited="inherited('self')"
            aria-label="Align self"
            data-style-key="self"
            @update:model-value="setField('self', $event)"
          />
        </EditorRow>

        <EditorRow
          v-else-if="row.id === 'visible'"
          v-bind="rowLabel(row.id)"
          :label="LABELS.visible"
          name="visible"
          data-style-row="visible"
          @reset="setField('display', null)"
        >
          <EditorSegmented
            dense
            :items="VISIBLE_ITEMS"
            :model-value="provenance('display').state === 'set' ? (visible ? 'yes' : 'no') : undefined"
            :fallback="visible ? 'yes' : 'no'"
            aria-label="Visible"
            data-style-key="visible"
            @update:model-value="setVisible"
          />
        </EditorRow>

        <EditorScaleRow
          v-else-if="row.id === 'opacity'"
          v-bind="rowLabel(row.id)"
          :label="LABELS.opacity"
          :token="token('opacity')"
          :value="own('opacity')"
          :placeholder="ph('opacity', '100')"
          slider
          data-style-row="opacity"
          @preview="preview('opacity', $event)"
          @commit="setField('opacity', $event)"
          @reset="resetRow(row.id)"
        />

        <EditorRow
          v-else-if="row.id === 'fill' || row.id === 'textColor'"
          v-bind="rowLabel(row.id)"
          :label="LABELS[row.id]"
          :title="token(rowKeys(row.id)[0]!).label"
          :name="rowKeys(row.id)[0]"
          :data-style-row="rowKeys(row.id)[0]"
          @reset="resetRow(row.id)"
        >
          <EditorSwatchPicker
            v-if="editor.theme"
            class="flex-1"
            :token="token(rowKeys(row.id)[0]!)"
            :value="own(rowKeys(row.id)[0]!)"
            :placeholder="ph(rowKeys(row.id)[0]!)"
            :theme="editor.theme"
            @preview="preview(rowKeys(row.id)[0]!, $event)"
            @update="setField(rowKeys(row.id)[0]!, $event)"
            @clear="resetRow(row.id)"
          />
        </EditorRow>

        <EditorRow
          v-else-if="row.id === 'border'"
          v-bind="rowLabel(row.id)"
          :label="LABELS.border"
          title="Border"
          name="border"
          data-style-row="stroke"
          :data-border-mode="split.border ? 'sides' : 'all'"
          @reset="resetRow(row.id)"
        >
          <EditorSwatchPicker
            v-if="editor.theme"
            class="min-w-0 flex-1"
            :token="token('borderColor')"
            :value="own('borderColor')"
            :placeholder="ph('borderColor')"
            :theme="editor.theme"
            data-style-row="borderColor"
            @preview="preview('borderColor', $event)"
            @update="setField('borderColor', $event)"
            @clear="setField('borderColor', null)"
          />
          <template #below>
            <div class="flex gap-2">
              <EditorScaleField
                class="flex-1"
                :token="token('border')"
                :value="own('border')"
                :placeholder="ph('border', '0')"
                data-style-row="border"
                @preview="preview('border', $event)"
                @commit="setField('border', $event)"
              />
              <EditorSplitToggle
                :model-value="split.border"
                name="sides"
                @update:model-value="setSplit('border', $event)"
              />
            </div>
            <EditorJoinedFields
              v-if="split.border"
              class="mt-2"
              :cells="splitCells('border')"
              data-style-row="border-sides"
              @preview="preview"
              @commit="setField"
            />
          </template>
        </EditorRow>

        <EditorRow
          v-else-if="row.id === 'shadows' || row.id === 'overflow' || row.id === 'fontWeight'"
          v-bind="rowLabel(row.id)"
          :label="LABELS[row.id]"
          :title="token(rowKeys(row.id)[0]!).label"
          :name="rowKeys(row.id)[0]"
          :data-style-row="rowKeys(row.id)[0]"
          @reset="resetRow(row.id)"
        >
          <EditorField class="flex-1">
            <USelect
              :model-value="own(rowKeys(row.id)[0]!)"
              :items="segments(rowKeys(row.id)[0]!, row.id === 'shadows' ? SHADOW_LABELS : row.id === 'overflow' ? OVERFLOW_LABELS : {})"
              :placeholder="ph(rowKeys(row.id)[0]!, inherited(rowKeys(row.id)[0]!) ?? (row.id === 'fontWeight' ? 'normal' : row.id === 'overflow' ? 'Visible' : 'None'))"
              variant="none"
              size="sm"
              :class="SELECT"
              :ui="SELECT_UI"
              :aria-label="token(rowKeys(row.id)[0]!).label"
              :data-style-key="rowKeys(row.id)[0]"
              :content="optionPreview(rowKeys(row.id)[0]!)"
              @update:model-value="setField(rowKeys(row.id)[0]!, $event)"
              @update:open="!$event && preview(rowKeys(row.id)[0]!, null)"
            >
              <template #item-label="{ item: option }">
                <span
                  :class="row.id === 'fontWeight' ? styleClasses({ font: option.value }) : undefined"
                  :data-option-value="option.value"
                >{{ option.label }}</span>
              </template>
              <template
                v-if="row.id === 'shadows'"
                #item-leading="{ item: option }"
              >
                <span class="grid size-5 place-items-center rounded-[3px] bg-neutral-300">
                  <span
                    class="block size-3 rounded-[2px] bg-white"
                    :class="styleClasses({ shadow: option.value })"
                  />
                </span>
              </template>
            </USelect>
          </EditorField>
        </EditorRow>

        <EditorScaleRow
          v-else-if="row.id === 'radius'"
          v-bind="rowLabel(row.id)"
          :label="LABELS.radius"
          :token="token('rounded')"
          :value="own('rounded')"
          :inherited="inherited('rounded')"
          :placeholder="ph('rounded', 'none')"
          stepper
          data-style-row="radius"
          :data-radius-mode="split.rounded ? 'corners' : 'all'"
          @preview="preview('rounded', $event)"
          @commit="setField('rounded', $event)"
          @reset="resetRow(row.id)"
        >
          <template #after>
            <EditorSplitToggle
              :model-value="split.rounded"
              name="corners"
              @update:model-value="setSplit('rounded', $event)"
            />
          </template>
          <template
            v-if="split.rounded"
            #below
          >
            <EditorJoinedFields
              :cells="splitCells('rounded')"
              @preview="preview"
              @commit="setField"
            />
          </template>
        </EditorScaleRow>

        <EditorRow
          v-else-if="row.id === 'display'"
          v-bind="rowLabel(row.id)"
          :label="LABELS.display"
          :title="token('display').label"
          name="display"
          data-style-row="display"
          @reset="resetRow(row.id)"
        >
          <EditorSegmented
            dense
            :items="segments('display', DISPLAY_LABELS)"
            :model-value="own('display')"
            :inherited="inherited('display')"
            :fallback="natural"
            aria-label="Display"
            data-style-key="display"
            @update:model-value="setField('display', $event)"
          />
        </EditorRow>

        <EditorScaleRow
          v-else-if="row.id === 'fontSize'"
          v-bind="rowLabel(row.id)"
          :label="LABELS.fontSize"
          :token="token('text')"
          :value="own('text')"
          :inherited="inherited('text')"
          :placeholder="ph('text', 'base')"
          data-style-row="text"
          @preview="preview('text', $event)"
          @commit="setField('text', $event)"
          @reset="resetRow(row.id)"
        />

        <EditorRow
          v-else-if="row.id === 'textAlign'"
          v-bind="rowLabel(row.id)"
          :label="LABELS.textAlign"
          :title="token('align').label"
          name="align"
          data-style-row="align"
          @reset="resetRow(row.id)"
        >
          <EditorSegmented
            dense
            tooltips
            :items="segments('align', ALIGN_LABELS, ALIGN_ICONS)"
            :model-value="own('align')"
            :inherited="inherited('align')"
            aria-label="Text align"
            data-style-key="align"
            @update:model-value="setField('align', $event)"
          />
        </EditorRow>
      </template>
    </EditorStyleSection>
  </div>
</template>
