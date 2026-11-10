<script setup lang="ts">
import { PAGING_PARAM_HINT, PAGING_TYPES } from '#shared/data/paging'
import { draftPaging, PAGING_TYPE_LABELS, pagingDraft, retypeDraft } from '#shared/data/table'
import type { PagingDraft } from '#shared/data/table'
import type { Paging } from '#shared/document/schema'

/**
 * A list's paging as panel rows: the type (None, Page number, Offset, Cursor,
 * Next link), then that type's params and paths. Edits stay a draft until it
 * is a valid paging, then emit `change` (null for None); what it lacks shows
 * under the rows. The `actions` slot sits next to the type, the default slot
 * under everything (test results).
 */
const props = defineProps<{ paging?: Paging | null }>()
const emit = defineEmits<{ change: [paging: Paging | null] }>()

const TYPES = [{ label: 'None', value: 'none' }, ...PAGING_TYPES.map(type => ({ label: PAGING_TYPE_LABELS[type], value: type }))]
const STARTS = [{ label: '1', value: '1' }, { label: '0', value: '0' }]

const draft = ref<PagingDraft>(pagingDraft(props.paging))
/** The paging last emitted: when it comes back as the prop, the draft keeps the other types' fields. */
let emitted = ''
watch(() => JSON.stringify(props.paging ?? null), (json) => {
  if (json !== emitted) draft.value = pagingDraft(props.paging)
  emitted = ''
})

const result = computed(() => draftPaging(draft.value))
const problem = computed(() => ('problem' in result.value ? result.value.problem : ''))
const type = computed(() => draft.value.type)

function update(next: PagingDraft) {
  draft.value = next
  const parsed = draftPaging(next)
  if (!('paging' in parsed)) return
  const json = JSON.stringify(parsed.paging)
  if (json === JSON.stringify(props.paging ?? null)) return
  emitted = json
  emit('change', parsed.paging)
}

function set(key: keyof PagingDraft, value: string) {
  if (draft.value[key] !== value) update({ ...draft.value, [key]: value })
}
</script>

<template>
  <EditorRow
    label="Paging"
    title="How the API splits the list over requests"
    name="paging"
    data-paging
  >
    <EditorSelect
      :model-value="type"
      :items="TYPES"
      aria-label="Paging type"
      class="min-w-0 flex-1"
      data-paging-type
      @update:model-value="update(retypeDraft(draft, $event as PagingDraft['type']))"
    />
    <slot name="actions" />
  </EditorRow>
  <EditorRow
    v-if="type === 'page' || type === 'offset' || type === 'cursor'"
    label="Param"
    :title="type === 'cursor' ? 'The query parameter that takes the cursor' : 'The query parameter of the page number or offset'"
    name="paging-param"
  >
    <EditorInput
      :model-value="draft.param"
      mono
      commit="change"
      :placeholder="type"
      :title="PAGING_PARAM_HINT"
      aria-label="Paging parameter"
      class="min-w-0 flex-1"
      data-paging-field="param"
      @commit="set('param', $event)"
    />
  </EditorRow>
  <EditorRow
    v-if="type === 'page'"
    label="Start"
    title="The first page's number"
    name="paging-start"
  >
    <EditorSelect
      :model-value="draft.start"
      :items="STARTS"
      mono
      aria-label="First page number"
      class="min-w-0 flex-1"
      data-paging-field="start"
      @update:model-value="set('start', $event)"
    />
  </EditorRow>
  <template v-if="type === 'page' || type === 'offset'">
    <EditorRow
      label="Size param"
      title="The query parameter of the page size"
      name="paging-size-param"
    >
      <EditorInput
        :model-value="draft.sizeParam"
        mono
        commit="change"
        :placeholder="type === 'page' ? 'per_page' : 'limit'"
        :title="PAGING_PARAM_HINT"
        aria-label="Page size parameter"
        class="min-w-0 flex-1"
        data-paging-field="sizeParam"
        @commit="set('sizeParam', $event)"
      />
    </EditorRow>
    <EditorRow
      label="Size"
      title="Items per page"
      name="paging-size"
    >
      <EditorInput
        :model-value="draft.size"
        mono
        commit="change"
        type="number"
        placeholder="20"
        aria-label="Page size"
        class="min-w-0 flex-1"
        data-paging-field="size"
        @commit="set('size', $event)"
      />
    </EditorRow>
  </template>
  <EditorRow
    v-if="type === 'cursor'"
    label="Cursor path"
    title="Where the next cursor is in the response"
    name="paging-cursor-path"
  >
    <EditorInput
      :model-value="draft.cursorPath"
      mono
      commit="change"
      placeholder="meta.next_cursor"
      aria-label="Cursor path"
      class="min-w-0 flex-1"
      data-paging-field="cursorPath"
      @commit="set('cursorPath', $event)"
    />
  </EditorRow>
  <EditorRow
    v-if="type === 'next'"
    label="Next path"
    title="Where the next page's URL is in the response; empty for the Link header"
    name="paging-next-path"
  >
    <EditorInput
      :model-value="draft.nextPath"
      mono
      commit="change"
      placeholder="Link header"
      aria-label="Next page path"
      class="min-w-0 flex-1"
      data-paging-field="nextPath"
      @commit="set('nextPath', $event)"
    />
  </EditorRow>
  <EditorRow
    v-if="type !== 'none'"
    label="Total path"
    title="Where the total item count is in the response (optional)"
    name="paging-total-path"
  >
    <EditorInput
      :model-value="draft.totalPath"
      mono
      commit="change"
      placeholder="info.count"
      aria-label="Total path"
      class="min-w-0 flex-1"
      data-paging-field="totalPath"
      @commit="set('totalPath', $event)"
    />
  </EditorRow>
  <p
    v-if="problem"
    class="ms-24 text-[11px] leading-4 text-error"
    data-paging-problem
  >
    {{ problem }}
  </p>
  <slot />
</template>
