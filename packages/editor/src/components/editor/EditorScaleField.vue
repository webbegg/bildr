<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { StyleToken } from '@bildr/codegen/design'
import { parseScaleInput, scalePx, SHIFT_STOPS, stepScale } from '@bildr/editor-core/scale'
import { scrubStops, startScrub } from '@bildr/editor-core/scrub'
import { useEditor } from '../../editor/useEditor.ts'

/**
 * A token-scale field (Framer's soft number field, over a scale): shows the
 * value, with its px size at the project density in the tooltip. Dragging
 * the field, or the row label through the exposed `scrub`, moves through the
 * scale (Shift: four stops per step), Up/Down step, typing a scale value (or
 * a px size on it) commits on Enter or blur and anything else reverts, and
 * the chevron (shown on hover) lists every value. `bare` drops the box and
 * the list, for a cell of joined side fields.
 *
 * Gestures `preview` the value they hold (null when they end) and `commit`
 * once: on release, Enter, an arrow step or a pick. Escape cancels a scrub,
 * and hovering a listed value previews it until the list closes.
 */
defineOptions({ inheritAttrs: false })
const props = defineProps<{
  token: StyleToken
  /** The value set at the edited breakpoint. */
  value: string | undefined
  /** The value that applies otherwise, from a smaller breakpoint or a shorthand. */
  inherited?: string
  /** Shown when nothing applies. */
  placeholder?: string
  /** Adds up/down steppers, for short scales such as radius or grid columns. */
  stepper?: boolean
  bare?: boolean
}>()
const emit = defineEmits<{ preview: [value: string | null], commit: [value: string] }>()
const editor = useEditor()

const field = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const focused = ref(false)
const text = ref('')
/** The value a scrub holds until release. */
const draft = ref<string | null>(null)
const listOpen = ref(false)

const current = computed(() => props.value ?? props.inherited)
const shown = computed(() => draft.value ?? current.value)
const spacing = computed(() => editor.theme?.spacing ?? 'default')
const px = (value: string | undefined) => (value === undefined ? undefined : scalePx(props.token.key, value, spacing.value))
const hint = computed(() => px(focused.value && text.value.trim() ? parseScaleInput(props.token.key, text.value, spacing.value) : shown.value))

// The last value sent, so a blur right after an arrow step does not send it again.
let sent: string | undefined
watch(() => props.value, () => {
  sent = undefined
})

function commit(next: string | undefined) {
  if (next === undefined || next === props.value || next === sent) return
  sent = next
  emit('commit', next)
}

function step(delta: number) {
  const next = stepScale(props.token.key, current.value, delta)
  if (next === undefined || next === current.value) return
  if (focused.value) text.value = next
  commit(next)
}

/** Starts a scrub from a press on the field or its row label. */
function scrub(event: PointerEvent) {
  if (focused.value || event.button !== 0) return
  event.preventDefault()
  const from = current.value
  // A click on the field (not its label) types into it.
  const typing = event.currentTarget === field.value
  startScrub(event, {
    move({ dx, shiftKey }) {
      const stops = scrubStops(dx, shiftKey)
      const next = stops === 0 ? from : stepScale(props.token.key, from, stops)
      if (next === draft.value || (draft.value === null && next === from)) return
      draft.value = next ?? null
      emit('preview', draft.value)
    },
    end(dragged) {
      const next = draft.value
      draft.value = null
      if (!dragged) {
        if (typing) input.value?.focus()
        return
      }
      emit('preview', null)
      if (next !== null && next !== from) commit(next)
    },
    cancel() {
      draft.value = null
      emit('preview', null)
    }
  })
}

function onFocus() {
  sent = undefined
  focused.value = true
  text.value = props.value ?? ''
  nextTick(() => input.value?.select())
}

