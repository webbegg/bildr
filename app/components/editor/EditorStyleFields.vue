<script setup lang="ts">
import { getStyleToken, isResponsiveToken, styleClasses, styleKey } from '#shared/design/tokens'
import { structuralStyle } from '#shared/document/components'
import { naturalDisplay, visibilityAt, visibilityToggle } from '#shared/editor/layers'
import type { LayoutType, PanelMenuItem, RowId, SplitToken } from '#shared/editor/panel'
import { joinSplit, layoutReset, layoutType, layoutTypeWrite, panelRows, rowAdd, rowKeys, rowProvenance, rowReset, SPLIT_KEYS, splitMode } from '#shared/editor/panel'
import { previewFocusedOption } from '#shared/editor/preview'
import type { SizeKey, SizeMode } from '#shared/editor/sizeModes'
import { measuredSize, SIZE_MODE_LABELS, sizeMode, sizeModes, sizeModeValue } from '#shared/editor/sizeModes'
import type { MeasuredSizes } from '#shared/editor/measuredSizes'
import { createSizeMeasurer, EMPTY_SIZES, sizeContext } from '#shared/editor/measuredSizes'
import type { Provenance } from '#shared/editor/styleFields'
import { styleProvenance } from '#shared/editor/styleFields'

/**
 * Design-token controls for a node's style, in Framer's sections (Size,
 * Layout, Styles, Typography) of label-column rows: a grey label on the left
 * (drag it to scrub a number; blue when the device overrides the value, with
 * Reset override) and the control on the right. Each section shows its core
 * rows, Fill/Border/Shadows are "Add…" slots (× removes), and a header "+"
 * menu (two-line items) adds the other optional properties with a default
 * token at the edited breakpoint (Display, Individual corners and the
 * typography rows of a non-text node only reveal their control); hovering an
 * added row shows a "−" that clears it at that breakpoint (see `panelRows`).
 * A section with no row collapses to its title and "+": Layout on a leaf,
 * Typography on a container or Image. On a container the Layout header's "−"
 * is Reset layout.
 * Width and Height that are unset, auto, Fit or Fill show the measured px of
 * the selection in the active frame, greyed, instead of the token (re-measured
 * when the selection, the document or the device changes; a new selection,
 * device or tree shows the plain placeholder until then, `createSizeMeasurer`).
 * Responsive tokens edit the editor device's breakpoint (Mobile is the base,
 * Tablet `md:`, Desktop `lg:`).
 *
 * Token mappings: Type Stack/Grid is the `display` token (see
 * `layoutTypeWrite`), Distribute is `justify`, Align is `items`, Wrap is
 * `flexWrap` (over a Row's `wrap` prop), Width and Height are `w` and `h` with
 * Framer's size modes (see `sizeModes`), Padding and Margin write `p`/`m` or their sides
 * (see `boxWrite`).
 *
 * Controls `preview` what a gesture holds and `commit` once; this panel emits
 * the commit as one `update` (one undo step) and passes previews on.
 * For a multi-selection `styles` holds the shared values and `mixed` the
 * tokens that differ, whose fields read "Mixed".
 * Hovering the Padding or Gap row paints that overlay on the canvas selection
 * (`editor.spacingOverlay`).
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
const provenance = (key: string) => styleProvenance(props.styles, key, editor.deviceId, editor.breakpointBase)
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

/** The row whose hover set `editor.spacingOverlay`, so its unmount (no mouseleave then) can clear it. */
let overlayRow: RowId | null = null

/** The canvas overlay of a hovered row: Padding's or Gap's, none for the others. */
function hoverRow(row: RowId, entered: boolean) {
  const overlay = row === 'padding' ? 'padding' : row === 'gap' ? 'gap' : null
  if (!overlay) return
  editor.spacingOverlay = entered ? overlay : null
  overlayRow = entered ? row : null
}

