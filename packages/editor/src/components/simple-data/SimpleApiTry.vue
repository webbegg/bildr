<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import type { ApiModel } from '@bildr/codegen/model'
import type { ApiSource } from '@bildr/codegen/edit'
import { callAction, errorMessage } from '../../api.ts'
import DataInlineError from '../data/DataInlineError.vue'
import SimpleApiProposal from './SimpleApiProposal.vue'
import { paramsOutput, tryParams } from '../../editor/simpleApiDraft.ts'
import type { OperationDraft } from '../../editor/simpleApiDraft.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { hostOfUrl, typeLabel } from '../../shared/simpleApi.ts'
import { plainWords } from '../../shared/simpleData.ts'

/**
 * "Try it" (simple data, S4, S6): sends one real call of the query or action being edited, as the generated app would (`api_try`, through
 * the module's guards: under the base URL only, a time limit and a size cap, the secret from the env and never shown), and shows what the
 * API answered: its status, the answer (folded, a list cut to its first items), the list found in it and, when there is something to
 * learn from it, "Use this answer" (`SimpleApiProposal`), which makes the models and tells the form what the call answers.
 *
 * It asks for a value for each parameter, by what the form holds now, saved or not. A query only reads, so it is sent at once. An action
 * can change data in the API, so it asks first ("This sends a real POST to <host>: it can change data there") and only then sends, with
 * `confirm: true`; its body is the JSON typed here, and nothing is sent when it is not JSON. A refusal is shown in plain words.
 */
const { source, draft } = defineProps<{ source: ApiSource, draft: OperationDraft }>()
const emit = defineEmits<{ use: [result: { model: string, many: boolean, itemsPath: string }] }>()
const editor = useEditor()

interface Answer {
  status: number
  url: string
  json?: unknown
  text?: string
  items?: { path: string, count: number }
  proposal?: { result: { model: string, many: boolean, itemsPath?: string }, models: ApiModel[] }
}

const values = ref<Record<string, string | boolean>>({})
const body = ref('')
const running = ref(false)
const error = ref('')
const answer = shallowRef<Answer | null>(null)

const params = computed(() => paramsOutput(draft))
const isWrite = computed(() => draft.kind === 'action')
const hasBody = computed(() => isWrite.value && draft.method !== 'DELETE')
const method = computed(() => draft.kind === 'query' ? 'GET' : draft.method)
const shownJson = computed(() => answer.value?.json !== undefined ? JSON.stringify(answer.value.json, null, 2) : answer.value?.text ?? '')
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
  running.value = true
  try {
    answer.value = await callAction<Answer>('api_try', {
      datasource: source.id,
      path: draft.path.trim(),
      ...(isWrite.value ? { method: draft.method, confirm: true } : {}),
      ...(Object.keys(given).length ? { params: given } : {}),
      ...(sent !== undefined ? { body: sent } : {})
    })
  } catch (failure) {
    answer.value = null
    error.value = plainWords(errorMessage(failure))
  } finally {
    running.value = false
  }
}

const found = computed(() => {
  const items = answer.value?.items
  if (!items) return ''
  const count = `${items.count} ${items.count === 1 ? 'item' : 'items'}`
  return items.path ? `Found a list of ${count} at “${items.path}”` : `The answer is a list of ${count}`
})

const use = (root: string) => {
  const result = answer.value?.proposal?.result
  if (result) emit('use', { model: root, many: result.many, itemsPath: result.itemsPath ?? '' })
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
      <details data-try-json>
        <summary class="cursor-pointer text-[12px] text-muted">
          {{ answer.json !== undefined ? 'The answer' : 'What it said' }}
        </summary>
        <pre class="mt-2 max-h-72 overflow-auto rounded-md bg-black/20 p-2 font-mono text-[11px] leading-4 text-toned">{{ shownJson }}</pre>
      </details>
      <SimpleApiProposal
        v-if="answer.proposal"
        :datasource="source.id"
        :models="answer.proposal.models"
        :existing="source.models"
        button="data-try-use"
        @applied="use"
      />
    </div>
  </section>
</template>
