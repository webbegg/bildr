<script setup lang="ts">
import { computed } from 'vue'
import type { EditorOption } from '../../../editorUi.ts'
import { defaultLiteral, exprOf, literalOf } from '../../../editor/stepScope.ts'
import type { StepScope } from '../../../editor/stepScope.ts'
import type { FieldType } from '../../../shared/dataModel.ts'

/**
 * A value of a step (S10, D10c): the small picker of what a step may read at its place. A field of the action's input
 * (`$input`), a row an earlier step loaded or a field of it (`$var`), now (`$now`), empty, or a value typed by the type of the
 * field it is for. What is offered is `scope` (`editor/stepScope.ts`): a name a later step gives is not there. A value the form
 * does not edit (a condition with `then` and `else`) is shown as it is and kept until another is picked. `rows` offers only the
 * rows themselves, not their fields.
 */
type Source = 'input' | 'var' | 'now' | 'empty' | 'literal'
const { value, scope, type, label, allow = ['input', 'var', 'now', 'empty', 'literal'], rows = false } = defineProps<{
  value: unknown
  scope: StepScope
  /** The type of the field the value is for: what a typed value is checked and entered as. */
  type?: FieldType
  /** Names the pickers for assistive technology, and in the tests: "the id of the lookup". */
  label: string
  allow?: Source[]
  rows?: boolean
}>()
const emit = defineEmits<{ 'update:value': [value: unknown] }>()

const expr = computed(() => exprOf(value))
/** The option the select shows: where the value comes from, with the name for an input or a variable. */
const current = computed(() => {
  const found = expr.value
  return found.kind === 'none' ? '' : found.kind === 'input' || found.kind === 'var' ? `${found.kind}:${found.path}` : found.kind
})

const options = computed<EditorOption[]>(() => {
  const list: EditorOption[] = []
  if (allow.includes('input')) list.push(...scope.input.map(entry => ({ value: `input:${entry.path}`, label: `Input: ${entry.path}` })))
  if (allow.includes('var')) list.push(...scope.vars.filter(entry => !rows || entry.row !== undefined).map(entry => ({ value: `var:${entry.path}`, label: `Variable: ${entry.path}` })))
  if (allow.includes('now')) list.push({ value: 'now', label: 'Now' })
  if (allow.includes('empty')) list.push({ value: 'empty', label: 'Empty' })
  if (allow.includes('literal')) list.push({ value: 'literal', label: 'A value…' })
  const found = expr.value
  // What is stored stays visible when the choices do not have it: a variable that is no longer loaded, a computed value.
  if (found.kind !== 'none' && !list.some(option => option.value === current.value)) {
    list.push({ value: current.value, label: found.kind === 'computed' ? 'Computed value' : found.kind === 'input' ? `Input: ${found.path}` : found.kind === 'var' ? `Variable: ${found.path}` : found.kind === 'literal' ? 'A value…' : found.kind === 'now' ? 'Now' : 'Empty' })
  }
  return list
})

function pick(source: string) {
  if (source === current.value) return
  if (source.startsWith('input:')) emit('update:value', { $input: source.slice('input:'.length) })
  else if (source.startsWith('var:')) emit('update:value', { $var: source.slice('var:'.length) })
  else if (source === 'now') emit('update:value', { $now: true })
  else if (source === 'empty') emit('update:value', null)
  else if (source === 'literal') emit('update:value', defaultLiteral(type))
}

const YES_NO = [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]
const literal = computed(() => expr.value.kind === 'literal' ? expr.value.value : '')
/** A toggle's value is chosen, not typed. */
const toggle = computed(() => type === 'boolean' || typeof literal.value === 'boolean')
</script>

<template>
  <div
    class="flex min-w-0 flex-1 items-center gap-2"
    data-value
    :data-value-kind="expr.kind"
  >
    <EditorSelect
      :model-value="current"
      :items="options"
      placeholder="Pick a value"
      :aria-label="label"
      class="min-w-0 flex-1"
      data-value-source
      @update:model-value="pick"
    />
    <template v-if="expr.kind === 'literal'">
      <EditorSelect
        v-if="toggle"
        :model-value="String(literal)"
        :items="YES_NO"
        :aria-label="`${label}: value`"
        class="w-24 shrink-0"
        data-value-literal
        @update:model-value="emit('update:value', literalOf('boolean', $event))"
      />
      <EditorInput
        v-else
        :model-value="String(literal)"
        :inputmode="type === 'integer' ? 'numeric' : type === 'number' ? 'decimal' : undefined"
        :aria-label="`${label}: value`"
        placeholder="value"
        class="min-w-0 flex-1"
        data-value-literal
        @update:model-value="emit('update:value', literalOf(type, $event))"
      />
    </template>
    <code
      v-else-if="expr.kind === 'computed'"
      class="min-w-0 flex-1 truncate rounded-lg bg-elevated px-2 py-1.5 text-[11px] text-muted"
      data-value-computed
    >{{ JSON.stringify(expr.value) }}</code>
  </div>
</template>
