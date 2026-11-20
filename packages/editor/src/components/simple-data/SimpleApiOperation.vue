<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { inferApiModels } from '@bildr/codegen/edit'
import type { ApiSource } from '@bildr/codegen/edit'
import type { ApiAction, ApiQuery } from '@bildr/codegen/model'
import DataDraftFooter from '../data/DataDraftFooter.vue'
import DataStaleNotice from '../data/DataStaleNotice.vue'
import SimpleApiProposal from './SimpleApiProposal.vue'
import SimpleApiTry from './SimpleApiTry.vue'
import { attempt } from '../../editor/dataArtifactActions.ts'
import { actionOutput, newParam, operationChangedOutside, operationDirty, operationDraftOf, operationProblems, operationRebase, paramsOutput, queryOutput } from '../../editor/simpleApiDraft.ts'
import type { Method, OperationDraft, ParamType } from '../../editor/simpleApiDraft.ts'
import { useDraftForm } from '../../editor/useDraftForm.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { METHODS, PARAM_TYPES, sampleModelName } from '../../shared/simpleApi.ts'
import { plainWords } from '../../shared/simpleData.ts'

/**
 * The editor of a query or an action of an API (simple data, S4, S6), one form for both: its path, with the parameters the `:name` segments
 * of the path make (path parameters, suggested as the path is typed) and the query parameters added by hand (name, type, whether it is
 * needed, the key the API calls it), what it answers (a model, one or a list, and where a wrapped list sits in the answer) and, for an
 * action, its method (with what each does), the model of its body (picked, or made from a sample the user pastes) and that its answer is
 * optional. Everything is one draft with one Save (`api_query_set` or `api_action_set`) and one Discard, as the store's form;
 * what the module refuses shows in the footer in the section's words and the edits stay.
 *
 * "Try it" and "Use this answer" (`SimpleApiTry`) fill the answer in from a real call. The models "Use this answer" adds are the API's at
 * once, before the form is saved: the footer says so ("Models added. Save to keep the query.") and Discard says they stay. A query or
 * action that is new is only a name until it is saved; a rename (`name` changes) keeps the form and its edits.
 */
const { source, kind, name } = defineProps<{ source: ApiSource, kind: 'query' | 'action', name: string }>()
const emit = defineEmits<{ back: [], rename: [] }>()
const editor = useEditor()

const stored = (): ApiQuery | ApiAction | null => (kind === 'query' ? source.queries : source.actions).find(entry => entry.name === name) ?? null
const { draft, error, saving, dirty, stale, discard, keepMine } = useDraftForm<ApiQuery | ApiAction | null, OperationDraft>({
  stored,
  id: () => `${kind}`,
  label: () => name,
  open: item => operationDraftOf(kind, item),
  dirty: operationDirty,
  changedOutside: operationChangedOutside,
  rebase: operationRebase
})

const noun = computed(() => kind === 'query' ? 'query' : 'action')
const pathParams = computed(() => paramsOutput(draft.value).filter(param => param.in === 'path'))

async function save() {
  if (stale.value || !dirty.value || saving.value) return
  const problems = operationProblems(draft.value)
  if (problems.length) {
    error.value = problems.join('. ')
    return
  }
  saving.value = true
  const done = kind === 'query'
    ? await attempt(editor, 'api_query_set', { datasource: source.id, query: queryOutput(name, draft.value) }, 'Could not save the query')
    : await attempt(editor, 'api_action_set', { datasource: source.id, action: actionOutput(name, draft.value) }, 'Could not save the action')
  saving.value = false
  if ('error' in done) {
    error.value = plainWords(done.error)
    return
  }
  // The model is refreshed: the form shows the item as it is now, and that is what the next edits start from.
  discard()
}

// ── Parameters ───────────────────────────────────────────────────────────

const CHECKBOX = 'size-3.5 cursor-pointer scheme-dark accent-(--ui-primary)'
const setPathType = (param: string, type: ParamType) => {
  draft.value.pathTypes[param] = type
}
const removeParam = (key: string) => {
  draft.value.params = draft.value.params.filter(param => param.key !== key)
}

