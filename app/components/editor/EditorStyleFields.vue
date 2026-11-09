<script setup lang="ts">
import { getStyleToken, isResponsiveToken, styleClasses, styleKey } from '#shared/design/tokens'
import type { StyleToken } from '#shared/design/tokens'
import { structuralStyle } from '#shared/document/components'
import { naturalDisplay } from '#shared/editor/layers'
import type { PanelSection } from '#shared/editor/panel'
import { PANEL_SECTIONS, paddingMode, panelFields, panelSectionMark, sectionAdd, sectionKeys, sectionPresent, sectionRemove, spacingProvenance } from '#shared/editor/panel'
import { previewFocusedOption } from '#shared/editor/preview'
import type { Side } from '#shared/editor/spacing'
import { spacingSide, spacingWrite } from '#shared/editor/spacing'
import { styleProvenance } from '#shared/editor/styleFields'

/**
 * Design-token controls for a node's style, in Figma UI3's sections: compact
 * fields with a letter or icon in front (drag it to scrub the token scale),
 * auto layout with direction, alignment, gap and padding, and Fill, Stroke and
 * Effects that a "+" adds and a "−" removes. Colour tokens show as variable
 * chips. Responsive tokens edit the editor device's breakpoint (Mobile is the
 * base, Tablet `md:`, Desktop `lg:`); a field's prefix, or the dot beside a
 * row, is blue when the device sets the value and orange when it inherits.
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
// A padding field reads the all-sides and axis tokens too.
const PADDING_KEYS: Record<string, string[]> = { px: ['p', 'px'], py: ['p', 'py'], pl: ['p', 'px', 'pl'], pr: ['p', 'px', 'pr'], pt: ['p', 'py', 'pt'], pb: ['p', 'py', 'pb'] }
const isMixed = (key: string) => (PADDING_KEYS[key] ?? [key]).some(k => props.mixed?.includes(k))
/** A field's placeholder: "Mixed" when the selected nodes differ, else `fallback`. */
const ph = (key: string, fallback?: string) => (isMixed(key) ? 'Mixed' : fallback)

/** The key a token is written to on the current device. */
const keyAt = (key: string) => (isResponsiveToken(token(key)) ? styleKey(key, editor.device.breakpoint) : key)

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
const commitTokens = (patch: Record<string, string>) => emit('update', atDevice(patch))
const previewTokens = (patch: Record<string, string> | null) => emit('preview', patch && atDevice(patch))

/** Select content that previews the option under the pointer or keyboard focus (items carry `data-option-value`). */
const optionPreview = (key: string) => previewFocusedOption(value => preview(key, value))

const fields = computed(() => panelFields({ type: props.type, parentType: props.parentType, root: props.root, style: props.styles }))
const direction = computed(() => own('direction') ?? inherited('direction') ?? structuralStyle(props.type).direction ?? 'col')

// The letter or icon in front of each field, as in Figma.
const PREFIX: Record<string, { label?: string, icon?: string }> = {
  w: { label: 'W' },
  minH: { label: 'H' },
  maxW: { label: 'Max' },
  cols: { icon: 'i-lucide-columns-3' },
  colSpan: { icon: 'i-lucide-move-horizontal' },
  px: { icon: 'i-lucide-unfold-horizontal' },
  py: { icon: 'i-lucide-unfold-vertical' },
  pt: { icon: 'i-lucide-panel-top' },
  pr: { icon: 'i-lucide-panel-right' },
  pb: { icon: 'i-lucide-panel-bottom' },
  pl: { icon: 'i-lucide-panel-left' },
  text: { icon: 'i-lucide-a-large-small' },
  font: { icon: 'i-lucide-bold' },
  rounded: { icon: 'i-lucide-radius' },
  border: { icon: 'i-lucide-menu' }
}
const gapIcon = computed(() => (direction.value.startsWith('row') ? 'i-lucide-align-horizontal-space-between' : 'i-lucide-align-vertical-space-between'))

/** The provenance label of a token, as a prefix (or a row dot with `variant`). */
const label = (key: string, variant: 'prefix' | 'dot' = 'prefix') => ({
  variant,
  label: PREFIX[key]?.label ?? token(key).label,
  icon: key === 'gap' ? gapIcon.value : PREFIX[key]?.icon,
  title: token(key).label,
  provenance: provenance(key),
  device: editor.device.label
})

