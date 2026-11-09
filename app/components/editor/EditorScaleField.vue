<script setup lang="ts">
import type { StyleToken } from '#shared/design/tokens'
import { parseScaleInput, scalePx, SHIFT_STOPS, stepScale } from '#shared/editor/scale'
import { scrubStops, startScrub } from '#shared/editor/scrub'

/**
 * A token-scale field (Figma's scrubbable number field, over a scale): shows
 * the value with its px size at the project density. Dragging the field or its
 * `prefix` slot (the letter or icon in front) scrubs through the scale (Shift:
 * four stops per step), Up/Down step, typing a scale value (or a px size on
 * it) commits on Enter or blur and anything else reverts, and the chevron
 * (shown on hover) lists every value.
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
  /** Adds −/+ buttons, for short scales such as grid columns. */
  stepper?: boolean
}>()
const emit = defineEmits<{ preview: [value: string | null], commit: [value: string] }>()
const slots = defineSlots<{ prefix?: () => unknown }>()
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

/** Starts a scrub from a press on the field or its label. */
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
    class="group/field flex h-6 min-w-0 items-center rounded-[5px] bg-elevated ring-inset"
    :class="[focused ? 'cursor-text ring-1 ring-(color:--editor-selection)' : 'cursor-ew-resize hover:ring-1 hover:ring-white/10', slots.prefix ? '' : 'ps-2']"
    :data-style-key="token.key"
    :data-scrubbing="draft !== null || undefined"
    v-bind="$attrs"
    @pointerdown="scrub"
  >
    <div
      v-if="slots.prefix"
      class="flex h-full shrink-0 cursor-ew-resize items-center"
      :data-field-label="token.key"
      @pointerdown.stop="scrub"
    >
      <slot name="prefix" />
    </div>
    <input
      ref="input"
      :value="focused ? text : shown ?? ''"
      :placeholder="(focused ? current : undefined) ?? placeholder ?? '—'"
      :aria-label="token.label"
      class="w-0 min-w-0 flex-1 bg-transparent text-[11px] tabular-nums outline-none placeholder:text-dimmed"
      :class="[focused ? 'cursor-text' : 'pointer-events-none', value !== undefined || draft !== null ? 'text-highlighted' : 'text-toned']"
      spellcheck="false"
      autocomplete="off"
      @input="text = ($event.target as HTMLInputElement).value"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onKeydown"
    >
    <span
      v-if="hint"
      class="ms-1 shrink-0 text-[10px] text-dimmed tabular-nums"
    >{{ hint }}</span>
    <template v-if="stepper">
      <button
        v-for="delta in [-1, 1]"
        :key="delta"
        type="button"
        class="grid h-full w-5 shrink-0 place-items-center rounded-sm text-dimmed outline-none hover:text-highlighted focus-visible:bg-elevated focus-visible:text-highlighted"
        :aria-label="`${delta < 0 ? 'Fewer' : 'More'} ${token.label.toLowerCase()}`"
        @pointerdown.stop
        @click="step(delta)"
      >
        <UIcon
          :name="delta < 0 ? 'i-lucide-minus' : 'i-lucide-plus'"
          class="size-3"
        />
      </button>
    </template>
    <UPopover
      v-model:open="listOpen"
      :content="{ side: 'bottom', align: 'end' }"
    >
      <button
        type="button"
        class="grid h-full w-5 shrink-0 place-items-center text-dimmed opacity-0 group-focus-within/field:opacity-100 group-hover/field:opacity-100 hover:text-highlighted focus-visible:opacity-100 aria-expanded:opacity-100"
        :aria-label="`${token.label} values`"
        @pointerdown.stop
      >
        <UIcon
          name="i-lucide-chevron-down"
          class="size-3"
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
            class="flex h-6 w-full items-center justify-between rounded-sm px-2 font-mono text-xs hover:bg-elevated"
            :class="option === value ? 'text-(color:--editor-info)' : option === current ? 'text-(color:--editor-provenance)' : 'text-toned'"
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