/** Clears the overlay this component's row set, if it is still the one shown. */
function clearRowOverlay() {
  const row = overlayRow
  overlayRow = null
  if (row && editor.spacingOverlay === row) editor.spacingOverlay = null
}

const natural = computed(() => naturalDisplay({ type: props.type, props: {} }))
/** Optional rows added this session, before (or, for Display and the corners, without) a token. */
const added = ref<RowId[]>([])
const sections = computed(() => panelRows(
  { type: props.type, parentType: props.parentType, root: props.root, style: props.styles, natural: natural.value },
  { device: editor.deviceId, base: editor.breakpointBase, added: added.value, mixed: props.mixed }
))

/** A "+" menu pick or an "Add…" slot: the row's default token at the device, one undo step. */
function addRow(row: RowId) {
  added.value = [...added.value, row]
  update(atDevice(rowAdd(row)))
}

/** Reset layout: the Layout tokens set at this breakpoint. */
function resetLayout() {
  const layoutRows = sections.value.find(s => s.section === 'Layout')?.rows.map(r => r.id) ?? []
  added.value = added.value.filter(row => !layoutRows.includes(row))
  update(layoutReset(props.styles, editor.deviceId, editor.breakpointBase))
}

/** Reset override, or an optional row's "−": its keys set at this breakpoint; unset everywhere, it goes back to the menu or "Add…". */
function resetRow(row: RowId) {
  added.value = added.value.filter(other => other !== row)
  const responsive = isResponsiveToken(token(rowKeys(row)[0]!))
  update(rowReset(props.styles, row, responsive ? breakpoint.value : undefined))
}

const shownRows = computed(() => new Map(sections.value.flatMap(s => s.rows).map(row => [row.id, row])))
// A hovered Padding or Gap row that goes (its section collapses, the node changes type) never sees its mouseleave.
watch(shownRows, (rows) => {
  if (overlayRow && !rows.has(overlayRow)) clearRowOverlay()
})
onBeforeUnmount(clearRowOverlay)
/** The base key a row's binding dot binds: rows of one token only. */
const bindKey = (row: RowId) => (rowKeys(row).length === 1 ? rowKeys(row)[0] : undefined)
/** A row's label state, its binding dot, and the "−" of an added optional row ("×" on Fill, Border and Shadows). */
const rowLabel = (row: RowId) => ({
  bind: bindKey(row),
  provenance: rowProvenance(props.styles, row, editor.deviceId, editor.breakpointBase),
  device: editor.device.label,
  removable: !!shownRows.value.get(row)?.removable,
  removeIcon: ADD_ICONS[row] ? 'i-lucide-x' : 'i-lucide-minus',
  onRemove: () => resetRow(row)
})