// Padding: horizontal and vertical, or per side once a side is set ("individual padding").
const breakpoint = computed(() => editor.device.breakpoint)
const mode = computed(() => paddingMode(props.styles, breakpoint.value))
const individual = ref(mode.value === 'sides')
watch(mode, (value) => {
  individual.value = value === 'sides'
})
const paddingFields = computed((): { key: string, side: Side }[] => individual.value
  ? [{ key: 'pl', side: 'left' }, { key: 'pt', side: 'top' }, { key: 'pr', side: 'right' }, { key: 'pb', side: 'bottom' }]
  : [{ key: 'px', side: 'left' }, { key: 'py', side: 'top' }])
const paddingProvenance = (side: Side) => spacingProvenance(props.styles, 'p', side, breakpoint.value)
const paddingValue = (side: Side, state: 'set' | 'inherited') => {
  const p = paddingProvenance(side)
  return p.state === state ? p.value : undefined
}
const paddingWrite = (side: Side, value: string) => spacingWrite(props.styles, 'p', side, individual.value ? 'side' : 'axis', breakpoint.value, value)
const paddingLabel = (key: string, side: Side) => ({ ...label(key), provenance: paddingProvenance(side) })
function paddingReset(side: Side) {
  const p = paddingProvenance(side)
  if (p.state === 'set') emit('update', { [p.key]: null })
}

/** Leaving individual padding writes the left and top values as horizontal and vertical padding. */
function toggleIndividual() {
  const next = !individual.value
  individual.value = next
  if (next) return
  const patch: Record<string, string | null> = {}
  for (const side of ['left', 'top'] as const) {
    const resolved = spacingSide(props.styles, 'p', side, breakpoint.value)
    if (resolved?.state === 'set') Object.assign(patch, spacingWrite(props.styles, 'p', side, 'axis', breakpoint.value, resolved.value))
  }
  if (Object.keys(patch).length) emit('update', patch)
}

// Center horizontally: margin-x auto, or back to none when the node is centred here.
const centered = computed(() => ['left', 'right'].every(side => spacingSide(props.styles, 'm', side as 'left' | 'right', breakpoint.value)?.value === 'auto'))
function toggleCenter() {
  const bp = breakpoint.value
  if (!centered.value) return emit('update', spacingWrite(props.styles, 'm', 'left', 'axis', bp, 'auto'))
  const patch = Object.fromEntries(['mx', 'ml', 'mr', 'm'].map(base => styleKey(base, bp)).filter(key => props.styles[key] === 'auto').map(key => [key, null]))
  if (Object.keys(patch).length) emit('update', patch)
}

// Collapsed sections, per section, across nodes and reloads; the margins box starts closed.
const COLLAPSED_KEY = 'bildr:panel-collapsed'
function readCollapsed(): Partial<Record<PanelSection, boolean>> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{ "Spacing": true }')
  } catch {
    return {}
  }
}
const collapsed = ref(readCollapsed())
watch(collapsed, value => localStorage.setItem(COLLAPSED_KEY, JSON.stringify(value)), { deep: true })

/** Shift-click applies the header's next state to every section. */
function toggle(section: PanelSection, event: MouseEvent) {
  const next = !collapsed.value[section]
  const targets = event.shiftKey ? PANEL_SECTIONS : [section]
  collapsed.value = { ...collapsed.value, ...Object.fromEntries(targets.map(s => [s, next])) }
}

// Fill, Stroke and Effects: "+" in the header adds a default, "−" on the row removes it.
const ADDABLE: PanelSection[] = ['Fill', 'Stroke', 'Effects']
const present = (section: PanelSection) => !ADDABLE.includes(section) || sectionPresent(props.styles, section, editor.deviceId)
  || sectionKeys(section).some(key => props.mixed?.includes(key))
function add(section: PanelSection) {
  const patch = sectionAdd(section)
  if (!patch) return
  collapsed.value = { ...collapsed.value, [section]: false }
  emit('update', patch)
}
function remove(section: PanelSection) {
  const patch = sectionRemove(props.styles, section)
  if (Object.keys(patch).length) emit('update', patch)
}

const segments = (key: string, icons: Record<string, string> = {}, labels: Record<string, string> = {}) =>
  token(key).values.map(value => ({ value, label: labels[value] ?? value, icon: icons[value] }))
const options = (t: StyleToken) => t.values.map(value => ({ value, label: value }))

