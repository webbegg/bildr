<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ApiModel } from '@bildr/codegen/model'
import DataInlineError from '../data/DataInlineError.vue'
import { attempt } from '../../editor/dataArtifactActions.ts'
import { clashesOf, planProposal, renameProblem } from '../../editor/simpleApiDraft.ts'
import type { Resolution } from '../../editor/simpleApiDraft.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { modelNameOf } from '../../shared/simpleApi.ts'
import { plainWords } from '../../shared/simpleData.ts'

/**
 * "Use this answer" (simple data, S4, S6), the button that turns the models an answer or a sample proposes into the API's own: each is set
 * with `api_model_set`, one by one in the order they come (the nested ones first, the root last), and the root's name is handed on
 * (`applied`, with how many models were set) for the form to fill in. A proposed model that says what the API's model of that name says is left
 * alone. When the name is taken by a model that says something else, the dialog-less question comes first, for each: replace it, or keep both
 * under a new name (the fields that name it follow); a clash the question has no answer for yet (it came up while it was open) keeps both.
 *
 * What the module refuses is shown here and nothing is handed on. When it refuses a model after others were set, those stay (the API has
 * them): the user is told which, that `fills` was not filled in, and can try again. The models are read again, the user's choices are kept,
 * and what is already there is not set again (nor asked about, nor refused for its new name). `button` is the test hook the button carries
 * (`data-try-use`, `data-op-body-sample-use`).
 */
const { datasource, models, existing, button, label = 'Use this answer', fills = 'query' } = defineProps<{
  datasource: string
  /** The proposed models, nested first, the root last; null when there is nothing to use. */
  models: ApiModel[] | null
  /** The API's own models. */
  existing: ApiModel[]
  button: string
  label?: string
  /** What the models are for, in the words of "The … was not filled in": `query`, `action`, `body of the action`. */
  fills?: string
}>()
const emit = defineEmits<{ applied: [root: string, added: number] }>()
const editor = useEditor()

interface Choice { how: 'replace' | 'rename', name: string }
const asking = ref(false)
const working = ref(false)
const error = ref('')
const choices = ref<Record<string, Choice>>({})
/** What the user chose in a try that stopped half way, and the models it set before it did. */
const stopped = ref<{ picked: Record<string, Resolution>, added: string[], failed: string, why: string } | null>(null)

/** Keeping both is the safe default: nothing the API has is lost until the user says Replace. */
const choiceOf = (name: string): Choice => choices.value[name] ?? { how: 'rename', name: `${name}2` }
const choose = (name: string, how: Choice['how']) => {
  choices.value[name] = { ...choiceOf(name), how }
}
const rename = (name: string, to: string) => {
  choices.value[name] = { ...choiceOf(name), name: to }
}

const clashes = computed(() => models ? clashesOf(models, existing, stopped.value?.picked) : [])
const stoppedText = computed(() => stopped.value
  ? `Already added to the API: ${stopped.value.added.join(', ')}. Could not add ${stopped.value.failed}: ${stopped.value.why}. The ${fills} was not filled in.`
  : '')

function start() {
  if (!models || working.value) return
  error.value = ''
  if (!clashes.value.length) {
    void apply()
    return
  }
  asking.value = true
}

function cancel() {
  asking.value = false
  error.value = ''
  stopped.value = null
  choices.value = {}
}

/** What is to be done for each model that clashes, under the names the user typed (Pascal-cased), on top of what they chose in a try that stopped. */
function picked(): Record<string, Resolution> {
  const asked = asking.value
    ? clashes.value.map((name): [string, Resolution] => {
        const choice = choiceOf(name)
        return [name, choice.how === 'rename' ? { how: 'rename', name: modelNameOf(choice.name) } : { how: 'replace' }]
      })
    : []
  return { ...stopped.value?.picked, ...Object.fromEntries(asked) }
}

async function apply() {
  if (!models || working.value) return
  const chosen = picked()
  const problem = asking.value ? renameProblem(models, existing, chosen) : ''
  if (problem) {
    error.value = problem
    return
  }
  const plan = planProposal(models, existing, chosen)
  working.value = true
  error.value = ''
  stopped.value = null
  const added: string[] = []
  for (const model of plan.models) {
    const done = await attempt(editor, 'api_model_set', { datasource, model }, `Could not set the model ${model.name}`)
    if ('error' in done) {
      working.value = false
      const why = plainWords(done.error)
      if (!added.length) {
        error.value = why
        return
      }
      stopped.value = { picked: chosen, added, failed: model.name, why }
      asking.value = false
      // The models set so far are the API's now: the lists show them before the user decides.
      await editor.reload()
      return
    }
    added.push(model.name)
  }
  working.value = false
  asking.value = false
  choices.value = {}
  emit('applied', plan.root, added.length)
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
            :variant="choiceOf(name).how === 'replace' ? 'primary' : 'soft'"
            label="Replace it"
            :aria-pressed="choiceOf(name).how === 'replace'"
            data-proposal-choice="replace"
            @click="choose(name, 'replace')"
          />
          <EditorButton
            :variant="choiceOf(name).how === 'rename' ? 'primary' : 'soft'"
            label="Keep both"
            :aria-pressed="choiceOf(name).how === 'rename'"
            data-proposal-choice="rename"
            @click="choose(name, 'rename')"
          />
          <EditorInput
            v-if="choiceOf(name).how === 'rename'"
            :model-value="choiceOf(name).name"
            class="w-44"
            :aria-label="`New name for ${name}`"
            data-proposal-rename
            @update:model-value="rename(name, $event)"
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
    <div
      v-if="stopped"
      class="space-y-2"
    >
      <DataInlineError
        icon
        data-proposal-error
      >
        {{ stoppedText }}
      </DataInlineError>
      <EditorButton
        v-if="!asking"
        icon="i-lucide-rotate-cw"
        label="Try again"
        :disabled="working"
        data-proposal-retry
        @click="start"
      />
    </div>
    <DataInlineError
      v-else-if="error"
      icon
      data-proposal-error
    >
      {{ error }}
    </DataInlineError>
  </div>
</template>
