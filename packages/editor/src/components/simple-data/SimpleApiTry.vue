<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { ApiModel } from '@bildr/codegen/model'
import type { ApiSource } from '@bildr/codegen/edit'
import { callAction, errorMessage } from '../../api.ts'
import DataInlineError from '../data/DataInlineError.vue'
import SimpleApiProposal from './SimpleApiProposal.vue'
import SimpleApiAnswer from './SimpleApiAnswer.vue'
import SimpleApiRequestPreview from './SimpleApiRequestPreview.vue'
import { durationLabel, resolvedRequest, sizeLabel } from '../../editor/tryRequest.ts'
import { paramsOutput, tryParams } from '../../editor/simpleApiDraft.ts'
import type { OperationDraft } from '../../editor/simpleApiDraft.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { hostOfUrl, listShown, typeLabel } from '../../shared/simpleApi.ts'
import { plainWords } from '../../shared/simpleData.ts'

/**
 * "Try it" (simple data, S4, S6): sends one real call of the query or action being edited, as the generated app would (`api_try`, through
 * the module's guards: under the base URL only, a time limit and a size cap, the secret from the env and never shown), and shows what the
 * API answered: its status, the answer (folded, a list cut to its first items), the list found in it and, when there is something to
 * learn from it, "Use this answer" (`SimpleApiProposal`), which makes the models and tells the form what the call answers.
 *
 * It asks for a value for each parameter, by what the form holds now, saved or not. A query only reads, so it is sent at once. An action
 * can change data in the API, so it asks first ("This sends a real POST to <host>: it can change data there") and only then sends, with
 * `confirm: true`; its body is the JSON typed here (or the sample the action's body model was made from, `bodyHint`, when nothing is typed),
 * and nothing is sent when it is not JSON. A refusal is shown in plain words.
 *
 * The values and the body are the editor's (`v-model:values`, `v-model:body`), so a request pasted into the path can fill them in.
 * Above Try it is the request as it will be sent (`SimpleApiRequestPreview`); the answer says how long it took and how big it was, and
 * shows itself as a tree, raw or its headers (`SimpleApiAnswer`), where a click on a list makes it where the operation's list is (`pick`).
 *
 * The answer is of the call that was sent: it goes (with "Use this answer") when the path, the method or the parameters change, and while
 * a new call is on its way, and an answer that comes after that is not shown.
 */
const { source, draft, bodyHint = '' } = defineProps<{
  source: ApiSource
  draft: OperationDraft
  /** The sample an action's body model was made from: the body to send, until one is typed. */
  bodyHint?: string
}>()
const emit = defineEmits<{ use: [result: { model: string, many: boolean, itemsPath: string }, added: number], pick: [itemsPath: string] }>()
const editor = useEditor()

interface Answer {
  status: number
  url: string
  json?: unknown
  text?: string
  durationMs?: number
  size?: number
  headers?: Record<string, string>
  items?: { path: string, count: number }
  proposal?: { result: { model: string, many: boolean, itemsPath?: string }, models: ApiModel[] }
}

const values = defineModel<Record<string, string | boolean>>('values', { default: () => ({}) })
const body = defineModel<string>('body', { default: '' })
const running = ref(false)
const error = ref('')
const answer = shallowRef<Answer | null>(null)

const params = computed(() => paramsOutput(draft))
const isWrite = computed(() => draft.kind === 'action')
const hasBody = computed(() => isWrite.value && draft.method !== 'DELETE')
const method = computed(() => draft.kind === 'query' ? 'GET' : draft.method)
const request = computed(() => resolvedRequest(source, draft, values.value, body.value))

/** Tells a call from the next: an answer is shown only while no other call has been made and nothing it was made of has changed. */
let call = 0
watch(() => JSON.stringify([draft.path.trim(), method.value, params.value]), () => {
  call++
  answer.value = null
})
watch(() => bodyHint, (hint, was) => {
  if (hint && (!body.value.trim() || body.value === was)) body.value = hint
})
const ok = computed(() => !!answer.value && answer.value.status >= 200 && answer.value.status < 300)

/** What the call can't go without: a path parameter, a required query parameter. */
const missing = computed(() => params.value.find(param => param.type !== 'boolean' && (param.in === 'path' || param.required) && (values.value[param.name] ?? '') === ''))

/** The body typed, as the JSON it is; undefined for none; null when it is not JSON (or not an object or a list). */
function parsedBody(): Record<string, unknown> | unknown[] | undefined | null {
  const typed = body.value.trim()
  if (!hasBody.value || !typed) return undefined
  try {
    const parsed: unknown = JSON.parse(typed)
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> | unknown[] : null
  } catch {
    return null
  }
}

async function run() {
  if (running.value) return
  error.value = ''
  if (missing.value) {
    error.value = `Give a value for “${missing.value.name}” first`
    return
  }
  const sent = parsedBody()
  if (sent === null) {
    error.value = 'The body is not JSON: use an object like {"title": "Lamp"}'
    return
  }
  if (isWrite.value && !await editor.confirm({
    title: `Send a real ${method.value}?`,
    description: `This sends a real ${method.value} to ${hostOfUrl(source.baseUrl)}: it can change data there.`,
    confirmLabel: `Send ${method.value}`,
    danger: true
  })) return
  const given = tryParams(draft, values.value)
  const mine = ++call
  running.value = true
  answer.value = null
  try {
    const answered = await callAction<Answer>('api_try', {
      datasource: source.id,
      path: draft.path.trim(),
      ...(isWrite.value ? { method: draft.method, confirm: true } : {}),
      ...(Object.keys(given).length ? { params: given } : {}),
      ...(sent !== undefined ? { body: sent } : {})
    })
    if (mine === call) answer.value = answered
  } catch (failure) {
    if (mine !== call) return
    error.value = plainWords(errorMessage(failure))
  } finally {
    running.value = false
  }
}

