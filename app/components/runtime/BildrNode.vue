<script setup lang="ts">
import { mergeProps } from 'vue'
import type { ButtonProps } from '@nuxt/ui'
import { displayFallback, parseStyleKey, styleClasses, styleInline } from '#shared/design/tokens'
import { CARD_DEFAULT_STYLE, CARD_STACK_KEYS, DEFAULT_HEADING_LEVEL, displayOf, HEADING_TOKENS, headingTag, IMAGE_FALLBACK_STYLE, INPUT_CONTROL_CLASS, structuralStyle, TEXT_CLASS } from '@bildr/codegen/render'
import type { DocNode } from '#shared/document/schema'
import { hasEnvRefs } from '#shared/env/variables'
import { bindingItem, hasBindings } from '#shared/runtime/bindings'
import type { BindingItem } from '#shared/runtime/bindings'
import { INSTANCE_ID_SEPARATOR, isDefinitionNodeId, MAX_INSTANCE_DEPTH, pageNodeId, resolveInstance } from '#shared/runtime/instances'
import { isLayoutNodeId } from '#shared/runtime/layouts'
import { listKey, listQueryOf } from '#shared/runtime/list'
import { resolveLink } from '#shared/runtime/render'

/**
 * Renders one document node and its children. The editor canvas and the
 * published app share this component, so what you edit is what ships.
 * The per-type render rules it shares with the generator (elements, token
 * fallbacks) live in `@bildr/codegen/render`; where the two still differ,
 * see its `KNOWN_DIVERGENCES`.
 * Visual styling comes only from the node's design tokens (colour keys
 * holding a hex or a theme colour name render as an inline style, since they
 * have no generated class; see `styleInline`); the template
 * adds per-type fallbacks that a token of the same key replaces: the flex
 * direction, and a Row's `wrap` prop as a `flexWrap` token. A base `display`
 * token replaces the template's display class (`flex`, `grid`, `block`), so
 * `hidden` hides the node and `md:flex` shows it again from md up; the
 * editor canvas hides it too, and the layers keep it selectable.
 * Inside a List, string props resolve
 * `{{ item.<field> }}` against the current record; outside one, the canvas
 * shows bindings as written and published apps render them empty.
 * `{{ env.NAME }}` resolves anywhere from the runtime's public variables
 * (see `bindValue`).
 * An Instance renders the tree `resolveInstance` makes from its component
 * definition. Nodes that come from the definition carry the instance's id
 * (`data-bildr-id`), so the canvas selects, hovers and drops on the instance
 * as a whole; slot content keeps its own ids and stays editable. A missing
 * component shows a hint in the canvas and nothing when published.
 * Layout nodes (see `resolvePageWithLayout`) map to the page root the same
 * way and are labelled Layout.
 * A Form is a `<form>` (see BildrForm); its Inputs are named by their field,
 * and a Button's action links, submits the enclosing form, or shows a toast.
 * Outside edit mode (`runtime.interactive`), an Instance whose component has
 * states or interactions renders its current variant (or a hover or pressed
 * state) and hands its root the pointer handlers (`behaviour`; see
 * `useInstanceInteractions`); definition nodes then animate variant changes
 * with an inline `transition`. Nested instances of a definition render as
 * instances of their own there, so they keep their own state.
 * A List with `loadMore` shows a Load more button under its records in
 * published apps and the preview while more follow (`runtime.listMore`).
 */
const props = defineProps<{
  node: DocNode
  /** Set by a vertical stack (Page, Container, Column, Card), whose `items` aligns this node. */
  inStack?: boolean
  /** Attributes and listeners an interactive instance gives the root of its rendered tree. */
  behaviour?: Record<string, unknown>
}>()
const runtime = useRuntime()
const scope = useListItem()
const toast = useToast()
// The node type is stable for a keyed node, so only Instances set up interactions.
const interactions = props.node.type === 'Instance' ? useInstanceInteractions(() => props.node, runtime) : null
const motionTransition = useMotionTransition(() => props.node.id)

