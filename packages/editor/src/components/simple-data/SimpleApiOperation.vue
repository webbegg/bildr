<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { inferApiModels } from '@bildr/codegen/edit'
import type { ApiSource } from '@bildr/codegen/edit'
import type { ApiAction, ApiQuery } from '@bildr/codegen/model'
import DataDraftFooter from '../data/DataDraftFooter.vue'
import DataInlineError from '../data/DataInlineError.vue'
import DataStaleNotice from '../data/DataStaleNotice.vue'
import SimpleApiProposal from './SimpleApiProposal.vue'
import SimpleApiTry from './SimpleApiTry.vue'
import { attempt } from '../../editor/dataArtifactActions.ts'
import { readPastedRequest } from '../../shared/requestPaste.ts'
import { loadTryValues, storeTryValues } from '../../editor/tryRequest.ts'
import { actionOutput, applyPastedRequest, headerProblem, newHeader, newParam, operationChangedOutside, operationDirty, operationDraftOf, operationProblems, operationRebase, paramsOutput, queryOutput } from '../../editor/simpleApiDraft.ts'
import type { HeaderDraft, Method, OperationDraft, ParamType } from '../../editor/simpleApiDraft.ts'
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
 *
 * The form is in two columns when there is room (api-calls R1): the definition, and Try it beside it, each scrolling on its own; one
 * column, Try it last, when there is not. A full URL or a cURL command pasted into the path fills the form in (`readPastedRequest`,
 * `applyPastedRequest`): the path, an action's method, the query parameters, and Try it's values and body. What it left out shows under
 * the path; a URL off the base URL is refused there, and the path stays as it was.
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
  const problems = operationProblems(draft.value, source.auth)
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

// ── Headers (api-calls R2) ─────────────────────────────────────────────────