const LABELS: Record<RowId, string> = {
  width: 'Width', height: 'Height', maxWidth: 'Max W', minWidth: 'Min W', maxHeight: 'Max H', minHeight: 'Min H',
  type: 'Type', direction: 'Direction', distribute: 'Distribute', align: 'Align', wrap: 'Wrap', columns: 'Columns', gap: 'Gap',
  padding: 'Padding', span: 'Span', margin: 'Margin', self: 'Self', overflow: 'Overflow',
  visible: 'Visible', opacity: 'Opacity', fill: 'Fill', border: 'Border', shadows: 'Shadows', radius: 'Radius', corners: 'Corners',
  display: 'Display', fontSize: 'Size', fontWeight: 'Weight', textAlign: 'Align', textColor: 'Color',
  letterSpacing: 'Letter', lineHeight: 'Line', transform: 'Transform'
}
// The "+" menu names, Framer's.
const MENU_LABELS: Partial<Record<RowId, string>> = {
  maxWidth: 'Max Width', minWidth: 'Min Width', maxHeight: 'Max Height', minHeight: 'Min Height',
  padding: 'Padding', margin: 'Margin', self: 'Align self', overflow: 'Overflow',
  display: 'Display', corners: 'Individual corners',
  fontSize: 'Font size', fontWeight: 'Font weight', textAlign: 'Text align', textColor: 'Text color',
  letterSpacing: 'Letter spacing', lineHeight: 'Line height', transform: 'Transform'
}
// The "+" items that need explaining: their second line.
const MENU_HINTS: Partial<Record<RowId, string>> = {
  margin: 'Space outside the edges',
  self: 'Overrides the parent\'s Align for this one',
  overflow: 'Clips or scrolls what doesn\'t fit',
  display: 'Block, flex or grid, past Visible and Type',
  corners: 'A radius per corner',
  fontSize: 'Children inherit it',
  fontWeight: 'Children inherit it',
  textAlign: 'Children inherit it',
  textColor: 'Children inherit it',
  transform: 'Uppercase, lowercase or capitalized'
}
const menuItems = (menu: PanelMenuItem[]) => menu.map(item => ({ id: item.id, label: MENU_LABELS[item.id] ?? LABELS[item.id], hint: MENU_HINTS[item.id] }))
const ADD_ICONS: Partial<Record<RowId, string>> = { fill: 'i-lucide-paint-bucket', border: 'i-lucide-square', shadows: 'i-lucide-copy' }
const SIZE_LIMITS: Partial<Record<RowId, string>> = { maxWidth: 'maxW', minWidth: 'minW', maxHeight: 'maxH', minHeight: 'minH' }

// Size: Fixed / Fit / Fill / Relative over `w` and `h`.
const modeItems = (key: SizeKey) => sizeModes(key).map(mode => ({ value: mode, label: SIZE_MODE_LABELS[mode] }))
const setMode = (key: SizeKey, mode: SizeMode) => setField(key, sizeModeValue(key, mode, current(key)))
const sizeKey = (row: RowId): SizeKey => (row === 'width' ? 'w' : 'h')

// The selection's boxes in the active frame (canvas px), for the greyed auto sizes.
const measured = shallowRef<MeasuredSizes>(EMPTY_SIZES)
const sizes = createSizeMeasurer(ids => editor.measureNodes(ids), (next) => {
  measured.value = next
})
watch([() => editor.selectedIds, () => editor.page, () => editor.deviceId, () => props.styles], () => {
  const ids = [...editor.selectedIds]
  sizes.schedule(ids, sizeContext(ids, editor.deviceId, editor.page?.id))
}, { immediate: true })
onBeforeUnmount(() => sizes.stop())

/** The W or H field: an unset, auto, Fit or Fill size shows its measured px greyed instead of the token ("Mixed" first). */
function sizeField(row: RowId) {
  const key = sizeKey(row)
  const px = isMixed(key) ? undefined : measuredSize(key, current(key), measured.value[key])
  if (px) return { value: undefined, inherited: undefined, placeholder: px }
  return { value: own(key), inherited: inherited(key), placeholder: ph(key, 'auto') }
}

// Layout: Type, Direction, Distribute and Align.
const layout = computed(() => layoutType(props.type, props.styles, editor.deviceId, editor.breakpointBase))
const typeProvenance = computed((): Provenance => {
  const p = provenance('display')
  return p.state !== 'unset' && ['grid', 'flex'].includes(p.value) ? p : { state: 'unset' }
})
const TYPE_ITEMS = [{ value: 'stack', label: 'Stack' }, { value: 'grid', label: 'Grid' }]
const setType = (next: string) => update(layoutTypeWrite(props.type, props.styles, editor.deviceId, next as LayoutType, editor.breakpointBase))

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
const visible = computed(() => !visibilityAt(props.styles, editor.deviceId, editor.breakpointBase).hidden)
const VISIBLE_ITEMS = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]
function setVisible(next: string) {
  if ((next === 'yes') === visible.value) return
  update(visibilityToggle(props.styles, editor.deviceId, layout.value === 'grid' ? 'grid' : natural.value, editor.frames, editor.breakpointBase))
}

