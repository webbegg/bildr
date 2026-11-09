<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'
import { styleClasses } from '#shared/design/tokens'
import type { DocNode } from '#shared/document/schema'
import { resolveLink } from '#shared/runtime/render'

/**
 * Renders one document node and its children. The editor canvas and the
 * published app share this component, so what you edit is what ships.
 * Visual styling comes only from the node's design tokens; the template
 * adds structural classes (flex direction, wrapping) and per-type fallbacks
 * that a token of the same key replaces.
 */
const props = defineProps<{ node: DocNode }>()
const runtime = useRuntime()

const p = computed(() => props.node.props)
const text = (name: string) => String(p.value[name] ?? '')
const link = computed(() => resolveLink(text('to'), runtime.base))
const attrs = computed(() => ({ 'data-bildr-id': props.node.id, 'data-bildr-type': props.node.type }))
const stacked = computed(() => ['Page', 'Container', 'Column'].includes(props.node.type))
const tokens = computed(() => styleClasses(props.node.style))
const withFallback = (fallback: Record<string, string>) => styleClasses({ ...fallback, ...props.node.style })

const HEADING_TOKENS: Record<string, Record<string, string>> = {
  1: { text: '4xl', font: 'bold' },
  2: { text: '3xl', font: 'bold' },
  3: { text: '2xl', font: 'semibold' },
  4: { text: 'xl', font: 'semibold' }
}
const level = computed(() => (text('level') in HEADING_TOKENS ? text('level') : '2'))

// The card's gap spaces its inner stack; every other token styles the card itself.
// Its padding is a token too (UCard's body padding is zeroed), so `p-8` replaces
// the default instead of adding to it.
const card = computed(() => {
  const { gap, ...rest } = props.node.style
  return { root: styleClasses({ p: '6', ...rest }), stack: gap ? styleClasses({ gap }) : '' }
})
const CARD_UI = { body: 'p-0 sm:p-0' }
</script>

<template>
  <div
    v-if="stacked || node.type === 'Row'"
    v-bind="attrs"
    class="flex"
    :class="[stacked ? 'flex-col' : 'flex-row', { 'flex-wrap': node.type === 'Row' && p.wrap, 'min-h-full': node.type === 'Page' }, tokens]"
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
    :class="[{ 'tracking-tight': Number(level) <= 2 }, withFallback(HEADING_TOKENS[level]!)]"
  >
    {{ text('text') }}
  </component>

  <p
    v-else-if="node.type === 'Text'"
    v-bind="attrs"
    class="whitespace-pre-line"
    :class="tokens"
  >
    {{ text('text') }}
  </p>

  <img
    v-else-if="node.type === 'Image'"
    v-bind="attrs"
    :src="text('src')"
    :alt="text('alt')"
    class="block"
    :class="withFallback({ maxW: 'full' })"
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
    :class="tokens"
  />

  <ULink
    v-else-if="node.type === 'Link'"
    v-bind="attrs"
    :to="link?.to"
    :target="link?.external ? '_blank' : undefined"
    class="self-start underline-offset-4 hover:underline"
    :class="tokens"
  >
    {{ text('label') }}
  </ULink>

  <UFormField
    v-else-if="node.type === 'Input'"
    v-bind="attrs"
    :label="text('label')"
    :class="tokens"
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
    :class="card.root"
    :ui="CARD_UI"
  >
    <div
      class="flex flex-col"
      :class="card.stack"
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
