<script setup lang="ts">
import { inject } from 'vue'
import { useRouter } from 'vue-router'
import { targetKey } from '../editor/findingTargets.ts'
import type { Target } from '../editor/findingTargets.ts'
import { openTarget } from '../editor/openTarget.ts'
import { EDITOR_KEY } from '../editor/useEditor.ts'

/**
 * The links of a finding, a drift item or a model problem (S8): "Open in Code", "Open Collection Post". Clicking opens the target (`openTarget`): a route is pushed;
 * a page, a component or a layout opens on the canvas, through the editor of the screen when there is one (the Data and Design screens) or by opening the Design
 * screen (the Checks screen).
 */
defineProps<{ targets: Target[] }>()

const router = useRouter()
const editor = inject(EDITOR_KEY, null)

const open = (target: Target) => openTarget(target, { push: to => router.push(to), editor })
</script>

<template>
  <span
    v-if="targets.length"
    class="ml-1 inline-flex flex-wrap items-center gap-x-3"
    data-target-links
  >
    <UButton
      v-for="target in targets"
      :key="targetKey(target)"
      :label="target.label"
      size="xs"
      color="neutral"
      variant="link"
      class="p-0"
      data-testid="target-link"
      :data-target="targetKey(target)"
      @click="open(target)"
    />
  </span>
</template>
