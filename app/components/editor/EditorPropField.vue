<script setup lang="ts">
import type { PropDef, PropValue } from '#shared/document/components'
import type { Provenance } from '#shared/editor/styleFields'
import { takesFormRecords } from '#shared/data/collections'
import { enclosingForm, FORM_TYPE } from '#shared/runtime/form'

/**
 * One prop row, Framer's label-column look: a grey label (blue when the
 * prop differs from the component default; click for Reset to default,
 * Alt-click resets) and the soft control for the prop's kind. Controls carry
 * the prop label as their accessible name.
 */
const props = defineProps<{ def: PropDef, value: PropValue, changed: boolean }>()
const emit = defineEmits<{ update: [value: PropValue], reset: [] }>()
const editor = useEditor()

const provenance = computed<Provenance>(() => (props.changed ? { state: 'set', key: props.def.name, value: String(props.value) } : { state: 'unset' }))
const BOOLEAN_ITEMS = [{ value: 'true', label: 'On' }, { value: 'false', label: 'Off' }]

const NONE = '__none'
const EXTERNAL = '__external'

const text = computed(() => String(props.value ?? ''))
const pageSlugs = computed(() => editor.project?.pages.map(p => p.slug) ?? [])
const externalChosen = ref(false)
const linkMode = computed(() => {
  if (externalChosen.value) return EXTERNAL
  if (!text.value) return NONE
  return pageSlugs.value.includes(text.value) ? text.value : EXTERNAL
})
const linkItems = computed(() => [
  { label: 'None', value: NONE },
  ...(editor.project?.pages.map(p => ({ label: `${p.name} (/${p.slug})`, value: p.slug })) ?? []),
  { label: 'External URL', value: EXTERNAL }
])

// A value no option has (e.g. after a delete) stays listed as missing.
const withMissing = (items: { label: string, value: string }[]) =>
  text.value && !items.some(i => i.value === text.value) ? [...items, { label: `${text.value} (missing)`, value: text.value }] : items

// A List's or Form's collection, by slug; a Form creates records, so it only offers the ones that take them.
const collectionItems = computed(() => {
  const forForm = editor.selected?.type === FORM_TYPE
  const collections = editor.project?.collections.filter(c => !forForm || takesFormRecords(c)) ?? []
  return withMissing([{ label: 'None', value: NONE }, ...collections.map(c => ({ label: `${c.name} (${c.slug})`, value: c.slug }))])
})

// An Input's field: inside a Form with a collection, a choice of that collection's fields.
const formCollection = computed(() => {
  const root = editor.page?.root
  const form = root && editor.selected ? enclosingForm(root, editor.selected.id) : undefined
  return form ? editor.project?.collections.find(c => c.slug === form.props.collection) : undefined
})
const fieldItems = computed(() => withMissing([
  { label: 'None', value: NONE },
  ...(formCollection.value?.fields.map(f => ({ label: `${f.label} (${f.key})`, value: f.key })) ?? [])
]))

function onLinkMode(mode: string) {
  externalChosen.value = mode === EXTERNAL
  if (mode === EXTERNAL) return
  emit('update', mode === NONE ? '' : mode)
}
</script>

<template>
  <div
    class="grid min-h-[30px] grid-cols-[88px_minmax(0,1fr)] items-start gap-x-2"
    :data-prop-row="def.name"
  >
    <div
      class="flex h-[30px] min-w-0 items-center"
      :data-field-label="def.name"
    >
      <EditorFieldLabel
        :label="def.label"
        :title="def.description ?? def.label"
        :provenance="provenance"
        reset-label="Reset to default"
        @reset="emit('reset')"
      />
    </div>
    <div class="min-w-0">
      <EditorCommitInput
        v-if="def.kind === 'text' || def.kind === 'textarea' || def.kind === 'image'"
        :model-value="text"
        :multiline="def.kind === 'textarea'"
        :placeholder="def.kind === 'image' ? 'https://' : undefined"
        :aria-label="def.label"
        variables="public"
        size="xs"
        variant="soft"
        @commit="emit('update', $event)"
      />
      <EditorIconInput
        v-else-if="def.kind === 'icon'"
        :model-value="text"
        :aria-label="def.label"
        size="xs"
        variant="soft"
        @commit="emit('update', $event)"
      />
      <UInputNumber
        v-else-if="def.kind === 'number'"
        :model-value="Number(value)"
        :aria-label="def.label"
        size="xs"
        variant="soft"
        :ui="{ base: FIELD }"
        class="w-full"
        @update:model-value="$event != null && emit('update', $event)"
      />
      <EditorSegmented
        v-else-if="def.kind === 'boolean'"
        dense
        :model-value="String(value === true)"
        :items="BOOLEAN_ITEMS"
        :aria-label="def.label"
        @update:model-value="emit('update', $event === 'true')"
      />
      <USelect
        v-else-if="def.kind === 'select'"
        :model-value="text"
        :items="def.options ?? []"
        :aria-label="def.label"
        size="xs"
        variant="soft"
        :ui="SELECT_UI"
        class="w-full"
        @update:model-value="emit('update', $event)"
      />
      <USelect
        v-else-if="def.kind === 'collection'"
        :model-value="text || NONE"
        :items="collectionItems"
        :aria-label="def.label"
        size="xs"
        variant="soft"
        :ui="SELECT_UI"
        class="w-full"
        @update:model-value="emit('update', $event === NONE ? '' : $event)"
      />
      <USelect
        v-else-if="def.kind === 'field' && formCollection"
        :model-value="text || NONE"
        :items="fieldItems"
        :aria-label="def.label"
        size="xs"
        variant="soft"
        :ui="SELECT_UI"
        class="w-full"
        @update:model-value="emit('update', $event === NONE ? '' : $event)"
      />
      <EditorCommitInput
        v-else-if="def.kind === 'field'"
        :model-value="text"
        placeholder="Put this Input in a Form with a collection"
        :aria-label="def.label"
        size="xs"
        variant="soft"
        @commit="emit('update', $event)"
      />
      <div
        v-else-if="def.kind === 'link'"
        class="space-y-1.5"
      >
        <USelect
          :model-value="linkMode"
          :items="linkItems"
          :aria-label="def.label"
          size="xs"
          variant="soft"
          :ui="SELECT_UI"
          class="w-full"
          @update:model-value="onLinkMode"
        />
        <EditorCommitInput
          v-if="linkMode === EXTERNAL"
          :model-value="pageSlugs.includes(text) ? '' : text"
          placeholder="https://example.com"
          :aria-label="`${def.label} URL`"
          variables="public"
          size="xs"
          variant="soft"
          @commit="emit('update', $event)"
        />
      </div>
    </div>
  </div>
</template>
