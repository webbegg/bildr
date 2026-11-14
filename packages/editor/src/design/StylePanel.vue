<script setup lang="ts">
import { computed, reactive } from 'vue'
import { isResponsiveToken, STYLE_HEX } from '@bildr/codegen/design'
import type { StyleToken } from '@bildr/codegen/design'
import { parseScaleInput, scalePx, stepScale } from '@bildr/editor-core/scale'
import { scrubStops, startScrub } from '@bildr/editor-core/scrub'
import { colorSwatch, colorSwatchRows, fieldLabel, provenanceHint, sectionMark, styleFieldControl, styleProvenance, styleSections } from '@bildr/editor-core/styleFields'
import type { StyleSection } from '@bildr/editor-core/styleFields'
import CommitInput from './CommitInput.vue'
import { useDesign } from './store.ts'

/**
 * The style panel (`node_update_style`): the design tokens in Stacki's
 * sections, shown at the device being edited. A value set at that device's
 * breakpoint is an override (highlighted, with a reset); one inherited from a
 * smaller level shows as the placeholder. A token without breakpoint variants
 * (colours, borders, effects) writes its base key whatever the device. Scale
 * fields (spacing) take a stop or a px size, step with the arrow keys and
 * scrub by dragging their label.
 */

const design = useDesign()
const sections = styleSections()
const OPEN: StyleSection[] = ['Layout', 'Spacing', 'Size']

const style = computed(() => design.selected.value?.style ?? {})
const spacingDensity = computed(() => design.theme.value.spacing)
const device = computed(() => design.device.value)
/** A scrub in progress: the stop its travel reached, shown before it is committed. */
const scrubbing = reactive<Record<string, string>>({})
const resets = reactive<Record<string, number>>({})

const provenance = (token: StyleToken) => styleProvenance(style.value, token.key, device.value.id, design.base.value)
const current = (token: StyleToken): string => scrubbing[token.key] ?? (provenance(token).state === 'set' ? (provenance(token) as { value: string }).value : '')
const inherited = (token: StyleToken): string => {
  const found = provenance(token)
  return found.state === 'inherited' ? found.value : ''
}
const breakpointOf = (token: StyleToken) => isResponsiveToken(token) ? device.value.breakpoint : undefined
const write = (token: StyleToken, value: string | null) => design.setStyle({ [token.key]: value }, breakpointOf(token))
const reset = (token: StyleToken) => write(token, null)
const isSet = (token: StyleToken) => provenance(token).state === 'set'
const hint = (token: StyleToken) => provenanceHint(provenance(token), design.base.value)

const commitScale = (token: StyleToken, raw: string) => {
  if (raw.trim() === '') return write(token, null)
  const value = parseScaleInput(token.key, raw, spacingDensity.value)
  if (value) return write(token, value)
  resets[token.key] = (resets[token.key] ?? 0) + 1
}
const step = (token: StyleToken, event: KeyboardEvent) => {
  const delta = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0
  if (!delta) return
  event.preventDefault()
  const next = stepScale(token.key, current(token) || inherited(token) || undefined, delta * (event.shiftKey ? 4 : 1))
  if (next) write(token, next)
}
const scrub = (token: StyleToken, event: PointerEvent) => {
  const start = current(token) || inherited(token) || undefined
  startScrub(event, {
    cursor: 'ew-resize',
    move: ({ dx, shiftKey }) => {
      const stops = scrubStops(dx, shiftKey)
      const value = stepScale(token.key, start, stops)
      if (value) scrubbing[token.key] = value
    },
    end: (dragged) => {
      const value = scrubbing[token.key]
      Reflect.deleteProperty(scrubbing, token.key)
      if (dragged && value) void write(token, value)
    },
    cancel: () => Reflect.deleteProperty(scrubbing, token.key)
  })
}

const toggle = (token: StyleToken, value: string) => write(token, current(token) === value ? null : value)
const pick = (token: StyleToken, event: Event) => write(token, (event.target as HTMLSelectElement).value || null)
const commitHex = (token: StyleToken, raw: string) => {
  const value = raw.trim()
  if (value === '') return write(token, null)
  if (STYLE_HEX.test(value)) return write(token, value)
  resets[token.key] = (resets[token.key] ?? 0) + 1
}
const swatchColor = (token: StyleToken) => colorSwatch(token, design.theme.value, current(token) || inherited(token))?.color
const label = (token: StyleToken) => fieldLabel(token)
const field = 'w-full rounded-md border border-default bg-default px-2 py-1 text-sm'
</script>

