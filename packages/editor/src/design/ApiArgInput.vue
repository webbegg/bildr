<script setup lang="ts">
import { computed } from 'vue'
import { bindingPaths } from '@bildr/codegen/edit'
import type { Value } from '@bildr/codegen/model'
import { FIELD, FIELD_RING } from '../editorUi.ts'
import { isExpression } from '../shared/bindings.ts'
import { routeParams } from '../shared/interactionValues.ts'
import type { ApiParam } from '../shared/apiPageUse.ts'
import { useDesign } from './store.ts'

/**
 * The value a page gives one parameter of an API query (simple data P7b): a value typed (text, a number, true or false), or one the page
 * already has: a route parameter of the same page (text parameters only: the module refuses it for another type) or a field of a State
 * it uses. A value it has shows as a chip with a way back to typing (a required parameter can't be left without one, so it has none).
 * It only says what the user chose (`commit`: the value, or null to remove it); the owner writes it (`page_use_update`, or keeps it in a
 * draft until `page_use_add` has what it needs).
 */

const props = defineProps<{ param: ApiParam, value: Value | undefined, testId: string, required: boolean }>()
const emit = defineEmits<{ commit: [value: Value | null] }>()
const design = useDesign()
const field = `${FIELD} ${FIELD_RING} w-full min-w-0 px-2 text-default`

const routes = computed(() => (props.param.type === 'text' && design.page.value ? routeParams(design.page.value) : []))
const fields = computed(() => bindingPaths(design.scopeOf().filter(entry => entry.source === 'state'), { leaves: true }))

/** What the "from" select shows for the value held: `route:<name>`, `bind:<path>`, or empty for a value typed. */
const from = computed(() => {
  const value = props.value
  if (!isExpression(value)) return ''
  if (typeof value.$route === 'string') return `route:${value.$route}`
  return typeof value.$bind === 'string' ? `bind:${value.$bind}` : ''
})
const bound = computed(() => isExpression(props.value))
const textOf = (value: Value | undefined) => value === undefined || value === null || isExpression(value) ? '' : String(value)

const typed = (text: string): Value | null => {
  if (text.trim() === '') return null
  if (props.param.type === 'integer' || props.param.type === 'number') return Number(text)
  return props.param.type === 'boolean' ? text === 'true' : text
}
const choose = (event: Event) => {
  const value = (event.target as HTMLSelectElement).value
  if (value.startsWith('route:')) emit('commit', { $route: value.slice(6) })
  else if (value.startsWith('bind:')) emit('commit', { $bind: value.slice(5) })
  else if (!props.required) emit('commit', null)
}
const label = computed(() => from.value.replace(/^(route|bind):/, '') || JSON.stringify(props.value))
/** A typed value is committed, or removed when it is emptied; a required one can't be removed, so emptying it commits nothing. */
const commitTyped = (text: string) => {
  const value = typed(text)
  if (value !== null || !props.required) emit('commit', value)
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1">
    <div class="flex min-w-0 items-center gap-1">
      <code
        v-if="bound"
        class="min-w-0 flex-1 truncate rounded-sm bg-white/8 px-1 py-0.5 text-default"
        :data-testid="testId"
        :title="from.startsWith('route:') ? `The route parameter ${label}` : `The value ${label}`"
      >{{ label }}</code>
      <select
        v-else-if="param.type === 'boolean'"
        :data-testid="testId"
        :class="field"
        :value="value === undefined || value === null ? '' : String(value)"
        @change="commitTyped(($event.target as HTMLSelectElement).value)"
      >
        <option value="">
          …
        </option>
        <option value="true">
          true
        </option>
        <option value="false">
          false
        </option>
      </select>
      <EditorCommitInput
        v-else
        size="xs"
        :data-testid="testId"
        :model-value="textOf(value)"
        :numeric="param.type === 'integer' || param.type === 'number'"
        @commit="commitTyped($event)"
      />
    </div>
    <select
      v-if="routes.length || fields.length || bound"
      :data-testid="`${testId}-from`"
      :class="field"
      :aria-label="`Where ${param.name} comes from`"
      :value="from"
      @change="choose"
    >
      <option
        value=""
        :disabled="bound && required"
      >
        {{ bound ? 'Type a value' : 'Or use a value of the page…' }}
      </option>
      <option
        v-for="name in routes"
        :key="`route:${name}`"
        :value="`route:${name}`"
      >
        The route’s {{ name }}
      </option>
      <option
        v-for="path in fields"
        :key="`bind:${path}`"
        :value="`bind:${path}`"
      >
        {{ path }}
      </option>
    </select>
  </div>
</template>
