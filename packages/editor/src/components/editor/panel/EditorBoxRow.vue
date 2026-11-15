<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Breakpoint } from '@bildr/codegen/design'
import { getStyleToken } from '@bildr/codegen/design'
import type { Side, SpacingBox } from '@bildr/editor-core/spacing'
import { boxSides, boxUniform, boxWrite, sideKey, SIDES } from '@bildr/editor-core/spacing'
import type { Provenance } from '@bildr/editor-core/styleFields'
import { spacingProvenance } from '../../../shared/panel.ts'
import EditorScaleField from '../EditorScaleField.vue'

/**
 * Framer's padding (or margin) row: one value for all sides, or, with the
 * toggle on individual, joined T R B L fields below; the summary field then
 * opens the same editor in a popover ("Padding" ×, a Set row with the toggle,
 * the joined fields). One value writes `p`; a side writes its own key, folded
 * into `p` or `px`/`py` once the four sides are set (see `boxWrite`).
 */
const props = defineProps<{
  box: SpacingBox
  label: string
  styles: Record<string, string>
  breakpoint: Breakpoint | undefined
  provenance: Provenance
  device?: string
  mixed?: boolean
}>()
const emit = defineEmits<{ preview: [patch: Record<string, string | null> | null], commit: [patch: Record<string, string | null>], reset: [] }>()

const token = computed(() => getStyleToken(props.box)!)
const uniform = computed(() => boxUniform(props.styles, props.box, props.breakpoint))
const individual = ref(!uniform.value)
watch(uniform, (value) => {
  if (!value) individual.value = true
})

const sides = computed(() => SIDES.map(side => ({ side, provenance: spacingProvenance(props.styles, props.box, side, props.breakpoint) })))
const allSet = computed(() => sides.value.every(s => s.provenance.state === 'set'))
const first = computed(() => sides.value[0]!.provenance)
const single = computed(() => ({
  value: uniform.value && allSet.value && first.value.state === 'set' ? first.value.value : undefined,
  inherited: uniform.value && first.value.state !== 'unset' ? first.value.value : undefined
}))
const summary = computed(() => Object.values(boxSides(props.styles, props.box, props.breakpoint)).map(v => v ?? '0').join(', '))

const LETTERS: Record<Side, string> = { top: 'T', right: 'R', bottom: 'B', left: 'L' }
const cells = computed(() => sides.value.map(({ side, provenance }) => ({
  key: sideKey(props.box, side),
  letter: LETTERS[side],
  token: getStyleToken(sideKey(props.box, side))!,
  value: provenance.state === 'set' ? provenance.value : undefined,
  inherited: provenance.state === 'inherited' ? provenance.value : undefined,
  placeholder: props.mixed ? '–' : '0'
})))
const sideOf = (key: string) => SIDES.find(side => sideKey(props.box, side) === key)!

const write = (target: Side | 'all', value: string) => boxWrite(props.styles, props.box, props.breakpoint, target, value)
const previewSide = (key: string, value: string | null) => emit('preview', value === null ? null : write(sideOf(key), value))
const commitSide = (key: string, value: string) => emit('commit', write(sideOf(key), value))

/** Back to one value: the top side's, for every side. */
function setIndividual(next: boolean) {
  if (next === individual.value) return
  individual.value = next
  popover.value = popover.value && next
  const top = sides.value[0]!.provenance
  if (!next && !uniform.value && top.state !== 'unset') emit('commit', write('all', top.value))
}

const popover = ref(false)
const field = ref<InstanceType<typeof EditorScaleField> | null>(null)
const scrub = (event: PointerEvent) => field.value?.scrub(event)
</script>

<template>
  <EditorRow
    :label="label"
    :title="token.label"
    :provenance="provenance"
    :device="device"
    :name="box === 'p' ? 'padding' : 'margin'"
    :scrub="individual ? undefined : scrub"
    :data-style-row="box === 'p' ? 'padding' : 'margin'"
    :data-padding-mode="individual ? 'sides' : 'all'"
    @reset="emit('reset')"
  >
    <EditorScaleField
      v-if="!individual"
      ref="field"
      class="flex-1"
      :token="token"
      :value="single.value"
      :inherited="single.inherited"
      :placeholder="mixed ? 'Mixed' : '0'"
      @preview="emit('preview', $event === null ? null : write('all', $event))"
      @commit="emit('commit', write('all', $event))"
    />
    <UPopover
      v-else
      v-model:open="popover"
      :content="{ side: 'left', align: 'start', sideOffset: 120 }"
    >
      <button
        type="button"
        class="flex h-[30px] min-w-0 flex-1 items-center rounded-lg bg-elevated px-2.5 text-left text-[12px] text-toned tabular-nums hover:ring-1 hover:ring-white/10 hover:ring-inset"
        :aria-label="`Edit ${label.toLowerCase()}`"
        :data-box-summary="box"
      >
        <span class="truncate">{{ mixed ? 'Mixed' : summary }}</span>
      </button>
      <template #content>
        <div
          class="w-72 rounded-xl"
          :data-box-popover="box"
        >
          <div class="flex h-12 items-center justify-between border-b border-default ps-4 pe-2">
            <span class="text-[12px] font-[550] text-highlighted">{{ label }}</span>
            <button
              type="button"
              class="grid size-7 place-items-center rounded-lg text-muted hover:bg-white/8 hover:text-highlighted"
              aria-label="Close"
              @click="popover = false"
            >
              <UIcon
                name="i-lucide-x"
                class="size-4"
              />
            </button>
          </div>
          <div class="space-y-2 p-4">
            <EditorRow label="Set">
              <div class="flex h-[30px] min-w-0 flex-1 items-center rounded-lg bg-elevated px-2.5 text-[12px] text-dimmed">
                {{ mixed ? 'Mixed' : '' }}
              </div>
              <EditorSplitToggle
                :model-value="individual"
                :name="`${label.toLowerCase()} sides`"
                @update:model-value="setIndividual"
              />
              <template #below>
                <EditorJoinedFields
                  :cells="cells"
                  @preview="previewSide"
                  @commit="commitSide"
                />
              </template>
            </EditorRow>
          </div>
        </div>
      </template>
    </UPopover>
    <EditorSplitToggle
      :model-value="individual"
      :name="label.toLowerCase()"
      @update:model-value="setIndividual"
    />
    <template
      v-if="individual"
      #below
    >
      <EditorJoinedFields
        :cells="cells"
        @preview="previewSide"
        @commit="commitSide"
      />
    </template>
  </EditorRow>
</template>
