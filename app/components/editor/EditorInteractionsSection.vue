<script setup lang="ts">
import { INTERACTION_EVENTS } from '#shared/document/schema'
import type { InteractionEvent } from '#shared/document/schema'
import { EVENT_LABELS, interactionLabel, interactionTargets, transitionSummary } from '#shared/editor/interactionPanel'
import { interactionsOf } from '#shared/runtime/interactions'

/**
 * The component view's Interactions section, for the active variant (or
 * state; the primary's are the component's own): Framer's rows
 * `Click → Variant 2` with × to remove, each opening the Interaction
 * popover (event, target, delay); "+" picks On › then a target. Below, the
 * Transition row: the transition changes into this variant animate with
 * ("Ease 0.3s", "Spring", "Instant", or "Inherit" on a variant without its
 * own), opening the Transition popover. On the primary it is the
 * component's, the default of every variant.
 */
const editor = useEditor()

const def = computed(() => editor.component)
/** The variant whose interactions show: `''` for the primary. */
const owner = computed(() => editor.variant?.id ?? '')
const list = computed(() => (def.value ? interactionsOf(def.value, owner.value) : []))
const isState = computed(() => !!editor.variant?.state)

const menu = computed(() => {
  const targets = def.value ? interactionTargets(def.value, owner.value) : []
  return INTERACTION_EVENTS.map(on => ({
    id: on,
    label: EVENT_LABELS[on],
    ...(targets.length
      ? { children: targets.map(t => ({ id: `${on}:${t.id}`, label: t.label })) }
      : { disabled: true, hint: 'Add a variant to go to first' })
  }))
})

/** The row whose popover is open. */
const openRow = ref<string | null>(null)

async function add(item: string) {
  const at = item.indexOf(':')
  const id = await editor.addInteraction(editor.variant?.id ?? null, item.slice(0, at) as InteractionEvent, item.slice(at + 1))
  if (id) openRow.value = id
}

function setOpen(id: string, open: boolean) {
  openRow.value = open ? id : null
  if (open) editor.interactionId = id
}

const own = computed(() => (editor.variant ? editor.variant.transition : def.value?.transition))
const transitionOpen = ref(false)
</script>

<template>
  <EditorStyleSection
    v-if="def"
    label="Interactions"
    add-label="Add interaction"
    :menu="menu"
    data-component-interactions
    @add="add"
  >
    <div
      v-for="interaction in list"
      :key="interaction.id"
      class="group/interaction relative flex h-[30px] items-center"
      :data-interaction-row="interaction.id"
    >
      <EditorPopover
        :open="openRow === interaction.id"
        title="Interaction"
        data-interaction-popover
        @update:open="setOpen(interaction.id, $event)"
      >
        <template #trigger>
          <button
            type="button"
            class="flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg ps-2 pe-8 text-start text-[12px] text-toned hover:bg-white/4"
            :class="[FOCUS_RING, editor.interactionId === interaction.id ? 'bg-white/8 text-highlighted' : '']"
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
          :interaction-id="interaction.id"
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
        @click="editor.removeInteraction(interaction.id)"
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
