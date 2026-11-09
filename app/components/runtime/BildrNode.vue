<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'
import { displayFallback, parseStyleKey, styleClasses } from '#shared/design/tokens'
import { structuralStyle } from '#shared/document/components'
import type { DocNode } from '#shared/document/schema'
import { bindingItem, hasBindings, resolveBindings } from '#shared/runtime/bindings'
import type { BindingItem } from '#shared/runtime/bindings'
import { listKey, listQueryOf } from '#shared/runtime/list'
import { resolveLink } from '#shared/runtime/render'

/**
 * Renders one document node and its children. The editor canvas and the
 * published app share this component, so what you edit is what ships.
 * Visual styling comes only from the node's design tokens; the template
 * adds structural classes (wrapping) and per-type fallbacks that a token of
 * the same key replaces, the flex direction among them. A base `display`
 * token replaces the template's display class (`flex`, `grid`, `block`), so
 * `hidden` hides the node and `md:flex` shows it again from md up; the
 * editor canvas hides it too, and the layers keep it selectable.
 * Inside a List, string props resolve
 * `{{ item.<field> }}` against the current record; outside one, the canvas
 * shows bindings as written and published apps render them empty.
 * A Form is a `<form>` (see BildrForm); its Inputs are named by their field,
 * and a Button's action links, submits the enclosing form, or shows a toast.
 */
const props = defineProps<{
  node: DocNode
  /** Set by a vertical stack (Page, Container, Column, Card), whose `items` aligns this node. */
  inStack?: boolean
}>()
const runtime = useRuntime()
const scope = useListItem()
const toast = useToast()

const p = computed(() => props.node.props)
function bind(value: string): string {
  if (scope?.item) return resolveBindings(value, { item: scope.item })
  return runtime.editable ? value : resolveBindings(value, {})
}
const text = (name: string) => bind(String(p.value[name] ?? ''))
const link = computed(() => resolveLink(text('to'), runtime.base))
const attrs = computed(() => ({
  'data-bildr-id': props.node.id,
  'data-bildr-type': props.node.type,
  'data-bildr-copy': scope?.copy ? '' : undefined
}))
// A binding the canvas shows as written (or an empty value) is no URL to load.
const imageSrc = computed(() => (hasBindings(text('src')) ? '' : text('src')))
const stacked = computed(() => ['Page', 'Container', 'Column'].includes(props.node.type))

// In a stack, block-level nodes fill the width whatever the stack's `items`, so sections
// and fields keep spanning their parent; text only does so when it sets an alignment.
// Buttons, links and short text follow the stack's `items`. A `self` token overrides both.
const BLOCK_TYPES = ['Container', 'Row', 'Column', 'Grid', 'List', 'Form', 'Card', 'Input']
const selfFallback = computed((): Record<string, string> => {
  const { type, style } = props.node
  const aligned = Object.keys(style).some(key => parseStyleKey(key)?.token.key === 'align')
  const fills = BLOCK_TYPES.includes(type) || (['Heading', 'Text'].includes(type) && aligned)
  return props.inStack && fills ? { self: 'stretch' } : {}
})
const withFallback = (fallback: Record<string, string>) => styleClasses({ ...selfFallback.value, ...fallback, ...props.node.style })
const tokens = computed(() => withFallback(structuralStyle(props.node.type)))
const display = (fallback: string) => displayFallback(fallback, props.node.style)

const HEADING_TOKENS: Record<string, Record<string, string>> = {
  1: { text: '4xl', font: 'bold' },
  2: { text: '3xl', font: 'bold' },
  3: { text: '2xl', font: 'semibold' },
  4: { text: 'xl', font: 'semibold' }
}
const level = computed(() => (text('level') in HEADING_TOKENS ? text('level') : '2'))

// The card's gap and items lay out its inner stack; every other token styles the card
// itself. Its padding is a token too (UCard's body padding is zeroed), so `p-8`
// replaces the default instead of adding to it. Breakpoint variants follow their base key.
const STACK_KEYS = ['direction', 'gap', 'items', 'justify']
const card = computed(() => {
  const entries = Object.entries(props.node.style)
  const inStack = ([key]: [string, string]) => STACK_KEYS.includes(parseStyleKey(key)?.token.key ?? '')
  const stack = Object.fromEntries(entries.filter(inStack))
  const rest = Object.fromEntries(entries.filter(entry => !inStack(entry)))
  return { root: styleClasses({ ...selfFallback.value, p: '6', ...rest }), stack: styleClasses({ ...structuralStyle('Card'), ...stack }) }
})
const icon = (name: string) => text(name) || undefined

// Only link buttons navigate; the others are plain buttons, and only submit ones send a form.
const buttonAction = computed(() => (['submit', 'toast'].includes(text('action')) ? text('action') : 'link'))
function onButtonClick() {
  if (runtime.editable || buttonAction.value !== 'toast') return
  toast.add({ title: text('message') || text('label'), icon: 'i-lucide-info' })
}
const CARD_UI = { body: 'p-0 sm:p-0' }

