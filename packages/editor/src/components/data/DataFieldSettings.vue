<script setup lang="ts">
import { computed } from 'vue'
import { CURRENCIES } from '../../shared/simpleApi.ts'

/**
 * The setting a field's type needs, on a line under its row (field types S3b): a select's options (one text, separated by commas)
 * or money's currency. Nothing for another type. `hook` names the boxes for tests and e2e (`data-<hook>-options`,
 * `data-<hook>-currency`, valued `name` when given); `commit="change"` sends the options on blur or Enter, for a form that saves
 * each change at once.
 */
const { type, options, currency, label, hook, name, commit = 'input' } = defineProps<{
  type: string
  options: string
  currency: string
  /** The field as the boxes' labels name it. */
  label: string
  hook: string
  name?: string
  commit?: 'input' | 'change'
}>()
const emit = defineEmits<{ 'update:options': [value: string], 'update:currency': [value: string] }>()

/** The common currencies, and the one the field has when it is another. */
const currencies = computed(() => currency && !CURRENCIES.includes(currency) ? [currency, ...CURRENCIES] : CURRENCIES)
const hookOf = (part: string) => ({ [`data-${hook}-${part}`]: name ?? '' })
</script>

<template>
  <div
    v-if="type === 'select'"
    class="mt-1 flex items-center gap-2 ps-1.5"
  >
    <span class="shrink-0 text-[11px] text-dimmed">Options</span>
    <EditorInput
      :model-value="options"
      :commit="commit"
      placeholder="Separated by commas, e.g. draft, live, &quot;on hold, waiting&quot;"
      :aria-label="`Options of ${label}`"
      class="min-w-0 flex-1"
      v-bind="hookOf('options')"
      @update:model-value="emit('update:options', $event)"
    />
  </div>
  <div
    v-else-if="type === 'money'"
    class="mt-1 flex items-center gap-2 ps-1.5"
  >
    <span class="shrink-0 text-[11px] text-dimmed">Currency</span>
    <EditorSelect
      :model-value="currency"
      :items="currencies"
      :aria-label="`Currency of ${label}`"
      class="max-w-28"
      v-bind="hookOf('currency')"
      @update:model-value="emit('update:currency', $event)"
    />
  </div>
</template>
