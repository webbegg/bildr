<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ApiModel } from '@bildr/codegen/model'
import DataInlineError from '../data/DataInlineError.vue'
import { attempt } from '../../editor/dataArtifactActions.ts'
import { clashesOf, planProposal } from '../../editor/simpleApiDraft.ts'
import type { Resolution } from '../../editor/simpleApiDraft.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { modelNameOf } from '../../shared/simpleApi.ts'
import { plainWords } from '../../shared/simpleData.ts'

/**
 * "Use this answer" (simple data, S4, S6), the button that turns the models an answer or a sample proposes into the API's own: each is set
 * with `api_model_set`, one by one in the order they come (the nested ones first, the root last), and the root's name is handed on
 * (`applied`) for the form to fill in. A proposed model that says what the API's model of that name says is left alone. When the name is
 * taken by a model that says something else, the dialog-less question comes first, for each: replace it, or keep both under a new name (the
 * fields that name it follow). What the module refuses is shown here and stops there: nothing is handed on. `button` is the test hook the
 * button carries (`data-try-use`, `data-op-body-sample-use`).
 */
const { datasource, models, existing, button, label = 'Use this answer' } = defineProps<{
  datasource: string
  /** The proposed models, nested first, the root last; null when there is nothing to use. */
  models: ApiModel[] | null
  /** The API's own models. */
  existing: ApiModel[]
  button: string
  label?: string
}>()
const emit = defineEmits<{ applied: [root: string] }>()
const editor = useEditor()

const asking = ref(false)
const working = ref(false)
const error = ref('')
const choices = ref<Record<string, { how: 'replace' | 'rename', name: string }>>({})

const clashes = computed(() => models ? clashesOf(models, existing) : [])

function start() {
  if (!models || working.value) return
  error.value = ''
  if (!clashes.value.length) {
    void apply()
    return
  }
  // Keeping both is the safe default: nothing the API has is lost until the user says Replace.
  choices.value = Object.fromEntries(clashes.value.map(name => [name, { how: 'rename' as const, name: `${name}2` }]))
  asking.value = true
}

function cancel() {
  asking.value = false
  error.value = ''
}

/** The names a clashing model may take instead: Pascal-cased, and not one the API or the proposal already has. */
function renameProblem(): string {
  const taken = new Set([...existing.map(model => model.name), ...(models ?? []).map(model => model.name)])
  const given = new Set<string>()
  for (const name of clashes.value) {
    const choice = choices.value[name]
    if (choice?.how !== 'rename') continue
    const next = modelNameOf(choice.name)
    if (!next) return `Give the new name of “${name}”`
    if (taken.has(next) || given.has(next)) return `“${next}” is taken too: pick another name`
    given.add(next)
  }
  return ''
}

async function apply() {
  if (!models || working.value) return
  const problem = asking.value ? renameProblem() : ''
  if (problem) {
    error.value = problem
    return
  }
  const picked: Record<string, Resolution> = Object.fromEntries(asking.value
    ? clashes.value.map((name) => {
        const choice = choices.value[name]!
        return [name, choice.how === 'rename' ? { how: 'rename', name: modelNameOf(choice.name) } : { how: 'replace' }]
      })
    : [])
  const plan = planProposal(models, existing, picked)
  working.value = true
  error.value = ''
  for (const model of plan.models) {
    const done = await attempt(editor, 'api_model_set', { datasource, model }, `Could not set the model ${model.name}`)
    if ('error' in done) {
      working.value = false
      error.value = plainWords(done.error)
      return
    }
  }
  working.value = false
  asking.value = false
  emit('applied', plan.root)
}
</script>

<template>
  <div class="space-y-2">
    <EditorButton
      variant="primary"
      icon="i-lucide-wand-sparkles"
      :label="label"
      :loading="working && !asking"
      :disabled="!models || working"
      v-bind="{ [button]: '' }"
      @click="start"
    />
    <div
      v-if="asking"
      class="space-y-3 rounded-lg border border-white/10 px-3 py-3"
      data-proposal-asking
    >
      <div
        v-for="name in clashes"
        :key="name"
        class="space-y-2"
        :data-proposal-conflict="name"
      >
        <p class="text-[12px] leading-4 text-toned">
          A model named “{{ name }}” already exists and says something else. Replace it, or keep both under a new name?
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <EditorButton
            :variant="choices[name]?.how === 'replace' ? 'primary' : 'soft'"
            label="Replace it"
            :aria-pressed="choices[name]?.how === 'replace'"
            data-proposal-choice="replace"
            @click="choices[name]!.how = 'replace'"
          />
          <EditorButton
            :variant="choices[name]?.how === 'rename' ? 'primary' : 'soft'"
            label="Keep both"
            :aria-pressed="choices[name]?.how === 'rename'"
            data-proposal-choice="rename"
            @click="choices[name]!.how = 'rename'"
          />
          <EditorInput
            v-if="choices[name]?.how === 'rename'"
            v-model="choices[name]!.name"
            class="w-44"
            :aria-label="`New name for ${name}`"
            data-proposal-rename
          />
        </div>
      </div>
      <div class="flex justify-end gap-2">
        <EditorButton
          label="Cancel"
          :disabled="working"
          data-proposal-cancel
          @click="cancel"
        />
        <EditorButton
          variant="primary"
          label="Continue"
          :loading="working"
          data-proposal-apply
          @click="apply"
        />
      </div>
    </div>
    <DataInlineError
      v-if="error"
      icon
      data-proposal-error
    >
      {{ error }}
    </DataInlineError>
  </div>
</template>
