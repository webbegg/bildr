<script setup lang="ts">
import { computed } from 'vue'
import { record } from '../../../editor/stepExpr.ts'
import type { StepsContext } from '../../../editor/stepDraft.ts'
import type { Lookup } from '../../../editor/stepRepos.ts'
import type { StepScope } from '../../../editor/stepScope.ts'

/**
 * The lookup of a refuse and of a load (S10, D10c): the collection to look in, how to find the row in it and what to find it by
 * (`call`: the `repository`, `op` and `args` of the step, which a refuse holds in `unless` and a load in itself). It does not change
 * the step: it says what would change in `call` (`change`), and the step's own form puts it where it belongs.
 */
const { call, scope, ctx, finder = false, help } = defineProps<{
  call: Record<string, unknown>
  scope: StepScope
  ctx: StepsContext
  /** A refuse looks a row up by what it holds, so a new collection starts on a finder rather than on the key. */
  finder?: boolean
  /** What the "Look up" row says of the lookup. */
  help?: string
}>()
const emit = defineEmits<{ change: [patch: Record<string, unknown>] }>()

const repo = computed(() => ctx.repos.find(entry => entry.id === call.repository))
const repoItems = computed(() => ctx.repos.map(entry => ({ label: entry.name, value: entry.id })))
const lookup = computed(() => repo.value?.lookups.find(entry => entry.op === call.op))
const args = computed(() => record(call.args))
const capital = (name: string) => name.charAt(0).toUpperCase() + name.slice(1)

/** The argument of a lookup that the action already has an input of the same name for. */
function argsFor(found: Lookup | undefined) {
  return found && scope.input.some(entry => entry.path === found.arg) ? { [found.arg]: { $input: found.arg } } : {}
}

function pickCollection(id: string) {
  const next = ctx.repos.find(entry => entry.id === id)
  const first = finder ? next?.lookups.find(entry => entry.op !== 'get') ?? next?.lookups[0] : next?.lookups[0]
  emit('change', { repository: id, op: first?.op ?? '', args: argsFor(first) })
}
function pickLookup(op: string) {
  emit('change', { op, args: argsFor(repo.value?.lookups.find(entry => entry.op === op)) })
}
</script>

<template>
  <EditorFormRow label="Collection">
    <EditorSelect
      :model-value="typeof call.repository === 'string' ? call.repository : ''"
      :items="repoItems"
      placeholder="Pick a collection"
      aria-label="Collection to look in"
      data-step-field="repository"
      @update:model-value="pickCollection"
    />
  </EditorFormRow>
  <EditorFormRow
    v-if="repo"
    label="Look up"
    :help="help"
  >
    <EditorSelect
      :model-value="typeof call.op === 'string' ? call.op : ''"
      :items="repo.lookups.map(entry => ({ label: entry.label, value: entry.op }))"
      placeholder="Pick how to look it up"
      aria-label="How to look it up"
      data-step-field="op"
      @update:model-value="pickLookup"
    />
  </EditorFormRow>
  <EditorFormRow
    v-if="lookup"
    :label="capital(lookup.arg)"
  >
    <DataStepValue
      :value="args[lookup.arg]"
      :scope="scope"
      :type="lookup.type"
      :label="`Value of ${lookup.arg} to look up`"
      :data-step-arg="lookup.arg"
      @update:value="emit('change', { args: { ...args, [lookup.arg]: $event } })"
    />
  </EditorFormRow>
</template>