const p = computed(() => props.node.props)
const text = (name: string) => bindValue(String(p.value[name] ?? ''), runtime, scope?.item)
// Item values in a link are URL-encoded, so a detail link's key stays one valid path segment.
const link = computed(() => resolveLink(bindValue(String(p.value.to ?? ''), runtime, scope?.item, { link: true }), runtime.base))
const fromDefinition = computed(() => isDefinitionNodeId(props.node.id))
const inline = computed(() => {
  const style: Record<string, string> = styleInline(props.node.style)
  if (motionTransition.value) style.transition = motionTransition.value
  return Object.keys(style).length ? style : undefined
})
const attrs = computed(() => {
  const own = {
    'data-bildr-id': pageNodeId(props.node.id),
    'data-bildr-type': isLayoutNodeId(props.node.id) ? 'Layout' : fromDefinition.value ? 'Instance' : props.node.type,
    'data-bildr-copy': scope?.copy ? '' : undefined,
    // Hex and theme colours; empty for token-only styles, so those render as before.
    'style': inline.value
  }
  return props.behaviour ? mergeProps(own, props.behaviour) : own
})
// A binding the canvas shows as written (or an empty value) is no URL to load.
const imageSrc = computed(() => (hasBindings(text('src')) || hasEnvRefs(text('src')) ? '' : text('src')))
const instance = computed(() => {
  if (props.node.type !== 'Instance') return null
  if (!runtime.interactive) return resolveInstance(props.node, runtime.components ?? [])
  // Linked: nested definition instances stay Instances, cut at the same depth expanding would.
  if (props.node.id.split(INSTANCE_ID_SEPARATOR).length > MAX_INSTANCE_DEPTH) return null
  const variant = interactions?.variant.value
  const node = variant === undefined ? props.node : { ...props.node, props: { ...props.node.props, variant } }
  return resolveInstance(node, runtime.components ?? [], { linked: true })
})
// An instance at the root of another's definition passes the outer handlers on after its own,
// so the inner one handles a click first (see `useInstanceInteractions`).
const rootBehaviour = computed(() => {
  const own = interactions?.rootAttrs.value
  return props.behaviour && own ? mergeProps(own, props.behaviour) : props.behaviour ?? own
})
// Containers of a definition take no drops: the instance is the page node.
const dropParent = computed(() => runtime.editable && !fromDefinition.value && !props.node.children.length)
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
const rowWrap = computed((): Record<string, string> => (props.node.type === 'Row' && p.value.wrap ? { flexWrap: 'wrap' } : {}))
const tokens = computed(() => withFallback({ ...structuralStyle(props.node.type), ...rowWrap.value }))
const display = (fallback: string) => displayFallback(fallback, props.node.style)

const level = computed(() => (text('level') in HEADING_TOKENS ? text('level') : String(DEFAULT_HEADING_LEVEL)))

// The card's gap and items lay out its inner stack; every other token styles the card
// itself. Its padding is a token too (UCard's body padding is zeroed), so `p-8`
// replaces the default instead of adding to it. Breakpoint variants follow their base key.
const card = computed(() => {
  const entries = Object.entries(props.node.style)
  const inStack = ([key]: [string, string]) => CARD_STACK_KEYS.includes(parseStyleKey(key)?.token.key ?? '')
  const stack = Object.fromEntries(entries.filter(inStack))
  const rest = Object.fromEntries(entries.filter(entry => !inStack(entry)))
  return { root: styleClasses({ ...selfFallback.value, ...CARD_DEFAULT_STYLE, ...rest }), stack: styleClasses({ ...structuralStyle('Card'), ...stack }) }
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
  const key = listKey(query)
  const records = query.collection ? runtime.lists[key] : undefined
  const layout = String(p.value.layout ?? '') in LIST_LAYOUTS ? String(p.value.layout) : 'stack'
  const items: (BindingItem | null)[] = records?.length ? records.map(bindingItem) : runtime.editable ? [null] : []
  const hint = !query.collection ? 'Choose a collection for this List' : !records ? `No collection "${query.collection}"` : null
  // Load more: published apps and the preview only; the canvas shows `limit` records.
  const state = !runtime.editable && query.loadMore && runtime.loadMore ? runtime.listMore?.[key] : undefined
  const more = state && (state.more || state.failed) ? state : null
  return { key, layout, items, hint, placeholder: !records?.length, more }
})
</script>

