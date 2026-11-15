<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Transition } from '@bildr/codegen/model'
import { DEFAULT_TRANSITION } from '@bildr/codegen/render'
import { useEditor } from '../../editor/useEditor.ts'
import { cssTransition, TRANSITION_EASINGS, transitionCurve, withTransitionType } from '../../shared/interactionPanel.ts'

/**
 * The Transition popover's body (Framer's): Instant / Ease / Spring tabs,
 * the duration and easing of an ease, the stiffness and damping of a spring,
 * a curve preview, and Preview, which runs a swatch across with the very CSS
 * transition instances get (`cssTransition`). `variantId` null edits the
 * component's own transition (the primary's, and every variant's default);
 * a variant without its own inherits it, shown dimmed, and "Inherit" clears
 * the variant's. Each change is one undo step. It only shows in a
 * component, and its popover is portalled outside the editor root, so it
 * draws in `--editor-component` (the context purple there).
 */
const { variantId } = defineProps<{ variantId: string | null }>()
const editor = useEditor()

const def = computed(() => editor.component)
const own = computed<Transition | undefined>(() => (variantId ? def.value?.variants.find(variant => variant.id === variantId)?.transition : def.value?.transition))
/** What applies: the variant's own, else the component's, else the default. */
const shown = computed<Transition>(() => own.value ?? def.value?.transition ?? DEFAULT_TRANSITION)

const TYPES = [{ value: 'instant', label: 'Instant' }, { value: 'ease', label: 'Ease' }, { value: 'spring', label: 'Spring' }]
const EASINGS = TRANSITION_EASINGS.map(value => ({ value, label: value === 'ease' ? 'Ease' : value.split('-').map(word => word[0]!.toUpperCase() + word.slice(1)).join(' ') }))

function set(transition: Transition | null) {
  void editor.setTransition(variantId, transition)
}

function setType(type: string) {
  set(withTransitionType(own.value ?? shown.value, type as Transition['type']))
}

/** Sets a number field within its range; blank resets it to the type's default. */
function setNumber(key: 'duration' | 'stiffness' | 'damping', input: string | number, min: number, max: number) {
  // A number field may hand over a number despite EditorInput's string type.
  const text = String(input)
  const next: Transition = { ...shown.value }
  const value = Number(text)
  if (!text.trim()) Reflect.deleteProperty(next, key)
  else if (Number.isFinite(value)) next[key] = Math.min(Math.max(value, min), max)
  else return
  set(next)
}

const CURVE = { width: 216, height: 56 }
const curve = computed(() => transitionCurve(shown.value, CURVE.width, CURVE.height))

/** Preview: the swatch goes to the other end with the transition. */
const across = ref(false)
const swatchTransition = computed(() => cssTransition(shown.value, ['left']))
</script>

<template>
  <div
    v-if="def"
    class="space-y-2"
    data-transition-fields
  >
    <EditorSegmented
      :items="TYPES"
      :model-value="own?.type"
      :inherited="own ? undefined : shown.type"
      aria-label="Transition type"
      data-transition-type
      @update:model-value="setType"
    />
    <template v-if="shown.type === 'ease'">
      <EditorRow label="Duration">
        <EditorInput
          class="flex-1"
          type="number"
          commit="change"
          :model-value="shown.duration ?? DEFAULT_TRANSITION.duration"
          aria-label="Duration in seconds"
          data-transition-duration
          @commit="setNumber('duration', $event, 0, 10)"
        >
          <template #trailing>
            <span class="pe-1 text-[12px] text-dimmed">s</span>
          </template>
        </EditorInput>
      </EditorRow>
      <EditorRow label="Easing">
        <EditorSelect
          class="flex-1"
          :model-value="shown.easing ?? 'ease'"
          :items="EASINGS"
          aria-label="Easing"
          data-transition-easing
          @update:model-value="set({ ...shown, easing: $event as Transition['easing'] })"
        />
      </EditorRow>
    </template>
    <template v-else-if="shown.type === 'spring'">
      <EditorRow label="Stiffness">
        <EditorInput
          class="flex-1"
          type="number"
          commit="change"
          :model-value="shown.stiffness ?? 300"
          aria-label="Stiffness"
          data-transition-stiffness
          @commit="setNumber('stiffness', $event, 1, 1000)"
        />
      </EditorRow>
      <EditorRow label="Damping">
        <EditorInput
          class="flex-1"
          type="number"
          commit="change"
          :model-value="shown.damping ?? 30"
          aria-label="Damping"
          data-transition-damping
          @commit="setNumber('damping', $event, 0, 100)"
        />
      </EditorRow>
    </template>
    <div
      class="rounded-lg bg-elevated p-2"
      data-transition-curve
    >
      <svg
        :viewBox="`-4 -6 ${CURVE.width + 8} ${CURVE.height + 12}`"
        class="block h-[68px] w-full overflow-visible"
        aria-hidden="true"
      >
        <line
          x1="0"
          :y1="CURVE.height"
          :x2="CURVE.width"
          :y2="CURVE.height"
          class="stroke-white/10"
          stroke-width="1"
        />
        <path
          :d="curve"
          fill="none"
          stroke="var(--editor-component)"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <div class="mt-2 flex items-center gap-2">
        <div class="relative h-5 flex-1 rounded-md bg-white/4">
          <div
            class="absolute top-0.5 size-4 rounded-sm bg-(--editor-component)"
            :style="{ left: across ? 'calc(100% - 18px)' : '2px', transition: swatchTransition }"
            data-transition-swatch
          />
        </div>
        <EditorButton
          label="Preview"
          icon="i-lucide-play"
          size="xs"
          variant="soft"
          data-transition-preview
          @click="across = !across"
        />
      </div>
    </div>
    <div
      v-if="variantId && own"
      class="flex justify-end"
    >
      <EditorButton
        label="Inherit"
        size="xs"
        variant="ghost"
        title="Use the component's transition"
        data-transition-inherit
        @click="set(null)"
      />
    </div>
  </div>
</template>