<template>
  <div
    class="flex flex-col"
    data-testid="style-panel"
  >
    <details
      v-for="group in sections"
      :key="group.section"
      :open="OPEN.includes(group.section)"
      class="border-b border-default"
      :data-testid="`style-section-${group.section}`"
    >
      <summary class="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium select-none">
        {{ group.section }}
        <span
          v-if="sectionMark(style, group.section, device.id, design.base.value)"
          class="size-1.5 rounded-full bg-primary"
        />
      </summary>
      <div class="flex flex-col gap-1.5 px-3 pb-3">
        <div
          v-for="token in group.fields"
          :key="token.key"
          class="grid grid-cols-[5.5rem_1fr_1rem] items-center gap-2 text-xs"
          :title="hint(token)"
        >
          <span
            class="truncate"
            :class="[isSet(token) ? 'font-medium text-primary' : 'text-muted', styleFieldControl(token) === 'spacing' ? 'cursor-ew-resize' : '']"
            @pointerdown="styleFieldControl(token) === 'spacing' && scrub(token, $event)"
          >{{ label(token) }}</span>

          <div
            v-if="styleFieldControl(token) === 'segmented'"
            class="flex overflow-hidden rounded-md border border-default"
            :data-testid="`style-${token.key}`"
          >
            <button
              v-for="value in token.values"
              :key="value"
              type="button"
              class="flex-1 px-1 py-1 text-center text-xs"
              :class="current(token) === value ? 'bg-primary text-inverted' : 'hover:bg-elevated'"
              :data-testid="`style-${token.key}-${value}`"
              @click="toggle(token, value)"
            >
              {{ value }}
            </button>
          </div>

          <CommitInput
            v-else-if="styleFieldControl(token) === 'spacing'"
            :key="`${token.key}-${resets[token.key] ?? 0}-${current(token)}`"
            :data-testid="`style-${token.key}`"
            :model-value="current(token)"
            :placeholder="inherited(token)"
            :title="current(token) ? scalePx(token.key, current(token), spacingDensity) : undefined"
            @commit="commitScale(token, $event)"
            @keydown="step(token, $event)"
          />

          <div
            v-else-if="styleFieldControl(token) === 'color'"
            class="flex items-center gap-1"
          >
            <span
              class="size-5 shrink-0 rounded-sm border border-default"
              :style="{ backgroundColor: swatchColor(token) ?? 'transparent' }"
            />
            <select
              :data-testid="`style-${token.key}`"
              :class="field"
              :value="STYLE_HEX.test(current(token)) ? '' : current(token)"
              @change="pick(token, $event)"
            >
              <option value="">
                {{ inherited(token) || '—' }}
              </option>
              <optgroup
                v-for="row in colorSwatchRows(token, design.theme.value)"
                :key="row.name"
                :label="row.name"
              >
                <option
                  v-for="swatch in row.swatches"
                  :key="swatch.value"
                  :value="swatch.value"
                >
                  {{ swatch.label }}
                </option>
              </optgroup>
              <optgroup
                v-if="Object.keys(design.theme.value.custom ?? {}).length"
                label="custom"
              >
                <option
                  v-for="name in Object.keys(design.theme.value.custom ?? {})"
                  :key="name"
                  :value="name"
                >
                  {{ name }}
                </option>
              </optgroup>
            </select>
            <CommitInput
              :key="`${token.key}-${resets[token.key] ?? 0}-${current(token)}`"
              :data-testid="`style-${token.key}-hex`"
              class="max-w-20 font-mono"
              placeholder="#hex"
              :model-value="STYLE_HEX.test(current(token)) ? current(token) : ''"
              @commit="commitHex(token, $event)"
            />
          </div>

          <select
            v-else
            :data-testid="`style-${token.key}`"
            :class="field"
            :value="current(token)"
            @change="pick(token, $event)"
          >
            <option value="">
              {{ inherited(token) || '—' }}
            </option>
            <option
              v-for="value in token.values"
              :key="value"
              :value="value"
            >
              {{ value }}
            </option>
          </select>

          <button
            v-if="isSet(token)"
            type="button"
            class="text-muted hover:text-default"
            :aria-label="`Reset ${label(token)}`"
            :data-testid="`style-${token.key}-reset`"
            @click="reset(token)"
          >
            <UIcon
              name="i-lucide-rotate-ccw"
              class="size-3"
            />
          </button>
          <span v-else />
        </div>
      </div>
    </details>
  </div>
</template>
