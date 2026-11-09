<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'
import type { DocNode } from '#shared/document/schema'
import { resolveLink } from '#shared/runtime/render'

/**
 * Renders one document node and its children. The editor canvas and the
 * published app share this component, so what you edit is what ships.
 */
const props = defineProps<{ node: DocNode }>()
const runtime = useRuntime()

const p = computed(() => props.node.props)
const text = (name: string) => String(p.value[name] ?? '')
const link = computed(() => resolveLink(text('to'), runtime.base))
const attrs = computed(() => ({ 'data-bildr-id': props.node.id, 'data-bildr-type': props.node.type, 'style': props.node.style }))
const stacked = computed(() => ['Page', 'Container', 'Column'].includes(props.node.type))

const HEADING_CLASS: Record<string, string> = {
  1: 'text-4xl font-bold tracking-tight',
  2: 'text-3xl font-bold tracking-tight',
  3: 'text-2xl font-semibold',
  4: 'text-xl font-semibold'
}
const level = computed(() => (text('level') in HEADING_CLASS ? text('level') : '2'))
</script>

<template>
  <div
    v-if="stacked || node.type === 'Row'"
    v-bind="attrs"
    class="flex"
    :class="[stacked ? 'flex-col' : 'flex-row', { 'flex-wrap': node.type === 'Row' && p.wrap, 'min-h-full': node.type === 'Page' }]"
  >
    <BildrNode
      v-for="child in node.children"
      :key="child.id"
      :node="child"
    />
    <BildrDropHint
      v-if="runtime.editable && !node.children.length"
      :parent-id="node.id"
    />
  </div>

  <component
    :is="`h${level}`"
    v-else-if="node.type === 'Heading'"
    v-bind="attrs"
    :class="HEADING_CLASS[level]"
  >
    {{ text('text') }}
  </component>

  <p
    v-else-if="node.type === 'Text'"
    v-bind="attrs"
    class="whitespace-pre-line text-toned"
  >
    {{ text('text') }}
  </p>

  <img
    v-else-if="node.type === 'Image'"
    v-bind="attrs"
    :src="text('src')"
    :alt="text('alt')"
    class="block max-w-full"
  >

  <UButton
    v-else-if="node.type === 'Button'"
    v-bind="attrs"
    :label="text('label')"
    :color="text('color') as ButtonProps['color']"
    :variant="text('variant') as ButtonProps['variant']"
    :size="text('size') as ButtonProps['size']"
    :to="link?.to"
    :target="link?.external ? '_blank' : undefined"
    class="self-start"
  />

  <ULink
    v-else-if="node.type === 'Link'"
    v-bind="attrs"
    :to="link?.to"
    :target="link?.external ? '_blank' : undefined"
    class="self-start text-primary underline-offset-4 hover:underline"
  >
    {{ text('label') }}
  </ULink>

  <UFormField
    v-else-if="node.type === 'Input'"
    v-bind="attrs"
    :label="text('label')"
  >
    <UInput
      :placeholder="text('placeholder')"
      :type="text('inputType')"
      class="w-full"
    />
  </UFormField>

  <UCard
    v-else-if="node.type === 'Card'"
    v-bind="attrs"
  >
    <div
      class="flex flex-col"
      :style="{ gap: node.style.gap }"
    >
      <BildrNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
      />
      <BildrDropHint
        v-if="runtime.editable && !node.children.length"
        :parent-id="node.id"
      />
    </div>
  </UCard>

  <div
    v-else
    v-bind="attrs"
    class="text-error text-sm"
  >
    Unknown component "{{ node.type }}"
  </div>
</template>