const ALIGN_ICONS: Record<string, string> = {
  left: 'i-lucide-align-left',
  center: 'i-lucide-align-center',
  right: 'i-lucide-align-right',
  justify: 'i-lucide-align-justify'
}
const ALIGN_LABELS: Record<string, string> = { left: 'Left', center: 'Center', right: 'Right', justify: 'Justify' }
const SELF_ICONS: Record<string, string> = {
  start: 'i-lucide-align-start-vertical',
  center: 'i-lucide-align-center-vertical',
  end: 'i-lucide-align-end-vertical',
  stretch: 'i-lucide-stretch-vertical'
}
const SELF_LABELS: Record<string, string> = { auto: 'Auto', start: 'Start', center: 'Center', end: 'End', stretch: 'Stretch' }
const DISPLAY_LABELS: Record<string, string> = { hidden: 'Hidden', block: 'Block', flex: 'Flex', grid: 'Grid' }

// A select in a field shell, and the dot column in the section's left padding.
const SELECT = 'h-full min-w-0 flex-1 ps-0 text-[11px]'
const SELECT_UI = { trailingIcon: 'size-3 text-dimmed', placeholder: 'text-toned' }
const DOT = 'absolute inset-y-0 -left-3 flex w-3 items-center justify-center'
const REMOVE = 'grid size-6 shrink-0 place-items-center rounded-[5px] text-muted hover:bg-white/8 hover:text-highlighted'
</script>