// ── What it answers and what it sends ────────────────────────────────────

const NONE = '__none'
const modelItems = computed(() => source.models.map(model => ({ value: model.name, label: model.name })))
const resultItems = computed(() => kind === 'action' ? [{ value: NONE, label: 'Nothing (an empty answer)' }, ...modelItems.value] : modelItems.value)
const bodyItems = computed(() => [{ value: NONE, label: 'Nothing (no body)' }, ...modelItems.value])

const resultModel = computed(() => draft.value.result?.model || (kind === 'action' && !draft.value.result ? NONE : undefined))
function setResultModel(value: string) {
  draft.value.result = value === NONE ? null : { model: value, many: draft.value.result?.many ?? false, itemsPath: draft.value.result?.itemsPath ?? '' }
}
const setBodyModel = (value: string) => {
  draft.value.body = value === NONE ? '' : value
}
/** Models the form's own "Use this answer" or sample set since it was last saved or discarded: they are the API's already, the form's edits are not. */
const added = ref(false)
watch(dirty, (now) => {
  if (!now) added.value = false
})
const footerNote = computed(() => added.value && dirty.value ? `Models added. Save to keep the ${noun.value}.` : '')

/** "Use this answer": what the call answers is what the answer was. */
const useResult = (result: { model: string, many: boolean, itemsPath: string }, count: number) => {
  draft.value.result = { ...result }
  if (count) added.value = true
}

// ── A body from a sample ─────────────────────────────────────────────────