const HEADER_FROM = [{ value: 'value', label: 'Fixed value' }, { value: 'param', label: 'From a parameter' }]
const removeHeader = (key: string) => {
  draft.value.headers = draft.value.headers.filter(header => header.key !== key)
}
const setHeaderFrom = (header: HeaderDraft, from: string) => {
  header.from = from === 'param' ? 'param' : 'value'
}
/** Where the API's sign-in goes, said next to the headers: it is set in the API's settings, never here. */
const signInHeader = computed(() => !source.auth ? '' : source.auth.type === 'bearer' ? 'Authorization' : source.auth.header ?? '')

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
/** A list clicked in Try it's answer: the operation answers a list, and that is where it is. */
const usePickedList = (itemsPath: string) => {
  if (draft.value.result) draft.value.result = { ...draft.value.result, many: true, itemsPath }
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

// ── Try it's values, and a request pasted into the path ─────────────────────────────

// Kept in this browser per operation (never in the project, never a secret: `storeTryValues`), so they are there when it is opened again.
const tryKey = () => ({ datasource: source.id, kind, name })
const kept = loadTryValues(tryKey())
const tryValues = ref<Record<string, string | boolean>>(kept.values)
const tryBody = ref(kept.body)
watch([tryValues, tryBody, () => name], () => storeTryValues(tryKey(), draft.value, { values: tryValues.value, body: tryBody.value }), { deep: true })
const pasted = ref<{ filled: string, notes: string[] } | null>(null)
const pasteError = ref('')

function onPathPaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData('text/plain') ?? ''
  const read = readPastedRequest(text, source.baseUrl, source.auth?.type === 'header' ? source.auth.header : undefined)
  if (!read) return
  event.preventDefault()
  if (!read.ok) {
    pasteError.value = read.problem
    pasted.value = null
    return
  }
  const applied = applyPastedRequest(draft.value, read.request)
  tryValues.value = { ...tryValues.value, ...applied.values }
  if (applied.body !== undefined) tryBody.value = applied.body
  pasteError.value = ''
  pasted.value = { filled: applied.filled, notes: applied.notes }
}
watch(() => draft.value.path, () => {
  pasteError.value = ''
})
// Saved or discarded: what the paste filled in is the form's no more.
watch(dirty, (now) => {
  if (!now) pasted.value = null
})
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

    <div class="@container min-h-0 flex-1 overflow-y-auto @4xl:overflow-hidden">
      <div class="@4xl:grid @4xl:h-full @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div
          class="min-w-0 @4xl:overflow-y-auto"
          data-op-definition
        >
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
                    @paste="onPathPaste"
                  />
                </EditorFormRow>
                <p
                  class="mt-1 text-[12px] leading-4 text-dimmed"
                  data-op-path-help
                >
                  What comes after the base URL, like “/products/:id”. A word after a colon, like “:id”, is a parameter that is filled in when it runs.
                  Paste a full URL or a cURL command to fill in the path, its parameters and Try it.
                </p>
                <DataInlineError
                  v-if="pasteError"
                  icon
                  class="mt-2"
                  data-op-paste-error
                >
                  {{ pasteError }}
                </DataInlineError>
                <div
                  v-if="pasted"
                  class="mt-2 flex items-start gap-2 rounded-lg bg-white/4 px-3 py-2 text-[12px] leading-4 text-toned"
                  role="status"
                  data-op-paste-note
                >
                  <UIcon
                    name="i-lucide-clipboard-check"
                    class="mt-px size-4 shrink-0 text-success"
                  />
                  <div class="min-w-0 flex-1 space-y-1">
                    <p>{{ pasted.filled }}</p>
                    <p
                      v-for="note in pasted.notes"
                      :key="note"
                      class="text-muted"
                    >
                      {{ note }}
                    </p>
                  </div>
                  <EditorButton
                    icon="i-lucide-x"
                    variant="ghost"
                    size="xs"
                    aria-label="Dismiss"
                    data-op-paste-dismiss
                    @click="pasted = null"
                  />
                </div>
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

            <section data-op-headers>
              <h3 class="flex h-9 items-center text-[12px] font-[550] text-highlighted">
                Headers
              </h3>
              <p
                v-if="!draft.headers.length"
                class="pb-2 text-[12px] leading-4 text-muted"
              >
                None yet. Add the ones the API asks for, like a version.{{ signInHeader ? ` The sign-in (${signInHeader}) is sent on its own, from the API's settings.` : '' }}
              </p>
              <div
                v-else
                class="grid grid-cols-[minmax(0,1fr)_9.5rem_minmax(0,1fr)_4.5rem_1.5rem] items-center gap-x-2 gap-y-1.5 pb-1"
              >
                <span class="ps-1.5 text-[11px] text-dimmed">Name</span>
                <span class="text-[11px] text-dimmed">Value</span>
                <span />
                <span class="text-[11px] text-dimmed">Needed</span>
                <span />
                <template
                  v-for="header in draft.headers"
                  :key="header.key"
                >
                  <div
                    class="contents"
                    :data-op-header="header.key"
                  >
                    <EditorInput
                      v-model="header.name"
                      placeholder="Name, e.g. X-Api-Version"
                      :aria-label="`Name of ${header.name || 'the header'}`"
                      data-op-header-name
                    />
                    <EditorSelect
                      :model-value="header.from"
                      :items="HEADER_FROM"
                      :aria-label="`Where ${header.name || 'the header'} takes its value`"
                      data-op-header-from
                      @update:model-value="setHeaderFrom(header, $event)"
                    />
                    <EditorInput
                      v-if="header.from === 'value'"
                      v-model="header.value"
                      placeholder="Value, e.g. 2"
                      :aria-label="`Value of ${header.name || 'the header'}`"
                      data-op-header-value
                    />
                    <EditorInput
                      v-else
                      v-model="header.param"
                      placeholder="Parameter, e.g. tenant"
                      :aria-label="`The parameter that fills ${header.name || 'the header'}`"
                      data-op-header-param
                    />
                    <input
                      v-if="header.from === 'param'"
                      type="checkbox"
                      :class="CHECKBOX"
                      :checked="header.required"
                      :aria-label="`${header.name || 'The header'} is needed`"
                      data-op-header-required
                      @change="header.required = ($event.target as HTMLInputElement).checked"
                    >
                    <span
                      v-else
                      class="text-[11px] text-dimmed"
                    >Always</span>
                    <EditorButton
                      icon="i-lucide-minus"
                      variant="ghost"
                      size="xs"
                      :aria-label="`Remove ${header.name || 'the header'}`"
                      data-op-header-remove
                      @click="removeHeader(header.key)"
                    />
                    <DataInlineError
                      v-if="headerProblem(header, source.auth)"
                      class="col-span-5"
                      data-op-header-problem
                    >
                      {{ headerProblem(header, source.auth) }}
                    </DataInlineError>
                  </div>
                </template>
              </div>
              <button
                type="button"
                class="mt-1 flex h-9 w-full items-center gap-1.5 rounded-lg ps-2 text-left text-[12px] text-muted hover:bg-white/4 hover:text-toned"
                aria-label="Add header"
                data-op-header-add
                @click="draft.headers.push(newHeader())"
              >
                <UIcon
                  name="i-lucide-plus"
                  class="size-4 shrink-0"
                />
                Add header
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
                There are no models yet. Use “Try it” to make one from a real answer, or add one in the API's Models.
              </p>
            </section>
          </div>
        </div>
        <div
          class="min-w-0 border-t border-default @4xl:overflow-y-auto @4xl:border-t-0 @4xl:border-s @4xl:bg-white/2"
          data-op-test
        >
          <div class="mx-auto w-full max-w-2xl px-6 py-6">
            <SimpleApiTry
              v-model:values="tryValues"
              v-model:body="tryBody"
              :source="source"
              :draft="draft"
              :body-hint="sampleBody"
              @use="useResult"
              @pick="usePickedList"
            />
          </div>
        </div>
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
