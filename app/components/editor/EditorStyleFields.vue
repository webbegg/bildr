<script setup lang="ts">
import { getStyleToken, isResponsiveToken, parseStyleKey, styleClasses, styleKey } from '#shared/design/tokens'
import type { StyleToken } from '#shared/design/tokens'
import { isContainerType, isFlexType, structuralStyle } from '#shared/document/components'
import { previewFocusedOption } from '#shared/editor/preview'
import { spacingSide, spacingWrite } from '#shared/editor/spacing'
import type { Provenance, StyleSection } from '#shared/editor/styleFields'
import { fieldLabel, sectionMark, STYLE_SECTIONS, styleProvenance } from '#shared/editor/styleFields'

/**
 * Design-token controls for a node's style, in Stacki's collapsible sections:
 * scale fields to scrub and step, the spacing box, direction and alignment for
 * flex containers, swatches from the project theme, and segments or selects
 * with previews for the rest. Responsive tokens edit the editor device's
 * breakpoint (Mobile is the base, Tablet `md:`, Desktop `lg:`); each row's
 * label shows whether the device sets the value or inherits it.
 *
 * Controls `preview` what a gesture holds and `commit` once; this panel emits
 * the commit as one `update` (one undo step) and passes previews on.
 */
const props = defineProps<{
  styles: Record<string, string>
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
/** The key a token is written to on the current device. */
const keyAt = (key: string) => (isResponsiveToken(token(key)) ? styleKey(key, editor.device.breakpoint) : key)
const label = (key: string) => ({ label: fieldLabel(token(key)), title: token(key).label, provenance: provenance(key), device: editor.device.label })

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

// Controls show for the node types they apply to, and for any node that sets their tokens.
const sets = (...keys: string[]) => Object.keys(props.styles).some(key => keys.includes(parseStyleKey(key)?.token.key ?? ''))
const show = computed(() => {
  const flex = isFlexType(props.type)
  return {
    direction: flex || sets('direction'),
    align: flex || sets('items', 'justify'),
    gap: isContainerType(props.type) || sets('gap'),
    cols: ['Grid', 'List'].includes(props.type) || sets('cols'),
    self: !props.root || sets('self'),
    colSpan: ['Grid', 'List'].includes(props.parentType ?? '') || sets('colSpan')
  }
})
const direction = computed(() => own('direction') ?? inherited('direction') ?? structuralStyle(props.type).direction ?? 'col')

/** The Align label stands for both axes: set if either is set here, and its reset clears both. */
const alignProvenance = computed((): Provenance => {
  const both = [provenance('items'), provenance('justify')]
  const set = both.filter(p => p.state === 'set')
  if (set.length) return { state: 'set', key: 'items', value: set.map(p => p.value).join(' / ') }
  const from = both.find(p => p.state === 'inherited')
  return from ?? { state: 'unset' }
})
function resetAlign() {
  const patch = Object.fromEntries(['items', 'justify'].flatMap((key) => {
    const p = provenance(key)
    return p.state === 'set' ? [[p.key, null]] : []
  }))
  if (Object.keys(patch).length) emit('update', patch)
}

// Center horizontally: margin-x auto, or back to none when the node is centred here.
const centered = computed(() => ['left', 'right'].every(side => spacingSide(props.styles, 'm', side as 'left' | 'right', editor.device.breakpoint)?.value === 'auto'))
function toggleCenter() {
  const bp = editor.device.breakpoint
  if (!centered.value) return emit('update', spacingWrite(props.styles, 'm', 'left', 'axis', bp, 'auto'))
  const patch = Object.fromEntries(['mx', 'ml', 'mr', 'm'].map(base => styleKey(base, bp)).filter(key => props.styles[key] === 'auto').map(key => [key, null]))
  if (Object.keys(patch).length) emit('update', patch)
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
// A corner glyph per radius, at the glyph's own small scale.
const RADIUS_PX: Record<string, string> = { 'none': '0', 'sm': '1.5px', 'md': '2.5px', 'lg': '3.5px', 'xl': '5px', '2xl': '6.5px', '3xl': '8px', 'full': '12px' }

const ROW = 'grid min-h-7 grid-cols-[64px_minmax(0,1fr)] items-center gap-2'
const SELECT_UI = { trailingIcon: 'size-3 text-dimmed' }
</script>

<template>
  <div :data-editing-breakpoint="editor.device.breakpoint ?? 'base'">
    <EditorStyleSection
      v-for="section in STYLE_SECTIONS"
      :key="section"
      :label="section"
      :open="!collapsed[section]"
      :mark="sectionMark(styles, section, editor.deviceId)"
      @toggle="toggle(section, $event)"
    >
      <template
        v-if="section === 'Spacing'"
        #actions
      >
        <UTooltip
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
      </template>

      <template v-if="section === 'Layout'">
        <div
          v-if="show.direction"
          :class="ROW"
          data-style-row="direction"
        >
          <div
            class="flex min-w-0"
            data-field-label="direction"
          >
            <EditorFieldLabel
              v-bind="label('direction')"
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
        <div
          v-if="show.align"
          class="grid grid-cols-[64px_minmax(0,1fr)] gap-2"
          data-style-row="alignment"
        >
          <div class="flex h-7 min-w-0 items-center">
            <EditorFieldLabel
              label="Align"
              title="Align items and justify content"
              :provenance="alignProvenance"
              :device="editor.device.label"
              @reset="resetAlign"
            />
          </div>
          <EditorAlignGrid
            :items="provenance('items')"
            :justify="provenance('justify')"
            :direction="direction"
            :device="editor.device.label"
            @preview="previewTokens"
            @commit="commitTokens"
            @reset="setField($event, null)"
          />
        </div>
        <div
          v-if="show.gap"
          :class="ROW"
          data-style-row="gap"
        >
          <EditorScaleField
            :token="token('gap')"
            :value="own('gap')"
            :inherited="inherited('gap')"
            placeholder="0"
            @preview="preview('gap', $event)"
            @commit="setField('gap', $event)"
          >
            <template #label>
              <EditorFieldLabel
                v-bind="label('gap')"
                @reset="setField('gap', null)"
              />
            </template>
          </EditorScaleField>
        </div>
        <div
          v-if="show.cols"
          :class="ROW"
          data-style-row="cols"
        >
          <EditorScaleField
            :token="token('cols')"
            :value="own('cols')"
            :inherited="inherited('cols')"
            stepper
            @preview="preview('cols', $event)"
            @commit="setField('cols', $event)"
          >
            <template #label>
              <EditorFieldLabel
                v-bind="label('cols')"
                @reset="setField('cols', null)"
              />
            </template>
          </EditorScaleField>
        </div>
        <div
          v-if="show.self"
          :class="ROW"
          data-style-row="self"
        >
          <div
            class="flex min-w-0"
            data-field-label="self"
          >
            <EditorFieldLabel
              v-bind="label('self')"
              @reset="setField('self', null)"
            />
          </div>
          <EditorSegmented
            tooltips
            :items="segments('self', SELF_ICONS, SELF_LABELS)"
            :model-value="own('self')"
            :inherited="inherited('self')"
            aria-label="Align self"
            data-style-key="self"
            @update:model-value="setField('self', $event)"
          />
        </div>
        <div
          v-if="show.colSpan"
          :class="ROW"
          data-style-row="colSpan"
        >
          <EditorScaleField
            :token="token('colSpan')"
            :value="own('colSpan')"
            :inherited="inherited('colSpan')"
            @preview="preview('colSpan', $event)"
            @commit="setField('colSpan', $event)"
          >
            <template #label>
              <EditorFieldLabel
                v-bind="label('colSpan')"
                @reset="setField('colSpan', null)"
              />
            </template>
          </EditorScaleField>
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
        v-else-if="section === 'Size'"
        class="grid grid-cols-[44px_minmax(0,1fr)_44px_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5"
      >
        <EditorScaleField
          v-for="key in ['w', 'maxW', 'minH']"
          :key="key"
          :token="token(key)"
          :value="own(key)"
          :inherited="inherited(key)"
          placeholder="auto"
          :data-style-row="key"
          @preview="preview(key, $event)"
          @commit="setField(key, $event)"
        >
          <template #label>
            <EditorFieldLabel
              v-bind="label(key)"
              @reset="setField(key, null)"
            />
          </template>
        </EditorScaleField>
      </div>

      <template v-else-if="section === 'Typography'">
        <div
          :class="ROW"
          data-style-row="text"
        >
          <EditorScaleField
            :token="token('text')"
            :value="own('text')"
            :inherited="inherited('text')"
            placeholder="base"
            @preview="preview('text', $event)"
            @commit="setField('text', $event)"
          >
            <template #label>
              <EditorFieldLabel
                v-bind="label('text')"
                @reset="setField('text', null)"
              />
            </template>
          </EditorScaleField>
        </div>
        <div
          :class="ROW"
          data-style-row="font"
        >
          <div
            class="flex min-w-0"
            data-field-label="font"
          >
            <EditorFieldLabel
              v-bind="label('font')"
              @reset="setField('font', null)"
            />
          </div>
          <USelect
            :model-value="own('font')"
            :items="options(token('font'))"
            :placeholder="inherited('font') ?? 'normal'"
            size="xs"
            class="h-7 w-full bg-muted ring-0"
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
        </div>
        <div
          :class="ROW"
          data-style-row="align"
        >
          <div
            class="flex min-w-0"
            data-field-label="align"
          >
            <EditorFieldLabel
              v-bind="label('align')"
              @reset="setField('align', null)"
            />
          </div>
          <EditorSegmented
            tooltips
            :items="segments('align', ALIGN_ICONS, ALIGN_LABELS)"
            :model-value="own('align')"
            :inherited="inherited('align')"
            aria-label="Text align"
            data-style-key="align"
            @update:model-value="setField('align', $event)"
          />
        </div>
        <div
          :class="ROW"
          data-style-row="color"
        >
          <div
            class="flex min-w-0"
            data-field-label="color"
          >
            <EditorFieldLabel
              v-bind="label('color')"
              @reset="setField('color', null)"
            />
          </div>
          <EditorSwatchPicker
            v-if="editor.theme"
            :token="token('color')"
            :value="own('color')"
            :theme="editor.theme"
            @preview="preview('color', $event)"
            @update="setField('color', $event)"
          />
        </div>
      </template>

      <div
        v-else-if="section === 'Backgrounds'"
        :class="ROW"
        data-style-row="bg"
      >
        <div
          class="flex min-w-0"
          data-field-label="bg"
        >
          <EditorFieldLabel
            v-bind="label('bg')"
            @reset="setField('bg', null)"
          />
        </div>
        <EditorSwatchPicker
          v-if="editor.theme"
          :token="token('bg')"
          :value="own('bg')"
          :theme="editor.theme"
          @preview="preview('bg', $event)"
          @update="setField('bg', $event)"
        />
      </div>

      <template v-else-if="section === 'Borders'">
        <div
          :class="ROW"
          data-style-row="border"
        >
          <div
            class="flex min-w-0"
            data-field-label="border"
          >
            <EditorFieldLabel
              v-bind="label('border')"
              @reset="setField('border', null)"
            />
          </div>
          <EditorSegmented
            :items="segments('border')"
            :model-value="own('border')"
            aria-label="Border width"
            data-style-key="border"
            @update:model-value="setField('border', $event)"
          />
        </div>
        <div
          :class="ROW"
          data-style-row="borderColor"
        >
          <div
            class="flex min-w-0"
            data-field-label="borderColor"
          >
            <EditorFieldLabel
              v-bind="label('borderColor')"
              @reset="setField('borderColor', null)"
            />
          </div>
          <EditorSwatchPicker
            v-if="editor.theme"
            :token="token('borderColor')"
            :value="own('borderColor')"
            :theme="editor.theme"
            @preview="preview('borderColor', $event)"
            @update="setField('borderColor', $event)"
          />
        </div>
        <div
          :class="ROW"
          data-style-row="rounded"
        >
          <div
            class="flex min-w-0"
            data-field-label="rounded"
          >
            <EditorFieldLabel
              v-bind="label('rounded')"
              @reset="setField('rounded', null)"
            />
          </div>
          <USelect
            :model-value="own('rounded')"
            :items="options(token('rounded'))"
            placeholder="none"
            size="xs"
            class="h-7 w-full bg-muted font-mono ring-0"
            :ui="SELECT_UI"
            :aria-label="token('rounded').label"
            data-style-key="rounded"
            :content="optionPreview('rounded')"
            @update:model-value="setField('rounded', $event)"
            @update:open="!$event && preview('rounded', null)"
          >
            <template #item-label="{ item: option }">
              <span :data-option-value="option.value">{{ option.label }}</span>
            </template>
            <template #leading>
              <span
                class="block size-3 border-t-[1.5px] border-l-[1.5px] border-current text-muted"
                :style="{ borderTopLeftRadius: RADIUS_PX[own('rounded') ?? 'none'] }"
              />
            </template>
            <template #item-leading="{ item: option }">
              <span
                class="block size-3 border-t-[1.5px] border-l-[1.5px] border-current text-muted"
                :style="{ borderTopLeftRadius: RADIUS_PX[option.value] }"
              />
            </template>
          </USelect>
        </div>
      </template>

      <div
        v-else-if="section === 'Effects'"
        :class="ROW"
        data-style-row="shadow"
      >
        <div
          class="flex min-w-0"
          data-field-label="shadow"
        >
          <EditorFieldLabel
            v-bind="label('shadow')"
            @reset="setField('shadow', null)"
          />
        </div>
        <USelect
          :model-value="own('shadow')"
          :items="options(token('shadow'))"
          placeholder="none"
          size="xs"
          class="h-7 w-full bg-muted font-mono ring-0"
          :ui="SELECT_UI"
          :aria-label="token('shadow').label"
          data-style-key="shadow"
          :content="optionPreview('shadow')"
          @update:model-value="setField('shadow', $event)"
          @update:open="!$event && preview('shadow', null)"
        >
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
      </div>
    </EditorStyleSection>
  </div>
</template>