const sampleOpen = ref(false)
const sample = ref('')
/** The sample the body's model was made from: Try it sends it as the body, until another is typed. */
const sampleBody = ref('')
function useSample(root: string, count: number) {
  draft.value.body = root
  sampleBody.value = sample.value.trim()
  if (count) added.value = true
}
/** The models a pasted sample proposes, or why it can't. */
const proposed = computed(() => {
  const typed = sample.value.trim()
  if (!typed) return { models: null, problem: '' }
  let json: unknown
  try {
    json = JSON.parse(typed)
  } catch {
    return { models: null, problem: 'That is not JSON: paste an object like {"title": "Lamp"}' }
  }
  const models = inferApiModels(json, sampleModelName(draft.value.path))
  return models.length ? { models, problem: '' } : { models: null, problem: 'The sample needs an object with fields, like {"title": "Lamp"}' }
})
const hasBody = computed(() => kind === 'action' && draft.value.method !== 'DELETE')
const methodHint = computed(() => METHODS.find(entry => entry.value === draft.value.method)?.description ?? '')
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col"
    :data-api-editor="`${kind}:${name}`"
  >
    <div class="flex h-11 shrink-0 items-center gap-2 border-b border-default ps-4 pe-3">
      <EditorButton
        variant="ghost"
        icon="i-lucide-arrow-left"
        :label="source.name"
        :aria-label="`Back to ${source.name}`"
        data-api-back
        @click="emit('back')"
      />
      <span class="text-dimmed">/</span>
      <h3
        class="truncate text-[13px] font-[550] text-highlighted"
        data-api-editor-title
      >
        {{ name }}
      </h3>
      <span class="shrink-0 text-[11px] text-dimmed">{{ kind === 'query' ? 'Query' : 'Action' }}</span>
      <span class="flex-1" />
      <EditorButton
        v-if="stored()"
        variant="ghost"
        icon="i-lucide-pencil"
        label="Rename"
        data-api-editor-rename
        @click="emit('rename')"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto w-full max-w-2xl space-y-6 px-6 py-6">
        <DataStaleNotice
          v-if="stale"
          prefix="simple-op"
          :title="`This ${noun} changed since you started editing`"
          :description="`Your edits are still here. Load the new version to drop them, or keep them: your version replaces the new one when you save.`"
          @load-new="discard"
          @keep-mine="keepMine"
        />

        <section class="space-y-4">
          <EditorFormRow
            v-if="kind === 'action'"
            label="Method"
            stacked
          >
            <div class="flex w-full items-center gap-3">
              <EditorSelect
                :model-value="draft.method"
                :items="METHODS.map(entry => ({ value: entry.value, label: entry.label }))"
                class="w-32"
                aria-label="Method"
                data-op-method
                @update:model-value="draft.method = $event as Method"
              />
              <span
                class="text-[12px] text-muted"
                data-op-method-hint
              >{{ draft.method }}: {{ methodHint }}</span>
            </div>
          </EditorFormRow>
          <div>
            <EditorFormRow
              label="Path"
              stacked
            >
              <EditorInput
                v-model="draft.path"
                placeholder="/products/:id"
                aria-label="Path"
                mono
                data-op-path
              />
            </EditorFormRow>
            <p
              class="mt-1 text-[12px] leading-4 text-dimmed"
              data-op-path-help
            >
              What comes after the base URL, like “/products/:id”. A word after a colon, like “:id”, is a parameter that is filled in when it runs.
            </p>
          </div>
        </section>

        <section>
          <h3 class="flex h-9 items-center text-[12px] font-[550] text-highlighted">
            Parameters
          </h3>
          <p
            v-if="!pathParams.length && !draft.params.length"
            class="pb-2 text-[12px] leading-4 text-muted"
          >
            None yet. Parameters from the path appear on their own; add the others, like a page size, below.
          </p>
          <div
            v-else
            class="grid grid-cols-[minmax(0,1fr)_9.5rem_4.5rem_minmax(0,1fr)_1.5rem] items-center gap-x-2 gap-y-1.5 pb-1"
          >
            <span class="ps-1.5 text-[11px] text-dimmed">Name</span>
            <span class="text-[11px] text-dimmed">Type</span>
            <span class="text-[11px] text-dimmed">Needed</span>
            <span class="text-[11px] text-dimmed">Called in the API</span>
            <span />
            <template
              v-for="param in pathParams"
              :key="`path:${param.name}`"
            >
              <div
                class="contents"
                :data-op-param="`path:${param.name}`"
                :data-op-param-in="'path'"
              >
                <span
                  class="truncate ps-1.5 font-mono text-[12px] text-toned"
                  data-op-param-name
                >{{ param.name }}</span>
                <EditorSelect
                  :model-value="param.type"
                  :items="PARAM_TYPES"
                  :aria-label="`Type of ${param.name}`"
                  data-op-param-type
                  @update:model-value="setPathType(param.name, $event as ParamType)"
                />
                <span class="text-[11px] text-dimmed">Always</span>
                <span class="truncate text-[11px] text-dimmed">From the path</span>
                <span />
              </div>
            </template>
            <template
              v-for="param in draft.params"
              :key="param.key"
            >
              <div
                class="contents"
                :data-op-param="`query:${param.key}`"
                :data-op-param-in="'query'"
              >
                <EditorInput
                  v-model="param.name"
                  placeholder="Name, e.g. Page size"
                  :aria-label="`Name of ${param.name || 'the parameter'}`"
                  data-op-param-name
                />
                <EditorSelect
                  :model-value="param.type"
                  :items="PARAM_TYPES"
                  :aria-label="`Type of ${param.name || 'the parameter'}`"
                  data-op-param-type
                  @update:model-value="param.type = $event as ParamType"
                />
                <input
                  type="checkbox"
                  :class="CHECKBOX"
                  :checked="param.required"
                  :aria-label="`${param.name || 'The parameter'} is needed`"
                  data-op-param-required
                  @change="param.required = ($event.target as HTMLInputElement).checked"
                >
                <EditorInput
                  v-model="param.remote"
                  placeholder="Same name"
                  :aria-label="`The name the API gives ${param.name || 'the parameter'}`"
                  data-op-param-remote
                />
                <EditorButton
                  icon="i-lucide-minus"
                  variant="ghost"
                  size="xs"
                  :aria-label="`Remove ${param.name || 'the parameter'}`"
                  data-op-param-remove
                  @click="removeParam(param.key)"
                />
              </div>
            </template>
          </div>
          <button
            type="button"
            class="mt-1 flex h-9 w-full items-center gap-1.5 rounded-lg ps-2 text-left text-[12px] text-muted hover:bg-white/4 hover:text-toned"
            aria-label="Add parameter"
            data-op-param-add
            @click="draft.params.push(newParam())"
          >
            <UIcon
              name="i-lucide-plus"
              class="size-4 shrink-0"
            />
            Add parameter
          </button>
        </section>

        <section
          v-if="hasBody"
          class="space-y-3"
        >
          <h3 class="flex h-9 items-center text-[12px] font-[550] text-highlighted">
            What it sends
          </h3>
          <EditorFormRow
            label="Model of the body"
            help="The shape of the JSON this action sends"
            stacked
          >
            <EditorSelect
              :model-value="draft.body || NONE"
              :items="bodyItems"
              aria-label="Model of the body"
              data-op-body-model
              @update:model-value="setBodyModel"
            />
          </EditorFormRow>
          <button
            type="button"
            class="flex items-center gap-1.5 text-[12px] text-muted hover:text-toned"
            data-op-body-sample-toggle
            @click="sampleOpen = !sampleOpen"
          >
            <UIcon
              :name="sampleOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
              class="size-4 shrink-0"
            />
            Make the model from a sample
          </button>
          <div
            v-if="sampleOpen"
            class="space-y-2"
          >
            <EditorTextarea
              v-model="sample"
              mono
              :rows="4"
              placeholder="{&quot;title&quot;: &quot;Lamp&quot;, &quot;price&quot;: 3.5}"
              aria-label="A sample of the body"
              data-op-body-sample
            />
            <p
              v-if="proposed.problem"
              class="text-[12px] leading-4 text-error"
              role="alert"
              data-op-body-sample-error
            >
              {{ proposed.problem }}
            </p>
            <SimpleApiProposal
              :datasource="source.id"
              :models="proposed.models"
              :existing="source.models"
              label="Use this sample"
              fills="body of the action"
              button="data-op-body-sample-use"
              @applied="useSample"
            />
          </div>
        </section>

        <section class="space-y-3">
          <h3 class="flex h-9 items-center text-[12px] font-[550] text-highlighted">
            {{ kind === 'query' ? 'What it answers' : 'What it answers, if anything' }}
          </h3>
          <EditorFormRow
            label="Model of the answer"
            stacked
          >
            <EditorSelect
              :model-value="resultModel"
              :items="resultItems"
              placeholder="Choose a model"
              aria-label="Model of the answer"
              data-op-result-model
              @update:model-value="setResultModel"
            />
          </EditorFormRow>
          <template v-if="draft.result?.model">
            <EditorSwitch
              v-model="draft.result.many"
              label="It answers a list of them"
              aria-label="It answers a list"
              data-op-result-many
            />
            <EditorFormRow
              v-if="draft.result.many"
              label="Where the list is"
              help="The name of the part of the answer that holds the list, like “data.items”. Leave it empty when the answer is the list itself."
              stacked
            >
              <EditorInput
                v-model="draft.result.itemsPath"
                placeholder="data.items"
                aria-label="Where the list is"
                data-op-result-items
              />
            </EditorFormRow>
          </template>
          <p
            v-if="!source.models.length"
            class="text-[12px] leading-4 text-muted"
          >
            There are no models yet. Use “Try it” below to make one from a real answer, or add one in the API's Models.
          </p>
        </section>

        <SimpleApiTry
          :source="source"
          :draft="draft"
          :body-hint="sampleBody"
          @use="useResult"
        />
      </div>
    </div>

    <DataDraftFooter
      prefix="simple-op"
      inner="mx-auto max-w-2xl px-6"
      :error="error"
      :note="footerNote"
      :discard-hint="footerNote ? `Drops your edits to this ${noun}. The models you added stay.` : undefined"
      :dirty="dirty"
      :saving="saving"
      :disabled="!dirty || stale"
      @discard="discard"
      @save="save"
    />
  </div>
</template>
