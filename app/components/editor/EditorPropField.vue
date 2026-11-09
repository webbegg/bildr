<script setup lang="ts">
import type { PropDef, PropValue } from '#shared/document/components'

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