// Border width: all sides, or per side (Framer's split toggle); the radius corners are a "+" row.
const splitBorder = ref(splitMode(props.styles, 'border') === 'split')
watch(() => splitMode(props.styles, 'border'), (mode) => {
  splitBorder.value ||= mode === 'split'
})
/** Leaving split mode writes the first side as the all-sides value. */
function setSplitBorder(next: boolean) {
  splitBorder.value = next
  if (!next) update(joinSplit(props.styles, 'border'))
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
const TRACKING_LABELS: Record<string, string> = { tighter: 'Tighter', tight: 'Tight', normal: 'Normal', wide: 'Wide', wider: 'Wider', widest: 'Widest' }
const LEADING_LABELS: Record<string, string> = { none: 'None', tight: 'Tight', snug: 'Snug', normal: 'Normal', relaxed: 'Relaxed', loose: 'Loose' }
const TRANSFORM_LABELS: Record<string, string> = { 'uppercase': 'Uppercase', 'lowercase': 'Lowercase', 'capitalize': 'Capitalize', 'normal-case': 'None' }
const TRANSFORM_ICONS: Record<string, string> = { 'uppercase': 'i-lucide-case-upper', 'lowercase': 'i-lucide-case-lower', 'capitalize': 'i-lucide-case-sensitive', 'normal-case': 'i-lucide-minus' }

// Rows edited with a select: their option labels, the unset placeholder, and options shown in their own style.
const SELECT_ROWS: Partial<Record<RowId, { labels: Record<string, string>, unset: string, styled?: boolean }>> = {
  shadows: { labels: SHADOW_LABELS, unset: 'None' },
  overflow: { labels: OVERFLOW_LABELS, unset: 'Visible' },
  fontWeight: { labels: {}, unset: 'normal', styled: true },
  letterSpacing: { labels: TRACKING_LABELS, unset: 'Normal', styled: true },
  lineHeight: { labels: LEADING_LABELS, unset: 'Normal' }
}

// A select in a field shell.
const SELECT = 'h-full min-w-0 flex-1 ps-2.5 text-[12px]'
</script>

<template>
  <div :data-editing-breakpoint="editor.device.breakpoint ?? 'base'">
    <EditorStyleSection
      v-for="{ section, rows, menu, reset, collapsed } in sections"
      :key="section"
      :label="section"
      :collapsed="collapsed"
      :menu="menuItems(menu)"
      :remove-label="reset ? 'Reset layout' : undefined"
      @add="addRow($event as RowId)"
      @remove="resetLayout"
    >
      <template
        v-for="row in rows"
        :key="row.id"
      >
        <EditorAddRow
          v-if="row.slot"
          :label="LABELS[row.id]"
          :icon="ADD_ICONS[row.id] ?? 'i-lucide-plus'"
          :name="row.id"
          @add="addRow(row.id)"
        />

        <EditorScaleRow
          v-else-if="row.id === 'width' || row.id === 'height'"
          v-bind="{ ...rowLabel(row.id), ...sizeField(row.id) }"
          :label="LABELS[row.id]"
          :token="token(sizeKey(row.id))"
          :data-style-row="sizeKey(row.id)"
          @preview="preview(sizeKey(row.id), $event)"
          @commit="setField(sizeKey(row.id), $event)"
          @reset="resetRow(row.id)"
        >
          <template #after>
            <EditorField class="w-[100px] shrink-0">
              <USelect
                :model-value="sizeMode(row.id === 'width' ? 'w' : 'h', current(row.id === 'width' ? 'w' : 'h'))"
                :items="modeItems(row.id === 'width' ? 'w' : 'h')"
                placeholder="Auto"
                variant="none"
                size="sm"
                :class="SELECT"
                :ui="SELECT_BARE_UI"
                :aria-label="`${LABELS[row.id]} mode`"
                :data-size-mode="row.id === 'width' ? 'w' : 'h'"
                @update:model-value="setMode(row.id === 'width' ? 'w' : 'h', $event as SizeMode)"
              />
            </EditorField>
          </template>
        </EditorScaleRow>

        <EditorScaleRow
          v-else-if="SIZE_LIMITS[row.id]"
          v-bind="rowLabel(row.id)"
          :label="LABELS[row.id]"
          :token="token(SIZE_LIMITS[row.id]!)"
          :value="own(SIZE_LIMITS[row.id]!)"
          :inherited="inherited(SIZE_LIMITS[row.id]!)"
          :placeholder="ph(SIZE_LIMITS[row.id]!, row.id.startsWith('min') ? 'auto' : 'none')"
          :data-style-row="SIZE_LIMITS[row.id]"
          @preview="preview(SIZE_LIMITS[row.id]!, $event)"
          @commit="setField(SIZE_LIMITS[row.id]!, $event)"
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
              :ui="SELECT_BARE_UI"
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
          @mouseenter="hoverRow(row.id, true)"
          @mouseleave="hoverRow(row.id, false)"
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
          @mouseenter="hoverRow(row.id, true)"
          @mouseleave="hoverRow(row.id, false)"
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
          :data-border-mode="splitBorder ? 'sides' : 'all'"
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
                :model-value="splitBorder"
                name="sides"
                @update:model-value="setSplitBorder"
              />
            </div>
            <EditorJoinedFields
              v-if="splitBorder"
              class="mt-2"
              :cells="splitCells('border')"
              data-style-row="border-sides"
              @preview="preview"
              @commit="setField"
            />
          </template>
        </EditorRow>

        <EditorRow
          v-else-if="SELECT_ROWS[row.id]"
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
              :items="segments(rowKeys(row.id)[0]!, SELECT_ROWS[row.id]!.labels)"
              :placeholder="ph(rowKeys(row.id)[0]!, inherited(rowKeys(row.id)[0]!) ?? SELECT_ROWS[row.id]!.unset)"
              variant="none"
              size="sm"
              :class="SELECT"
              :ui="SELECT_BARE_UI"
              :aria-label="token(rowKeys(row.id)[0]!).label"
              :data-style-key="rowKeys(row.id)[0]"
              :content="optionPreview(rowKeys(row.id)[0]!)"
              @update:model-value="setField(rowKeys(row.id)[0]!, $event)"
              @update:open="!$event && preview(rowKeys(row.id)[0]!, null)"
            >
              <template #item-label="{ item: option }">
                <span
                  :class="SELECT_ROWS[row.id]!.styled ? styleClasses({ [rowKeys(row.id)[0]!]: option.value }) : undefined"
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
          @preview="preview('rounded', $event)"
          @commit="setField('rounded', $event)"
          @reset="resetRow(row.id)"
        />

        <EditorRow
          v-else-if="row.id === 'corners'"
          v-bind="rowLabel(row.id)"
          :label="LABELS.corners"
          title="Individual corners"
          name="corners"
          data-style-row="corners"
          @reset="resetRow(row.id)"
        >
          <EditorJoinedFields
            class="flex-1"
            :cells="splitCells('rounded')"
            @preview="preview"
            @commit="setField"
          />
        </EditorRow>

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

        <EditorRow
          v-else-if="row.id === 'transform'"
          v-bind="rowLabel(row.id)"
          :label="LABELS.transform"
          :title="token('textTransform').label"
          name="textTransform"
          data-style-row="textTransform"
          @reset="resetRow(row.id)"
        >
          <EditorSegmented
            dense
            tooltips
            :items="segments('textTransform', TRANSFORM_LABELS, TRANSFORM_ICONS)"
            :model-value="own('textTransform')"
            :inherited="inherited('textTransform')"
            :aria-label="token('textTransform').label"
            data-style-key="textTransform"
            @update:model-value="setField('textTransform', $event)"
          />
        </EditorRow>
      </template>
    </EditorStyleSection>
  </div>
</template>