const found = computed(() => {
  const items = answer.value?.items
  if (!items) return ''
  const count = `${items.count} ${items.count === 1 ? 'item' : 'items'}`
  // The answer shows the first items only: say so when it is not the whole list.
  const shown = listShown(answer.value?.json, items.path)
  if (shown !== undefined && shown < items.count) return items.path ? `Found a list at “${items.path}”: first ${shown} of ${count}` : `The answer is a list: first ${shown} of ${count}`
  return items.path ? `Found a list of ${count} at “${items.path}”` : `The answer is a list of ${count}`
})

const use = (root: string, added: number) => {
  const result = answer.value?.proposal?.result
  if (result) emit('use', { model: root, many: result.many, itemsPath: result.itemsPath ?? '' }, added)
}
</script>

<template>
  <section
    class="space-y-3"
    data-api-try
  >
    <h3 class="flex h-9 items-center text-[12px] font-[550] text-highlighted">
      Try it
    </h3>
    <p class="text-[12px] leading-4 text-muted">
      <template v-if="isWrite">
        Sends a real {{ method }} to {{ hostOfUrl(source.baseUrl) }}, after asking you. It can change data there.
      </template>
      <template v-else>
        Sends the call to the API and shows what it answers, so you can see the data before you use it.
      </template>
    </p>
    <div
      v-if="params.length"
      class="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5"
    >
      <template
        v-for="param in params"
        :key="`${param.in}:${param.name}`"
      >
        <label
          class="truncate text-[12px] text-muted"
          :title="`${param.name} (${typeLabel(param.type)})`"
        >{{ param.name }}</label>
        <input
          v-if="param.type === 'boolean'"
          type="checkbox"
          class="size-3.5 cursor-pointer scheme-dark accent-(--ui-primary)"
          :checked="values[param.name] === true"
          :aria-label="`Value of ${param.name}`"
          :data-try-input="param.name"
          @change="values[param.name] = ($event.target as HTMLInputElement).checked"
        >
        <EditorInput
          v-else
          :model-value="String(values[param.name] ?? '')"
          :type="param.type === 'text' ? 'text' : 'number'"
          :step="param.type === 'integer' ? 1 : param.type === 'number' ? 'any' : undefined"
          :placeholder="param.in === 'path' || param.required ? 'Needed' : 'Optional'"
          :aria-label="`Value of ${param.name}`"
          :data-try-input="param.name"
          @update:model-value="values[param.name] = String($event)"
        />
      </template>
    </div>
    <EditorFormRow
      v-if="hasBody"
      label="Body to send"
      help="The JSON the call sends. Leave it empty to send nothing."
      stacked
    >
      <EditorTextarea
        v-model="body"
        mono
        :rows="4"
        placeholder="{&quot;title&quot;: &quot;Lamp&quot;}"
        aria-label="Body to send"
        data-try-body
      />
    </EditorFormRow>
    <SimpleApiRequestPreview :request="request" />
    <div class="flex items-center gap-2">
      <EditorButton
        variant="primary"
        icon="i-lucide-play"
        label="Try it"
        :loading="running"
        data-try-run
        @click="run"
      />
    </div>
    <DataInlineError
      v-if="error"
      icon
      data-try-error
    >
      {{ error }}
    </DataInlineError>

    <div
      v-if="answer"
      class="space-y-2 rounded-lg bg-white/4 px-3 py-3"
      data-try-answer
    >
      <p class="flex flex-wrap items-center gap-2 text-[12px]">
        <span
          class="rounded-md px-1.5 py-0.5 font-[550]"
          :class="ok ? 'bg-success/12 text-success' : 'bg-error/12 text-error'"
          data-try-status
        >Status {{ answer.status }}</span>
        <span
          v-if="answer.durationMs !== undefined"
          class="text-dimmed"
          data-try-time
        >{{ durationLabel(answer.durationMs) }}</span>
        <span
          v-if="answer.size !== undefined"
          class="text-dimmed"
          data-try-size
        >{{ sizeLabel(answer.size) }}</span>
        <code
          class="min-w-0 truncate font-mono text-[11px] text-dimmed"
          data-try-url
        >{{ answer.url }}</code>
      </p>
      <p
        v-if="found"
        class="text-[12px] text-toned"
        data-try-items
      >
        {{ found }}
      </p>
      <SimpleApiAnswer
        :json="answer.json"
        :text="answer.text"
        :headers="answer.headers"
        :current="draft.result?.many ? draft.result.itemsPath.trim() : null"
        :pickable="!!draft.result"
        @pick="emit('pick', $event)"
      />
      <SimpleApiProposal
        v-if="answer.proposal"
        :datasource="source.id"
        :models="answer.proposal.models"
        :existing="source.models"
        :fills="draft.kind"
        button="data-try-use"
        @applied="use"
      />
    </div>
  </section>
</template>
