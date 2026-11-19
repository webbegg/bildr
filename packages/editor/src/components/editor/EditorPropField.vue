<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Value } from '@bildr/codegen/model'
import type { Provenance } from '@bildr/editor-core/styleFields'
import { FIELD, SELECT_UI } from '../../editorUi.ts'
import { useBinding } from '../../editor/useBinding.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { expressionText, isExpression, isReadableBinding, textProblem, textValue, valueText } from '../../shared/bindings.ts'
import { BINDABLE } from '../../shared/nodeProps.ts'
import type { PropDef } from '../../shared/nodeProps.ts'
import { propOptions } from '../../shared/propGroups.ts'
import { pageOptionLabel } from '../../shared/sidebar.ts'
import { propLock } from '../../shared/stateBinding.ts'

/**
 * One prop row, Framer's label-column look: a grey label (blue when the
 * prop differs from the default; click for Reset to default, Alt-click
 * resets) and the soft control for the prop's kind. Controls carry the
 * prop label as their accessible name; select options that need it (a
 * Button's type) are two-line items with a description (see `propOptions`).
 * `bindable` (a prop of the selected node) puts the binding dot before the
 * label: create or bind a property/variable, bind a name in scope; bound to a
 * property, its chip `◇ Title ×` replaces the control.
 *
 * A text a binding can fill (`BINDABLE`: a Heading's or Button's text, an Image's source) holds
 * `{name}` tokens for the names in scope: the field shows a `{ $bind }` as `{name}`, a
 * `{ $template }` as its text, and gives the text back as the value it means (see
 * `textValue`), so a prop is never a string with `{{ }}`. An empty text removes the prop (`null`).
 * A text the model cannot keep (a name next to a `{brace}` that is none) is refused with a field error, not
 * written and not turned into plain text. An expression the control cannot hold (a name out of scope, a
 * binding on a prop that is not bindable, any expression on a boolean, select, number, icon or page prop) shows
 * as a read-only chip with Unbind, so an edit never replaces it by accident: only Unbind or a new commit does.
 * A link to a page is a `{ page }` value (`to`), the pages of the project listed by name.
 *
 * A prop the node cannot take by hand (`propLock`: the value of a Checkbox that fills a Form field, which the Form gives it) is shown
 * disabled, without the binding dot, and says why under the control.
 */
const props = defineProps<{ def: PropDef, value: Value, changed: boolean, bindable?: boolean }>()
const emit = defineEmits<{ update: [value: Value | null], reset: [] }>()
const editor = useEditor()
const binding = useBinding('prop', () => props.def.name)
/** Bound to a property here: the property's chip takes the control's place. */
const chipped = computed(() => !!props.bindable && !!binding.ownBound.value)
/** Why this prop can't be set or bound by hand on the selected node, when it can't. */
const lock = computed(() => (editor.selected ? propLock(editor.selected.type, props.def.name, editor.selected.props) : undefined))

const provenance = computed<Provenance>(() => (props.changed ? { state: 'set', key: props.def.name, value: valueText(props.value) || (isExpression(props.value) ? expressionText(props.value) : String(props.value)) } : { state: 'unset' }))
const BOOLEAN_ITEMS = [{ value: 'true', label: 'On' }, { value: 'false', label: 'Off' }]

const NONE = '__none'

const text = computed(() => valueText(props.value))
/** The names the selected node can read, when this prop is one a binding can fill. */
const scope = computed(() => {
  const node = editor.selected
  return props.bindable && node && BINDABLE[node.type]?.includes(props.def.name) ? editor.scopeOf(node.id).map(entry => entry.name) : []
})
const TEXT_KINDS = ['text', 'textarea', 'image', 'link']
/** Why the text typed was refused (a field error), until it is edited or the value changes. */
const problem = ref('')
watch(() => props.value, () => {
  problem.value = ''
})
function commitText(entry: string) {
  problem.value = textProblem(entry, scope.value) ?? ''
  if (!problem.value) emit('update', textValue(entry, scope.value))
}
/** An expression the control cannot show or keep: its chip stands in, read-only, with Unbind. */
const expression = computed(() => {
  const value = props.value
  if (!isExpression(value) || (props.def.kind === 'page' && typeof value.page === 'string')) return undefined
  return TEXT_KINDS.includes(props.def.kind) && isReadableBinding(value, scope.value) ? undefined : value
})

