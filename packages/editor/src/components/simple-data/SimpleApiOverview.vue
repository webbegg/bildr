<script setup lang="ts">
import { computed } from 'vue'
import type { ApiSource } from '@bildr/codegen/edit'
import DataDraftFooter from '../data/DataDraftFooter.vue'
import DataStaleNotice from '../data/DataStaleNotice.vue'
import SimpleApiList from './SimpleApiList.vue'
import type { ItemKind } from './SimpleApiItemDialog.vue'
import { attempt } from '../../editor/dataArtifactActions.ts'
import { apiQueryPages, usedInPagesWords } from '../../shared/apiPageUse.ts'
import { settingsChangedOutside, settingsDirty, settingsInput, settingsOf, settingsProblems, settingsRebase } from '../../editor/simpleApiDraft.ts'
import type { Runtime, SignIn } from '../../editor/simpleApiDraft.ts'
import { useDraftForm } from '../../editor/useDraftForm.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { RUNTIMES, SIGN_INS, actionSummary, baseUrlProblem, modelSummary, querySummary, secretVarAfterRename, secretVarOf } from '../../shared/simpleApi.ts'
import { plainWords } from '../../shared/simpleData.ts'

/**
 * What an API's panel shows when no query, action or model is open (simple data, S4, S5, S6): the API's settings, its name, its base URL,
 * where it runs and how it signs in, as one draft with one Save and one Discard (`useDraftForm`, as a store's form), and under them its three
 * lists, Queries, Actions and Models. Save is one `api_update` with what changed; what the module refuses is shown in the footer in the
 * section's words, and the edits stay. The base URL is checked as it is typed with the module's own rule. An API that signs in has a secret
 * key that is never typed here: the panel names the env var to set in `.env` and says whether it is set (`env_status`, names only).
 * Unsaved edits make the workspace ask before it moves away, and an API changed elsewhere says so and asks which version to keep.
 */
const { source } = defineProps<{ source: ApiSource }>()
const emit = defineEmits<{ open: [kind: ItemKind, name: string], create: [kind: ItemKind], rename: [kind: ItemKind, name: string], remove: [kind: ItemKind, name: string] }>()
const editor = useEditor()

const { draft, base, error, saving, dirty, stale, discard, keepMine } = useDraftForm<ApiSource, ReturnType<typeof settingsOf>>({
  stored: () => source,
  id: () => source.id,
  label: () => source.name,
  open: settingsOf,
  dirty: settingsDirty,
  changedOutside: settingsChangedOutside,
  rebase: settingsRebase
})

const urlProblem = computed(() => baseUrlProblem(draft.value.baseUrl))
const problems = computed(() => settingsProblems(draft.value))
const input = computed(() => settingsInput(draft.value, base.value))

function setRuntime(runtime: Runtime) {
  draft.value.runtime = runtime
  // The browser can't keep a secret: an API that runs there has no sign-in.
  if (runtime === 'browser') draft.value.signIn = 'none'
}

async function save() {
  if (stale.value || !dirty.value || saving.value || !input.value || problems.value.length || urlProblem.value) return
  saving.value = true
  const done = await attempt(editor, 'api_update', { datasource: source.id, ...input.value }, 'Could not save the API')
  saving.value = false
  if ('error' in done) {
    error.value = plainWords(done.error)
    return
  }
  await editor.reloadEnv()
  // The model is refreshed: the form shows the API as it is now, and that is what the next edits start from.
  discard()
}

const secret = computed(() => secretVarOf(source))
const secretSet = computed(() => !!secret.value && editor.env.some(entry => entry.name === secret.value && entry.set))
/** What the secret's variable becomes when the API is renamed and saved (`api_update` renames a variable bildr named), before Save says so. */
const renamedSecret = computed(() => draft.value.signIn !== 'none' ? secretVarAfterRename(source, draft.value.name) : undefined)
const note = computed(() => urlProblem.value ? 'Fix the base URL to save.' : problems.value[0] ?? '')