// A List repeats its children per record of its query. In the canvas, an empty or
// unknown collection shows the children once as a placeholder (bindings as written).
const LIST_LAYOUTS: Record<string, string> = { stack: 'flex-col', grid: '', row: 'flex-row flex-wrap' }
const list = computed(() => {
  if (props.node.type !== 'List') return null
  const query = listQueryOf(p.value)
  const records = query.collection ? runtime.lists[listKey(query)] : undefined
  const layout = String(p.value.layout ?? '') in LIST_LAYOUTS ? String(p.value.layout) : 'stack'
  const items: (BindingItem | null)[] = records?.length ? records.map(bindingItem) : runtime.editable ? [null] : []
  const hint = !query.collection ? 'Choose a collection for this List' : !records ? `No collection "${query.collection}"` : null
  return { layout, items, hint, placeholder: !records?.length }
})
</script>

<template>
  <div
    v-if="stacked || node.type === 'Row'"
    v-bind="attrs"
    :class="[display('flex'), { 'flex-wrap': node.type === 'Row' && p.wrap, 'min-h-full': node.type === 'Page' }, tokens]"
  >
    <BildrNode
      v-for="child in node.children"
      :key="child.id"
      :node="child"
      :in-stack="stacked"
    />
    <BildrDropHint
      v-if="runtime.editable && !node.children.length"
      :parent-id="node.id"
    />
  </div>

  <div
    v-else-if="node.type === 'Grid'"
    v-bind="attrs"
    :class="[display('grid'), tokens]"
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
    :src="imageSrc || undefined"
    :alt="text('alt')"
    :class="[display('block'), withFallback({ maxW: 'full' }), { 'min-h-24 bg-elevated': !imageSrc }]"
  >

  <UButton
    v-else-if="node.type === 'Button'"
    v-bind="attrs"
    :label="text('label')"
    :color="text('color') as ButtonProps['color']"
    :variant="text('variant') as ButtonProps['variant']"
    :size="text('size') as ButtonProps['size']"
    :icon="icon('icon')"
    :trailing-icon="icon('trailingIcon')"
    :to="buttonAction === 'link' ? link?.to : undefined"
    :target="buttonAction === 'link' && link?.external ? '_blank' : undefined"
    :type="buttonAction === 'submit' ? 'submit' : 'button'"
    :class="tokens"
    @click="onButtonClick"
  />

  <ULink
    v-else-if="node.type === 'Link'"
    v-bind="attrs"
    :to="link?.to"
    :target="link?.external ? '_blank' : undefined"
    class="underline-offset-4 hover:underline"
    :class="[icon('icon') && ['items-center gap-1', display('inline-flex')], tokens]"
  >
    <UIcon
      v-if="icon('icon')"
      :name="icon('icon')!"
      class="size-[1em] shrink-0"
    />
    {{ text('label') }}
  </ULink>

  <UFormField
    v-else-if="node.type === 'Input'"
    v-bind="attrs"
    :label="text('label')"
    :class="tokens"
  >
    <UInput
      :name="text('field') || undefined"
      :placeholder="text('placeholder')"
      :type="text('inputType')"
      class="w-full"
    />
  </UFormField>

  <!-- A published List without records renders nothing. -->
  <div
    v-else-if="list && (runtime.editable || list.items.length)"
    v-bind="attrs"
    :class="[display(list.layout === 'grid' ? 'grid' : 'flex'), LIST_LAYOUTS[list.layout], tokens]"
  >
    <p
      v-if="runtime.editable && list.hint"
      class="col-span-full w-full self-stretch rounded-sm border border-dashed border-warning/50 px-2 py-1 text-xs text-warning"
    >
      {{ list.hint }}
    </p>
    <BildrListItem
      v-for="(item, i) in list.items"
      :key="String(item?.id ?? i)"
      :item="item"
      :copy="i > 0"
    >
      <BildrNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :in-stack="list.layout === 'stack'"
        :class="{ 'opacity-60': list.placeholder }"
      />
    </BildrListItem>
    <BildrDropHint
      v-if="runtime.editable && !node.children.length"
      :parent-id="node.id"
    />
  </div>

  <BildrForm
    v-else-if="node.type === 'Form'"
    v-bind="attrs"
    :node="node"
    :class="[display('flex'), tokens]"
  >
    <BildrNode
      v-for="child in node.children"
      :key="child.id"
      :node="child"
      in-stack
    />
    <BildrDropHint
      v-if="runtime.editable && !node.children.length"
      :parent-id="node.id"
    />
  </BildrForm>

  <UCard
    v-else-if="node.type === 'Card'"
    v-bind="attrs"
    :class="card.root"
    :ui="CARD_UI"
  >
    <div
      class="flex"
      :class="card.stack"
    >
      <BildrNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        in-stack
      />
      <BildrDropHint
        v-if="runtime.editable && !node.children.length"
        :parent-id="node.id"
      />
    </div>
  </UCard>

  <div
    v-else-if="node.type !== 'List'"
    v-bind="attrs"
    class="text-error text-sm"
  >
    Unknown component "{{ node.type }}"
  </div>
</template>
