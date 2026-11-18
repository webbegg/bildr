<script setup lang="ts">
import { inject } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from '@nuxt/ui/composables/useToast'
import { targetKey } from '../editor/findingTargets.ts'
import type { Target } from '../editor/findingTargets.ts'
import { openTarget } from '../editor/openTarget.ts'
import { EDITOR_KEY } from '../editor/useEditor.ts'
import { STATUS_KEY } from '../status.ts'

/**
 * The links of a finding, a drift item or a model problem (S8): "Open file in Code", "Open page “index”". Clicking opens the target (`openTarget`, which opens an item
 * as every item is opened, asks before it leaves unsaved edits and says when what it links to is gone). Where there is no editor (the Checks screen) the model it
 * reads that from is the shared status's.
 */
defineProps<{ targets: Target[] }>()

const router = useRouter()
const toast = useToast()
const editor = inject(EDITOR_KEY, null)
const status = inject(STATUS_KEY, null)

const open = (target: Target) => {
  const push = (to: Parameters<typeof router.push>[0]) => router.push(to)
  void openTarget(target, editor ? { editor, push, notify: toast.add } : { editor: null, push, model: status?.model.value ?? null, notify: toast.add })
}
</script>

<template>
  <span
    v-if="targets.length"
    class="ml-2 inline-flex flex-wrap items-center gap-x-1.5"
    data-target-links
  >
    <template
      v-for="(target, index) in targets"
      :key="targetKey(target)"
    >
      <span
        v-if="index"
        class="text-dimmed"
        aria-hidden="true"
      >·</span>
      <button
        type="button"
        class="rounded-sm text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        data-testid="target-link"
        :data-target="targetKey(target)"
        @click="open(target)"
      >
        {{ target.label }}
      </button>
    </template>
  </span>
</template>
