<script setup lang="ts">
import { computed } from 'vue'
import { FIELD, FIELD_RING } from '../editorUi.ts'
import type { BranchChoice, ConditionChoice, ConditionDraft } from '../shared/listSource.ts'

/**
 * The form of a List's condition (B4, S4), the rows under the Items select once the source depends on a condition:
 * "If <a true or false value> <is on | is off>", "Then <list>", "Otherwise <list>". The value is a full-width row, its State fields
 * listed under their State (`optgroup`) and named by the field alone unless two fields share a name; its title says the whole name,
 * so a narrow inspector never hides which field it is. A change goes up (`change`) and the panel writes it (`useListCondition`).
 */

const props = defineProps<{
  form: ConditionDraft
  /** What the written condition says in words; empty while it is being made. */
  summary: string
  /** The values the condition can read (and the one it reads now, when it is no longer one of them). */
  ifOptions: ConditionChoice[]
  thenOptions: BranchChoice[]
  elseOptions: BranchChoice[]
  busy: boolean
}>()
const emit = defineEmits<{ change: [patch: Partial<ConditionDraft>] }>()

const small = `${FIELD} ${FIELD_RING} w-full min-w-0 px-1.5 text-default disabled:opacity-50`
const row = 'grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-1 text-dimmed'

const inGroups = computed(() => {
  const groups = new Map<string, ConditionChoice[]>()
  for (const choice of props.ifOptions) if (choice.group) groups.set(choice.group, [...groups.get(choice.group) ?? [], choice])
  return [...groups].map(([label, choices]) => ({ label, choices }))
})
const ungrouped = computed(() => props.ifOptions.filter(choice => !choice.group))
const ifTitle = computed(() => props.ifOptions.find(choice => choice.path === props.form.path)?.title ?? '')

const valueOf = (event: Event) => (event.target as HTMLSelectElement).value
</script>

<template>
  <div
    class="flex flex-col gap-1.5 rounded-lg bg-elevated/60 p-2 text-[12px]"
    data-testid="list-condition"
  >
    <p
      v-if="summary"
      class="text-dimmed"
      data-testid="list-condition-summary"
    >
      {{ summary }}
    </p>
    <div :class="row">
      If
      <select
        data-testid="list-condition-if"
        :class="small"
        aria-label="If"
        :title="ifTitle"
        :value="form.path"
        :disabled="busy"
        @change="emit('change', { path: valueOf($event) })"
      >
        <option
          value=""
          disabled
        >
          Choose a value
        </option>
        <optgroup
          v-for="group in inGroups"
          :key="group.label"
          :label="group.label"
        >
          <option
            v-for="choice in group.choices"
            :key="choice.path"
            :value="choice.path"
            :title="choice.title"
          >
            {{ choice.label }}
          </option>
        </optgroup>
        <option
          v-for="choice in ungrouped"
          :key="choice.path"
          :value="choice.path"
          :title="choice.title"
        >
          {{ choice.label }}
        </option>
      </select>
    </div>
    <div :class="row">
      <span />
      <select
        data-testid="list-condition-not"
        :class="small"
        aria-label="Is on or off"
        :value="form.off ? 'off' : 'on'"
        :disabled="busy"
        @change="emit('change', { off: valueOf($event) === 'off' })"
      >
        <option value="on">
          is on
        </option>
        <option value="off">
          is off
        </option>
      </select>
    </div>
    <p
      v-if="!ifOptions.length"
      class="text-dimmed"
      data-testid="list-condition-hint"
    >
      Nothing true or false to depend on yet: add a true/false field to a State in Data.
    </p>
    <div :class="row">
      Then
      <select
        data-testid="list-condition-then"
        :class="small"
        aria-label="Then show"
        :value="form.then"
        :disabled="busy"
        @change="emit('change', { then: valueOf($event) })"
      >
        <option
          value=""
          disabled
        >
          Choose a list
        </option>
        <option
          v-for="choice in thenOptions"
          :key="choice.alias"
          :value="choice.alias"
        >
          {{ choice.label }}
        </option>
      </select>
    </div>
    <div :class="row">
      Otherwise
      <select
        data-testid="list-condition-else"
        :class="small"
        aria-label="Otherwise show"
        :value="form.else"
        :disabled="busy"
        @change="emit('change', { else: valueOf($event) })"
      >
        <option
          value=""
          disabled
        >
          Choose a list
        </option>
        <option
          v-for="choice in elseOptions"
          :key="choice.alias"
          :value="choice.alias"
        >
          {{ choice.label }}
        </option>
      </select>
    </div>
  </div>
</template>
