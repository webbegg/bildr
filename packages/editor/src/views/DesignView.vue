<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide, ref } from 'vue'
import CanvasFrame from '../design/CanvasFrame.vue'
import DesignInspector from '../design/DesignInspector.vue'
import DesignLayers from '../design/DesignLayers.vue'
import DesignPalette from '../design/DesignPalette.vue'
import ProblemsList from '../components/ProblemsList.vue'
import DesignToolbar from '../design/DesignToolbar.vue'
import { createDesign, DESIGN_KEY } from '../design/store.ts'

/**
 * The Design screen (V1): the visual editor over the `.bildr/` model. A toolbar
 * (file, device, undo and redo, preview), the layers and the palette on the
 * left, the canvas in the middle, the inspector on the right. Every edit is a
 * module action; the canvas shows what the model says (see `design/store.ts`).
 */

const design = createDesign()
provide(DESIGN_KEY, design)
const side = ref<'layers' | 'add'>('layers')

const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

/** The editor's shortcuts, unless the key goes to a field (Delete in a text box deletes text). */
const onKeyDown = (event: KeyboardEvent) => {
  if (typing(event.target)) return
  const taken = design.onKey({ key: event.key, code: event.code, meta: event.metaKey || event.ctrlKey, shift: event.shiftKey, alt: event.altKey })
  if (taken) event.preventDefault()
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  void design.start()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  design.dispose()
})
</script>

<template>
  <div
    class="absolute inset-0 flex flex-col"
    data-testid="design"
  >
    <DesignToolbar />
    <div
      v-if="design.problems.value.length"
      class="p-4"
      data-testid="design-problems"
    >
      <ProblemsList
        title="The model has problems, so there is nothing to design until they are fixed (Model screen)"
        :problems="design.problems.value"
      />
    </div>
    <div
      v-else
      class="flex min-h-0 flex-1"
    >
      <aside class="flex w-64 shrink-0 flex-col border-r border-default">
        <div class="flex gap-1 border-b border-default p-1">
          <UButton
            data-testid="tab-layers"
            label="Layers"
            size="xs"
            color="neutral"
            :variant="side === 'layers' ? 'soft' : 'ghost'"
            @click="side = 'layers'"
          />
          <UButton
            data-testid="tab-add"
            label="Add"
            size="xs"
            color="neutral"
            :variant="side === 'add' ? 'soft' : 'ghost'"
            @click="side = 'add'"
          />
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <DesignLayers v-show="side === 'layers'" />
          <DesignPalette v-show="side === 'add'" />
        </div>
      </aside>
      <CanvasFrame />
      <aside class="flex w-80 shrink-0 flex-col border-l border-default">
        <DesignInspector />
      </aside>
    </div>
  </div>
</template>
