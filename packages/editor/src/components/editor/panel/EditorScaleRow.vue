<script setup lang="ts">
import { ref } from 'vue'
import type { StyleToken } from '@bildr/codegen/design'
import type { Provenance } from '@bildr/editor-core/styleFields'
import EditorScaleField from '../EditorScaleField.vue'

/**
 * A label-column row holding a token-scale field: dragging the label scrubs
 * the field, as the Figma prefix did. With `slider`, Framer's slider sits
 * beside the number; the `after` slot takes a mode select or a toggle, and
 * `below` the joined side fields.
 */
const props = defineProps<{
  label: string
  token: StyleToken
  provenance: Provenance
  device?: string
  value: string | undefined
  inherited?: string
  placeholder?: string
  stepper?: boolean
  slider?: boolean
  /** The base token key of the binding dot (see EditorRow). */
  bind?: string
}>()
const emit = defineEmits<{ preview: [value: string | null], commit: [value: string], reset: [] }>()

const field = ref<InstanceType<typeof EditorScaleField> | null>(null)
const scrub = (event: PointerEvent) => field.value?.scrub(event)
</script>

<template>
  <EditorRow
    :label="label"
    :title="token.label"
    :provenance="provenance"
    :device="device"
    :name="token.key"
    :scrub="scrub"
    :bind="bind"
    @reset="emit('reset')"
  >
    <EditorScaleField
      ref="field"
      :class="slider ? 'w-[72px] shrink-0' : 'flex-1'"
      :token="token"
      :value="value"
      :inherited="inherited"
      :placeholder="placeholder"
      :stepper="stepper"
      @preview="emit('preview', $event)"
      @commit="emit('commit', $event)"
    />
    <EditorScaleSlider
      v-if="slider"
      :token-key="token.key"
      :label="token.label"
      :value="props.value ?? props.inherited"
      @preview="emit('preview', $event)"
      @commit="emit('commit', $event)"
    />
    <slot name="after" />
    <template
      v-if="$slots.below"
      #below
    >
      <slot name="below" />
    </template>
  </EditorRow>
</template>