<template>
  <template v-if="node.type === 'Instance'">
    <BildrNode
      v-if="instance"
      :node="instance"
      :in-stack="inStack"
      :behaviour="rootBehaviour"
    />
    <div
      v-else-if="runtime.editable"
      v-bind="attrs"
      class="text-error text-sm"
    >
      Missing component
    </div>
  </template>

  <div
    v-else-if="stacked || node.type === 'Row'"
    v-bind="attrs"
    :class="[display(displayOf(node.type)), { 'min-h-full': node.type === 'Page' }, tokens]"
  >
    <BildrNode
      v-for="child in node.children"
      :key="child.id"
      :node="child"
      :in-stack="stacked"
    />
    <BildrDropHint
      v-if="dropParent"
      :parent-id="node.id"
    />
  </div>

  <div
    v-else-if="node.type === 'Grid'"
    v-bind="attrs"
    :class="[display(displayOf(node.type)), tokens]"
  >
    <BildrNode
      v-for="child in node.children"
      :key="child.id"
      :node="child"
    />
    <BildrDropHint
      v-if="dropParent"
      :parent-id="node.id"
    />
  </div>

  <component
    :is="headingTag(level)"
    v-else-if="node.type === 'Heading'"
    v-bind="attrs"
    :class="withFallback(HEADING_TOKENS[level]!)"
  >
    {{ text('text') }}
  </component>

  <p
    v-else-if="node.type === 'Text'"
    v-bind="attrs"
    :class="[TEXT_CLASS, tokens]"
  >
    {{ text('text') }}
  </p>

  <img
    v-else-if="node.type === 'Image'"
    v-bind="attrs"
    :src="imageSrc || undefined"
    :alt="text('alt')"
    :class="[display(displayOf(node.type)), withFallback(IMAGE_FALLBACK_STYLE), { 'min-h-24 bg-elevated': !imageSrc }]"
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
      :class="INPUT_CONTROL_CLASS"
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
    <!-- Under the records whatever the layout: a full row of a grid, its own line in a row. -->
    <div
      v-if="list.more"
      class="col-span-full flex w-full basis-full flex-col items-center gap-2 self-stretch"
      data-bildr-load-more
    >
      <!-- Never `disabled` (nor UButton's `loading`, which disables it) while loading: that would drop the keyboard focus to the body. `loadMore` ignores clicks while a read is in flight. -->
      <UButton
        label="Load more"
        :icon="list.more.loading ? 'i-lucide-loader-circle' : undefined"
        :ui="{ leadingIcon: 'animate-spin' }"
        :aria-disabled="list.more.loading || undefined"
        :aria-busy="list.more.loading || undefined"
        @click="list.more.loading || runtime.loadMore?.(list.key)"
      />
      <p
        v-if="list.more.failed && !list.more.loading"
        role="alert"
        class="text-sm text-error"
      >
        Could not load more, try again later
      </p>
    </div>
    <BildrDropHint
      v-if="dropParent"
      :parent-id="node.id"
    />
  </div>

  <BildrForm
    v-else-if="node.type === 'Form'"
    v-bind="attrs"
    :node="node"
    :class="[display(displayOf(node.type)), tokens]"
  >
    <BildrNode
      v-for="child in node.children"
      :key="child.id"
      :node="child"
      in-stack
    />
    <BildrDropHint
      v-if="dropParent"
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
        v-if="dropParent"
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