const pageItems = computed(() => [{ label: 'None', value: NONE }, ...editor.pages.map(page => ({ label: pageOptionLabel(page), value: page.id }))])
const pageId = computed(() => (isExpression(props.value) && typeof props.value.page === 'string' ? props.value.page : NONE))
const setPage = (id: string) => emit('update', id === NONE ? null : { page: id })

const selectItems = computed(() => {
  const items = propOptions(props.def)
  return text.value && !items.some(item => item.value === text.value) ? [...items, { label: `${text.value} (not an option)`, value: text.value }] : items
})
const setOption = (value: string) => emit('update', props.def.numeric ? Number(value) : value)
</script>

<template>
  <div
    class="group/row grid min-h-[30px] grid-cols-[88px_minmax(0,1fr)] items-start gap-x-2"
    :data-prop-row="def.name"
  >
    <div
      class="relative flex h-[30px] min-w-0 items-center gap-1"
      :data-field-label="def.name"
    >
      <EditorBindingDot
        v-if="bindable && !lock"
        mode="prop"
        :name="def.name"
        :prop="def"
        :value="value"
        @update="emit('update', $event)"
      />
      <EditorFieldLabel
        :label="def.label"
        :title="def.description ?? def.label"
        :provenance="provenance"
        reset-label="Reset to default"
        @reset="emit('reset')"
      />
    </div>
    <div class="min-w-0">
      <EditorBindingValue
        v-if="chipped"
        mode="prop"
        :name="def.name"
      />
      <EditorBindingValue
        v-else-if="expression"
        mode="prop"
        :name="def.name"
        :expression="expression"
        @unbind="emit('update', null)"
      />
      <template v-else-if="TEXT_KINDS.includes(def.kind)">
        <EditorCommitInput
          :model-value="text"
          :multiline="def.kind === 'textarea'"
          :placeholder="def.placeholder ?? (def.kind === 'image' ? 'https://' : undefined)"
          :aria-label="def.label"
          :variables="scope.length > 0"
          :invalid="!!problem"
          size="xs"
          variant="soft"
          @commit="commitText"
          @edit="problem = ''"
        />
        <p
          v-if="problem"
          class="mt-1 text-[12px] leading-4 text-error"
          role="alert"
          data-field-error
        >
          {{ problem }}
        </p>
      </template>
      <EditorIconInput
        v-else-if="def.kind === 'icon'"
        :model-value="text"
        :aria-label="def.label"
        size="xs"
        variant="soft"
        @commit="emit('update', $event === '' ? null : $event)"
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
        :disabled="!!lock"
        :aria-label="def.label"
        @update:model-value="emit('update', $event === 'true')"
      />
      <USelect
        v-else-if="def.kind === 'select'"
        :model-value="text"
        :items="selectItems"
        :aria-label="def.label"
        size="xs"
        variant="soft"
        :ui="SELECT_UI"
        class="w-full"
        @update:model-value="setOption"
      />
      <USelect
        v-else-if="def.kind === 'page'"
        :model-value="pageId"
        :items="pageItems"
        :aria-label="def.label"
        size="xs"
        variant="soft"
        :ui="SELECT_UI"
        class="w-full"
        @update:model-value="setPage"
      />
      <p
        v-if="lock"
        class="mt-1 text-[12px] leading-4 text-dimmed"
        data-prop-locked
      >
        {{ lock }}
      </p>
    </div>
  </div>
</template>