function onBlur() {
  if (!focused.value) return
  focused.value = false
  const typed = text.value.trim()
  if (typed && typed !== props.value) commit(parseScaleInput(props.token.key, typed, spacing.value))
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault()
    step((event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? SHIFT_STOPS : 1))
  } else if (event.key === 'Enter') {
    input.value?.blur()
  } else if (event.key === 'Escape') {
    text.value = props.value ?? ''
    input.value?.blur()
  }
}

watch(listOpen, (open) => {
  if (!open) emit('preview', null)
})

function pick(value: string) {
  listOpen.value = false
  emit('preview', null)
  commit(value)
}

defineExpose({ scrub })
</script>

<template>
  <div
    ref="field"
    class="group/field flex h-[30px] min-w-0 items-center ring-inset"
    :class="[
      bare ? 'justify-center' : 'rounded-lg bg-elevated ps-2.5',
      focused ? 'cursor-text ring-1 ring-(color:--editor-selection)' : ['cursor-ew-resize', bare ? 'hover:bg-white/4' : 'hover:ring-1 hover:ring-white/10']
    ]"
    :title="hint ? `${token.label}: ${hint}` : token.label"
    :data-style-key="token.key"
    :data-scrubbing="draft !== null || undefined"
    v-bind="$attrs"
    @pointerdown="scrub"
  >
    <input
      ref="input"
      :value="focused ? text : shown ?? ''"
      :placeholder="(focused ? current : undefined) ?? placeholder ?? '—'"
      :aria-label="token.label"
      class="w-0 min-w-0 flex-1 bg-transparent text-[12px] tabular-nums outline-none placeholder:text-dimmed"
      :class="[focused ? 'cursor-text' : 'pointer-events-none', bare ? 'text-center' : '', value !== undefined || draft !== null ? 'text-highlighted' : 'text-toned']"
      spellcheck="false"
      autocomplete="off"
      @input="text = ($event.target as HTMLInputElement).value"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onKeydown"
    >
    <div
      v-if="stepper"
      class="me-1 flex h-full w-4 shrink-0 flex-col justify-center"
    >
      <button
        v-for="delta in [1, -1]"
        :key="delta"
        type="button"
        class="grid h-3 w-4 place-items-center rounded-sm text-dimmed outline-none hover:text-highlighted focus-visible:text-highlighted"
        :aria-label="`${delta < 0 ? 'Fewer' : 'More'} ${token.label.toLowerCase()}`"
        @pointerdown.stop
        @click="step(delta)"
      >
        <UIcon
          :name="delta < 0 ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'"
          class="size-3"
        />
      </button>
    </div>
    <UPopover
      v-if="!bare"
      v-model:open="listOpen"
      :content="{ side: 'bottom', align: 'end' }"
    >
      <button
        type="button"
        class="grid h-full w-6 shrink-0 place-items-center text-dimmed opacity-0 group-focus-within/field:opacity-100 group-hover/field:opacity-100 hover:text-highlighted focus-visible:opacity-100 aria-expanded:opacity-100"
        :aria-label="`${token.label} values`"
        @pointerdown.stop
      >
        <UIcon
          name="i-lucide-chevron-down"
          class="size-3.5"
        />
      </button>
      <template #content>
        <div
          class="max-h-64 w-40 overflow-y-auto p-1"
          role="listbox"
          :aria-label="token.label"
          @mouseleave="emit('preview', null)"
        >
          <button
            v-for="option in token.values"
            :key="option"
            type="button"
            role="option"
            :aria-selected="option === value"
            class="flex h-7 w-full items-center justify-between rounded-lg px-2 text-[12px] hover:bg-elevated"
            :class="option === value ? 'text-(color:--editor-selection)' : option === current ? 'text-highlighted' : 'text-toned'"
            @mouseenter="emit('preview', option)"
            @click="pick(option)"
          >
            {{ option }}
            <span class="text-[11px] text-dimmed">{{ px(option) }}</span>
          </button>
        </div>
      </template>
    </UPopover>
  </div>
</template>