<template>
  <div :data-editing-breakpoint="editor.device.breakpoint ?? 'base'">
    <EditorStyleSection
      v-for="section in fields.sections"
      :key="section"
      :label="section"
      :open="!collapsed[section]"
      :mark="panelSectionMark(styles, section, editor.deviceId)"
      :empty="!present(section)"
      @toggle="toggle(section, $event)"
    >
      <template #actions>
        <UTooltip
          v-if="section === 'Layout'"
          text="Center horizontally"
          :delay-duration="500"
        >
          <UButton
            icon="i-lucide-align-horizontal-justify-center"
            color="neutral"
            :variant="centered ? 'soft' : 'ghost'"
            size="xs"
            aria-label="Center horizontally"
            :aria-pressed="centered"
            @click="toggleCenter"
          />
        </UTooltip>
        <UTooltip
          v-else-if="ADDABLE.includes(section) && !present(section)"
          :text="`Add ${section.toLowerCase()}`"
          :delay-duration="500"
        >
          <UButton
            icon="i-lucide-plus"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="`Add ${section.toLowerCase()}`"
            :data-section-add="section"
            @click="add(section)"
          />
        </UTooltip>
      </template>

      <template v-if="section === 'Auto layout'">
        <div
          v-if="fields.direction"
          class="relative"
          data-style-row="direction"
        >
          <div
            :class="DOT"
            data-field-label="direction"
          >
            <EditorFieldLabel
              v-bind="label('direction', 'dot')"
              @reset="setField('direction', null)"
            />
          </div>
          <EditorDirection
            :value="own('direction')"
            :inherited="inherited('direction')"
            :fallback="structuralStyle(type).direction"
            @preview="preview('direction', $event)"
            @commit="setField('direction', $event)"
          />
        </div>
        <EditorAlignGrid
          v-if="fields.align"
          :items="provenance('items')"
          :justify="provenance('justify')"
          :direction="direction"
          :device="editor.device.label"
          data-style-row="alignment"
          @preview="previewTokens"
          @commit="commitTokens"
          @reset="setField($event, null)"
        />
        <div
          v-if="fields.gap || fields.cols || fields.colSpan"
          class="grid grid-cols-2 gap-2"
        >
          <EditorScaleField
            v-for="key in (['gap', 'cols', 'colSpan'] as const).filter(k => fields[k])"
            :key="key"
            :token="token(key)"
            :value="own(key)"
            :inherited="inherited(key)"
            :placeholder="ph(key, key === 'gap' ? '0' : undefined)"
            :stepper="key === 'cols'"
            :data-style-row="key"
            @preview="preview(key, $event)"
            @commit="setField(key, $event)"
          >
            <template #prefix>
              <EditorFieldLabel
                v-bind="label(key)"
                @reset="setField(key, null)"
              />
            </template>
          </EditorScaleField>
        </div>
        <div
          class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_24px] gap-x-2 gap-y-1.5"
          data-style-row="padding"
          :data-padding-mode="individual ? 'sides' : 'axes'"
        >
          <template
            v-for="({ key, side }, i) in paddingFields"
            :key="key"
          >
            <EditorScaleField
              :token="token(key)"
              :value="paddingValue(side, 'set')"
              :inherited="paddingValue(side, 'inherited')"
              :placeholder="ph(key, '0')"
              :data-style-row="key"
              @preview="emit('preview', $event === null ? null : paddingWrite(side, $event))"
              @commit="emit('update', paddingWrite(side, $event))"
            >
              <template #prefix>
                <EditorFieldLabel
                  v-bind="paddingLabel(key, side)"
                  @reset="paddingReset(side)"
                />
              </template>
            </EditorScaleField>
            <UTooltip
              v-if="i === 1"
              text="Individual padding"
              :delay-duration="500"
            >
              <button
                type="button"
                class="grid size-6 place-items-center rounded-[5px]"
                :class="individual ? 'bg-white/14 text-highlighted' : 'text-muted hover:bg-white/8 hover:text-highlighted'"
                aria-label="Individual padding"
                :aria-pressed="individual"
                @click="toggleIndividual"
              >
                <UIcon
                  name="i-lucide-square-dashed"
                  class="size-3"
                />
              </button>
            </UTooltip>
          </template>
        </div>
      </template>

      <template v-else-if="section === 'Layout'">
        <div class="grid grid-cols-2 gap-2">
          <EditorScaleField
            v-for="key in ['w', 'minH', 'maxW']"
            :key="key"
            :token="token(key)"
            :value="own(key)"
            :inherited="inherited(key)"
            :placeholder="ph(key, 'auto')"
            :data-style-row="key"
            @preview="preview(key, $event)"
            @commit="setField(key, $event)"
          >
            <template #prefix>
              <EditorFieldLabel
                v-bind="label(key)"
                @reset="setField(key, null)"
              />
            </template>
          </EditorScaleField>
        </div>
        <div
          v-if="fields.self"
          class="relative"
          data-style-row="self"
        >
          <div
            :class="DOT"
            data-field-label="self"
          >
            <EditorFieldLabel
              v-bind="label('self', 'dot')"
              @reset="setField('self', null)"
            />
          </div>
          <EditorSegmented
            tooltips
            dense
            :items="segments('self', SELF_ICONS, SELF_LABELS)"
            :model-value="own('self')"
            :inherited="inherited('self')"
            aria-label="Align self"
            data-style-key="self"
            @update:model-value="setField('self', $event)"
          />
        </div>
        <div
          v-if="fields.display"
          class="relative"
          data-style-row="display"
        >
          <div
            :class="DOT"
            data-field-label="display"
          >
            <EditorFieldLabel
              v-bind="label('display', 'dot')"
              @reset="setField('display', null)"
            />
          </div>
          <EditorSegmented
            dense
            :items="segments('display', {}, DISPLAY_LABELS)"
            :model-value="own('display')"
            :inherited="inherited('display')"
            :fallback="naturalDisplay({ type, props: {} })"
            aria-label="Display"
            data-style-key="display"
            @update:model-value="setField('display', $event)"
          />
        </div>
      </template>

      <EditorSpacingBox
        v-else-if="section === 'Spacing'"
        :styles="styles"
        :breakpoint="editor.device.breakpoint"
        @preview="emit('preview', $event)"
        @commit="emit('update', $event)"
      />

      <div
        v-else-if="section === 'Appearance'"
        class="grid grid-cols-2 gap-2"
      >
        <EditorScaleField
          :token="token('rounded')"
          :value="own('rounded')"
          :inherited="inherited('rounded')"
          :placeholder="ph('rounded', 'none')"
          data-style-row="rounded"
          @preview="preview('rounded', $event)"
          @commit="setField('rounded', $event)"
        >
          <template #prefix>
            <EditorFieldLabel
              v-bind="label('rounded')"
              @reset="setField('rounded', null)"
            />
          </template>
        </EditorScaleField>
      </div>

      <template v-else-if="section === 'Typography'">
        <div class="grid grid-cols-2 gap-2">
          <EditorScaleField
            :token="token('text')"
            :value="own('text')"
            :inherited="inherited('text')"
            :placeholder="ph('text', 'base')"
            data-style-row="text"
            @preview="preview('text', $event)"
            @commit="setField('text', $event)"
          >
            <template #prefix>
              <EditorFieldLabel
                v-bind="label('text')"
                @reset="setField('text', null)"
              />
            </template>
          </EditorScaleField>
          <EditorField data-style-row="font">
            <template #prefix>
              <EditorFieldLabel
                v-bind="label('font')"
                @reset="setField('font', null)"
              />
            </template>
            <USelect
              :model-value="own('font')"
              :items="options(token('font'))"
              :placeholder="ph('font', inherited('font') ?? 'normal')"
              variant="none"
              size="xs"
              :class="SELECT"
              :ui="SELECT_UI"
              :aria-label="token('font').label"
              data-style-key="font"
              :content="optionPreview('font')"
              @update:model-value="setField('font', $event)"
              @update:open="!$event && preview('font', null)"
            >
              <template #item-label="{ item: option }">
                <span
                  :class="styleClasses({ font: option.value })"
                  :data-option-value="option.value"
                >{{ option.label }}</span>
              </template>
            </USelect>
          </EditorField>
        </div>
        <div
          class="relative"
          data-style-row="align"
        >
          <div
            :class="DOT"
            data-field-label="align"
          >
            <EditorFieldLabel
              v-bind="label('align', 'dot')"
              @reset="setField('align', null)"
            />
          </div>
          <EditorSegmented
            tooltips
            dense
            :items="segments('align', ALIGN_ICONS, ALIGN_LABELS)"
            :model-value="own('align')"
            :inherited="inherited('align')"
            aria-label="Text align"
            data-style-key="align"
            @update:model-value="setField('align', $event)"
          />
        </div>
        <EditorSwatchPicker
          v-if="editor.theme"
          icon="i-lucide-baseline"
          :token="token('color')"
          :value="own('color')"
          :placeholder="ph('color')"
          :theme="editor.theme"
          data-style-row="color"
          @preview="preview('color', $event)"
          @update="setField('color', $event)"
          @clear="setField('color', null)"
        />
      </template>

      <div
        v-else-if="section === 'Fill'"
        class="flex items-center gap-1"
        data-style-row="bg"
      >
        <EditorSwatchPicker
          v-if="editor.theme"
          class="flex-1"
          :token="token('bg')"
          :value="own('bg')"
          :placeholder="ph('bg')"
          :theme="editor.theme"
          @preview="preview('bg', $event)"
          @update="setField('bg', $event)"
          @clear="setField('bg', null)"
        />
        <button
          type="button"
          :class="REMOVE"
          aria-label="Remove fill"
          @click="remove('Fill')"
        >
          <UIcon
            name="i-lucide-minus"
            class="size-3"
          />
        </button>
      </div>

      <div
        v-else-if="section === 'Stroke'"
        class="flex items-center gap-1"
        data-style-row="stroke"
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
        <EditorScaleField
          class="w-16 shrink-0"
          :token="token('border')"
          :value="own('border')"
          :placeholder="ph('border', '0')"
          data-style-row="border"
          @preview="preview('border', $event)"
          @commit="setField('border', $event)"
        >
          <template #prefix>
            <EditorFieldLabel
              v-bind="label('border')"
              @reset="setField('border', null)"
            />
          </template>
        </EditorScaleField>
        <button
          type="button"
          :class="REMOVE"
          aria-label="Remove stroke"
          @click="remove('Stroke')"
        >
          <UIcon
            name="i-lucide-minus"
            class="size-3"
          />
        </button>
      </div>

      <div
        v-else-if="section === 'Effects'"
        class="flex items-center gap-1"
        data-style-row="shadow"
      >
        <EditorField class="flex-1">
          <template #prefix>
            <span class="grid w-6 place-items-center">
              <span class="block size-2.5 rounded-[2px] border border-current text-muted shadow-[1px_1px_0_currentColor]" />
            </span>
          </template>
          <USelect
            :model-value="own('shadow')"
            :items="options(token('shadow'))"
            :placeholder="ph('shadow', 'none')"
            variant="none"
            size="xs"
            :class="SELECT"
            :ui="SELECT_UI"
            :aria-label="token('shadow').label"
            data-style-key="shadow"
            :content="optionPreview('shadow')"
            @update:model-value="setField('shadow', $event)"
            @update:open="!$event && preview('shadow', null)"
          >
            <template #default="{ modelValue }">
              <span class="truncate">Drop shadow <span class="text-dimmed">{{ modelValue }}</span></span>
            </template>
            <template #item-label="{ item: option }">
              <span :data-option-value="option.value">{{ option.label }}</span>
            </template>
            <template #item-leading="{ item: option }">
              <span class="grid size-5 place-items-center rounded-[3px] bg-neutral-300">
                <span
                  class="block size-3 rounded-[2px] bg-white"
                  :class="styleClasses({ shadow: option.value })"
                />
              </span>
            </template>
          </USelect>
        </EditorField>
        <button
          type="button"
          :class="REMOVE"
          aria-label="Remove effects"
          @click="remove('Effects')"
        >
          <UIcon
            name="i-lucide-minus"
            class="size-3"
          />
        </button>
      </div>
    </EditorStyleSection>
  </div>
</template>