/** Each query with where pages use it (the module's usage): pages that read it are what stops it from being deleted. */
const queryRows = computed(() => source.queries.map((query) => {
  const pages = apiQueryPages(editor.model, source.id, query.name)
  return { name: query.name, note: querySummary(query), ...(pages.length ? { used: usedInPagesWords(pages) } : {}) }
}))
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      class="min-h-0 flex-1 overflow-y-auto"
      data-api-settings
    >
      <div class="mx-auto w-full max-w-2xl space-y-6 px-6 py-6">
        <DataStaleNotice
          v-if="stale"
          prefix="simple-api"
          title="This API changed since you started editing"
          description="Your edits are still here. Load the new version to drop them, or keep them: your settings replace the new ones when you save."
          @load-new="discard"
          @keep-mine="keepMine"
        />

        <section class="space-y-4">
          <EditorFormRow
            label="Name"
            stacked
          >
            <EditorInput
              v-model="draft.name"
              aria-label="Name"
              data-api-name
            />
          </EditorFormRow>
          <div>
            <EditorFormRow
              label="Base URL"
              help="The address every call starts with"
              stacked
            >
              <EditorInput
                v-model="draft.baseUrl"
                placeholder="https://api.example.com/v1"
                aria-label="Base URL"
                :invalid="!!urlProblem"
                data-api-baseurl
              />
            </EditorFormRow>
            <p
              v-if="urlProblem"
              class="mt-1 text-[12px] leading-4 text-error"
              role="alert"
              data-api-baseurl-error
            >
              {{ plainWords(urlProblem) }}
            </p>
          </div>
          <EditorFormRow
            label="Where it runs"
            stacked
          >
            <EditorChoiceCards
              :model-value="draft.runtime"
              :items="RUNTIMES"
              label="Where it runs"
              hook="data-api-runtime"
              @update:model-value="setRuntime($event as Runtime)"
            />
          </EditorFormRow>
          <EditorFormRow
            label="Sign-in"
            stacked
          >
            <EditorChoiceCards
              :model-value="draft.signIn"
              :items="SIGN_INS"
              label="Sign-in"
              :disabled="draft.runtime === 'browser'"
              hook="data-api-signin"
              @update:model-value="draft.signIn = $event as SignIn"
            />
          </EditorFormRow>
          <p
            v-if="draft.runtime === 'browser'"
            class="text-[12px] leading-4 text-muted"
          >
            An API that runs in the browser has no secret key, so it can't sign in. Run it on the server to use one.
          </p>
          <EditorFormRow
            v-if="draft.signIn === 'header'"
            label="Header name"
            help="The header your API reads the key from"
            stacked
          >
            <EditorInput
              v-model="draft.header"
              placeholder="X-Api-Key"
              aria-label="Header name"
              data-api-header
            />
          </EditorFormRow>
          <div
            v-if="secret"
            class="space-y-2 rounded-lg bg-white/4 px-3 py-2.5 text-[12px] leading-4 text-muted"
            data-api-secret
          >
            <p class="flex items-center gap-2">
              <UIcon
                name="i-lucide-key-round"
                class="size-4 shrink-0"
              />
              <span>Set the secret key in your <code>.env</code> file, never here. The variable is:</span>
            </p>
            <p class="flex items-center gap-2">
              <code
                class="min-w-0 truncate font-mono text-[11px] text-toned"
                :title="secret"
                data-api-secret-var
              >{{ secret }}</code>
              <span
                class="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-[550]"
                :class="secretSet ? 'bg-success/12 text-success' : 'bg-white/6 text-dimmed'"
                data-api-secret-status
              >{{ secretSet ? 'Set' : 'Not set' }}</span>
              <EditorButton
                variant="ghost"
                size="xs"
                icon="i-lucide-refresh-cw"
                label="Check again"
                data-api-secret-refresh
                @click="editor.reloadEnv()"
              />
            </p>
            <p
              v-if="renamedSecret"
              data-api-secret-rename
            >
              The secret's variable becomes <code class="font-mono text-[11px] text-toned">{{ renamedSecret }}</code> when you save. Set it in your <code>.env</code> file under that name.
            </p>
          </div>
          <p
            v-else-if="draft.signIn !== 'none'"
            class="text-[12px] leading-4 text-muted"
          >
            Save to see the name of the variable that holds the secret key.
          </p>
        </section>

        <SimpleApiList
          kind="query"
          title="Queries"
          :rows="queryRows"
          empty="No queries yet. A query reads data from the API, like the list of products."
          @open="emit('open', 'query', $event)"
          @create="emit('create', 'query')"
          @rename="emit('rename', 'query', $event)"
          @remove="emit('remove', 'query', $event)"
        />
        <SimpleApiList
          kind="action"
          title="Actions"
          :rows="source.actions.map(action => ({ name: action.name, note: actionSummary(action) }))"
          empty="No actions yet. An action changes data in the API, like adding a product."
          @open="emit('open', 'action', $event)"
          @create="emit('create', 'action')"
          @rename="emit('rename', 'action', $event)"
          @remove="emit('remove', 'action', $event)"
        />
        <SimpleApiList
          kind="model"
          title="Models"
          :rows="source.models.map(model => ({ name: model.name, note: modelSummary(model) }))"
          empty="No models yet. A model is the shape of what the API answers or takes, like a product with a title and a price."
          @open="emit('open', 'model', $event)"
          @create="emit('create', 'model')"
          @rename="emit('rename', 'model', $event)"
          @remove="emit('remove', 'model', $event)"
        />
      </div>
    </div>

    <DataDraftFooter
      prefix="simple-api"
      inner="mx-auto max-w-2xl px-6"
      :error="error"
      :note="note"
      :dirty="dirty"
      :saving="saving"
      :disabled="!dirty || stale || !!note"
      @discard="discard"
      @save="save"
    />
  </div>
</template>
