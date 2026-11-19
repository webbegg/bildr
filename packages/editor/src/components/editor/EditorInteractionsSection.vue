<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FOCUS_RING } from '../../editorUi.ts'
import { useEditor } from '../../editor/useEditor.ts'
import type { InteractionEvent } from '../../editor/useEditor.ts'
import { EVENT_LABELS, interactionLabel, interactionRows, interactionTargets, transitionSummary, VARIANT_EVENTS } from '../../shared/interactionPanel.ts'

/**
 * The component view's Interactions section, for the active variant (or
 * state; the primary's are the component's own): Framer's rows
 * `Click → Variant 2` with × to remove, each opening the Interaction
 * popover (event, target, delay); "+" picks On › then a target. Below, the
 * Transition row: the transition changes into this variant animate with
 * ("Ease 0.3s", "Spring", "Instant", or "Inherit" on a variant without its
 * own), opening the Transition popover. On the primary it is the
 * component's, the default of every variant.
 *
 * An interaction is keyed `<variant>:<index>` (it has no id in the model).
 *
 * Titled "Variant changes", not "Interactions" (B3): a node in the component view also has its own Interactions ("When Click → …",
 * EditorNodeInteractions), and two sections with one title would not say which does what. These change the component's variant.
 */
const editor = useEditor()

const def = computed(() => editor.component)
/** The variant whose interactions show: `''` for the primary. */
const owner = computed(() => editor.variant?.id ?? '')
const list = computed(() => (def.value ? interactionRows(def.value, owner.value) : []))
const isState = computed(() => !!editor.variant?.state)

const menu = computed(() => {
  const targets = def.value ? interactionTargets(def.value, owner.value) : []
  return VARIANT_EVENTS.map(on => ({
    id: on,
    label: EVENT_LABELS[on],
    ...(targets.length
      ? { children: targets.map(target => ({ id: `${on}:${target.id}`, label: target.label })) }
      : { disabled: true, hint: 'Add a variant to go to first' })
  }))
})

/** The row whose popover is open. */
const openRow = ref<string | null>(null)

async function add(item: string) {
  const at = item.indexOf(':')
  const key = await editor.addInteraction(editor.variant?.id ?? null, item.slice(0, at) as InteractionEvent, item.slice(at + 1))
  if (key) openRow.value = key
}

// The key is the row's place in its list: when the editor drops the selection (a row went or came), the popover must not stay on whatever now holds that place.
watch(() => editor.interactionId, (key) => {
  if (openRow.value && key !== openRow.value) openRow.value = null
})

function setOpen(key: string, open: boolean) {
  openRow.value = open ? key : null
  if (open) editor.interactionId = key
}

const own = computed(() => (editor.variant ? editor.variant.transition : def.value?.transition))
const transitionOpen = ref(false)
</script>

<template>
  <EditorStyleSection
    v-if="def"
    label="Variant changes"
    add-label="Add variant change"
    :menu="menu"
    data-component-interactions
    @add="add"
  >
    <div
      v-for="interaction in list"
      :key="interaction.key"
      class="group/interaction relative flex h-[30px] items-center"
      :data-interaction-row="interaction.key"
    >
      <EditorPopover
        :open="openRow === interaction.key"
        title="Interaction"
        data-interaction-popover
        @update:open="setOpen(interaction.key, $event)"
      >
        <template #trigger>
          <button
            type="button"
            class="flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg ps-2 pe-8 text-start text-[12px] text-toned hover:bg-white/4"
            :class="[FOCUS_RING, editor.interactionId === interaction.key ? 'bg-white/8 text-highlighted' : '']"
            :aria-label="`Edit ${interactionLabel(def, interaction)}`"
          >
            <UIcon
              name="i-lucide-zap"
              class="size-3.5 shrink-0 text-(--editor-context)"
            />
            <span class="truncate">{{ interactionLabel(def, interaction) }}</span>
            <span
              v-if="interaction.delay"
              class="shrink-0 text-[11px] text-dimmed tabular-nums"
            >{{ interaction.delay }}s</span>
          </button>
        </template>
        <EditorInteractionFields
          :interaction-id="interaction.key"
          @removed="openRow = null"
        />
      </EditorPopover>
      <EditorButton
        icon="i-lucide-x"
        size="xs"
        variant="ghost"
        :aria-label="`Remove ${interactionLabel(def, interaction)}`"
        class="absolute end-1"
        data-interaction-delete
        @click="editor.removeInteraction(interaction.key)"
      />
    </div>
    <p
      v-if="!list.length"
      class="text-[11px] text-dimmed"
    >
      {{ isState ? 'A state shows from the pointer; it can still go to another variant.' : 'Use + or drag a frame\'s ⚡ on the board to another variant.' }}
    </p>
    <EditorRow label="Transition">
      <EditorPopover
        v-model:open="transitionOpen"
        title="Transition"
        data-transition-popover
      >
        <template #trigger>
          <button
            type="button"
            class="flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-lg bg-elevated px-2.5 text-left text-[12px] hover:ring-1 hover:ring-white/10 hover:ring-inset"
            :class="[FOCUS_RING, own ? 'text-toned' : 'text-dimmed']"
            aria-label="Edit transition"
            data-transition-row
          >
            <UIcon
              name="i-lucide-activity"
              class="size-3.5 shrink-0"
            />
            <span class="truncate">{{ transitionSummary(own, !!editor.variant) }}</span>
          </button>
        </template>
        <EditorTransitionFields :variant-id="editor.variant?.id ?? null" />
      </EditorPopover>
    </EditorRow>
  </EditorStyleSection>
</template>
