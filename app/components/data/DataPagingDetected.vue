<script setup lang="ts">
import type { PageTwo } from '#shared/data/paging'
import { pageTwoText, pagingSummary } from '#shared/data/table'
import type { Paging } from '#shared/document/schema'

/**
 * The source dialogs' Paging row: the paging a Test proposed (or the saved
 * one) with what page two gave, a switch to save it (on by default) and Edit,
 * which opens the paging fields under the row. `detected` names it a
 * proposal; `total` is the API's item count, when the test read it.
 */
const props = defineProps<{ pageTwo?: PageTwo | null, detected?: boolean, total?: number | null }>()
const paging = defineModel<Paging | null>('paging', { required: true })
const use = defineModel<boolean>('use', { default: true })
const editing = ref(false)

const summary = computed(() => {
  if (!paging.value) return 'No paging'
  const known = paging.value.totalPath && typeof props.total === 'number'
  const text = pagingSummary(known ? { ...paging.value, totalPath: undefined } : paging.value)
  return `${props.detected ? 'Paging detected' : 'Paging'}: ${text}${known ? ` · ${props.total} ${props.total === 1 ? 'item' : 'items'}` : ''}`
})
</script>

<template>
  <EditorFormRow
    v-if="paging || editing"
    label="Paging"
    :help="pageTwo && pageTwoText(pageTwo).ok ? pageTwoText(pageTwo).text : undefined"
    :error="pageTwo && !pageTwoText(pageTwo).ok ? pageTwoText(pageTwo).text : undefined"
  >
    <p
      class="min-w-0 flex-1 truncate text-[12px]"
      :class="paging && use ? 'text-toned' : 'text-dimmed'"
      data-paging-detected
    >
      {{ summary }}
    </p>
    <EditorSwitch
      v-if="paging"
      v-model="use"
      aria-label="Use paging"
      data-paging-use
    />
    <EditorButton
      :label="editing ? 'Done' : 'Edit'"
      variant="ghost"
      size="xs"
      data-paging-edit
      @click="editing = !editing"
    />
  </EditorFormRow>
  <div
    v-if="editing"
    class="ms-[132px] max-w-sm space-y-2"
    data-paging-editor
  >
    <DataPagingFields
      :paging="paging"
      @change="paging = $event"
    />
  </div>
</template>
