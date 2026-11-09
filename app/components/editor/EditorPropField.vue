<script setup lang="ts">
import type { PropDef, PropValue } from '#shared/document/components'
import { enclosingForm, FORM_TYPE } from '#shared/runtime/form'

const props = defineProps<{ def: PropDef, value: PropValue }>()
const emit = defineEmits<{ update: [value: PropValue] }>()
const editor = useEditor()

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

// A List's or Form's collection, by slug; a Form writes records, so it only offers internal ones.
const collectionItems = computed(() => {
  const forForm = editor.selected?.type === FORM_TYPE
  const collections = editor.project?.collections.filter(c => !forForm || c.source.type === 'internal') ?? []
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
  <UFormField
    :label="def.label"
    :help="def.description"
    size="sm"
  >
    <EditorCommitInput
      v-if="def.kind === 'text' || def.kind === 'textarea' || def.kind === 'image'"
      :model-value="text"
      :multiline="def.kind === 'textarea'"
      :placeholder="def.kind === 'image' ? 'https://' : undefined"
      @commit="emit('update', $event)"
    />
    <EditorIconInput
      v-else-if="def.kind === 'icon'"
      :model-value="text"
      @commit="emit('update', $event)"
    />
    <UInputNumber
      v-else-if="def.kind === 'number'"
      :model-value="Number(value)"
      size="sm"
      class="w-full"
      @update:model-value="$event != null && emit('update', $event)"
    />
    <USwitch
      v-else-if="def.kind === 'boolean'"
      :model-value="value === true"
      @update:model-value="emit('update', $event)"
    />
    <USelect
      v-else-if="def.kind === 'select'"
      :model-value="text"
      :items="def.options ?? []"
      size="sm"
      class="w-full"
      @update:model-value="emit('update', $event)"
    />
    <USelect
      v-else-if="def.kind === 'collection'"
      :model-value="text || NONE"
      :items="collectionItems"
      size="sm"
      class="w-full"
      @update:model-value="emit('update', $event === NONE ? '' : $event)"
    />
    <USelect
      v-else-if="def.kind === 'field' && formCollection"
      :model-value="text || NONE"
      :items="fieldItems"
      size="sm"
      class="w-full"
      @update:model-value="emit('update', $event === NONE ? '' : $event)"
    />
    <EditorCommitInput
      v-else-if="def.kind === 'field'"
      :model-value="text"
      placeholder="Put this Input in a Form with a collection"
      @commit="emit('update', $event)"
    />
    <div
      v-else-if="def.kind === 'link'"
      class="space-y-1.5"
    >
      <USelect
        :model-value="linkMode"
        :items="linkItems"
        size="sm"
        class="w-full"
        @update:model-value="onLinkMode"
      />
      <EditorCommitInput
        v-if="linkMode === EXTERNAL"
        :model-value="pageSlugs.includes(text) ? '' : text"
        placeholder="https://example.com"
        @commit="emit('update', $event)"
      />
    </div>
  </UFormField>
</template>
