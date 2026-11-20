<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import DataArtifactDialog from '../data/DataArtifactDialog.vue'
import { attempt } from '../../editor/dataArtifactActions.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { RUNTIMES, SIGN_INS, baseUrlProblem, kebabNameOf } from '../../shared/simpleApi.ts'
import { plainWords } from '../../shared/simpleData.ts'
import type { Runtime, SignIn } from '../../editor/simpleApiDraft.ts'

/**
 * The New API dialog of the simple Data section (simple data, S4, S5): a name, the base URL every call is under (checked as it is typed
 * with the module's own rule, `urlProblem`, and its words), where the calls run (on the server, which can hold a secret key, or in the
 * visitor's browser, which can't) and how the API signs in (not at all, a bearer token, or an API key header with the header's name).
 * `api_create` makes it and the section opens it. The secret key is never typed here: the API's panel names the env var to set in `.env`
 * and says whether it is set. What the module refuses is shown in the dialog and what was typed stays.
 */
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ created: [id: string] }>()
const editor = useEditor()

const name = ref('')
const baseUrl = ref('')
const runtime = ref<Runtime>('server')
const signIn = ref<SignIn>('none')
const header = ref('')
const error = ref('')
const saving = ref(false)

// Each opening starts clean.
watch(open, (now) => {
  if (!now) return
  name.value = ''
  baseUrl.value = ''
  runtime.value = 'server'
  signIn.value = 'none'
  header.value = ''
  error.value = ''
})
watch([name, baseUrl, runtime, signIn, header], () => {
  error.value = ''
})
// The browser can't keep a secret: its API has no sign-in.
watch(runtime, (now) => {
  if (now === 'browser') signIn.value = 'none'
})

/** The name the module gives it (kebab-case), said under the field when it is not what was typed, as the item dialogs do. */
const called = computed(() => kebabNameOf(name.value))
const urlProblem = computed(() => baseUrlProblem(baseUrl.value))
const canSubmit = computed(() => !!name.value.trim() && !!baseUrl.value.trim() && !urlProblem.value && (signIn.value !== 'header' || !!header.value.trim()))

async function submit() {
  if (!canSubmit.value || saving.value) return
  saving.value = true
  const auth = signIn.value === 'none' ? undefined : { type: signIn.value, ...(signIn.value === 'header' ? { header: header.value.trim() } : {}) }
  const done = await attempt<{ datasourceId: string }>(editor, 'api_create', {
    name: name.value.trim(),
    baseUrl: baseUrl.value.trim(),
    runtime: runtime.value,
    ...(auth ? { auth } : {})
  }, 'Could not create the API')
  saving.value = false
  if ('error' in done) {
    error.value = plainWords(done.error)
    return
  }
  await editor.reloadEnv()
  open.value = false
  emit('created', done.result.datasourceId)
}
</script>

<template>
  <DataArtifactDialog
    v-model:open="open"
    dialog="create"
    title="New API"
    description="A remote API your app calls, like a shop's or a blog's."
    :error="error"
    :saving="saving"
    submit-label="Create API"
    :can-submit="canSubmit"
    @submit="submit"
  >
    <EditorFormRow
      label="Name"
      :help="called && called !== name.trim() ? `It will be called “${called}”` : 'Any words, like “Shop API”'"
      stacked
    >
      <EditorInput
        v-model="name"
        placeholder="Shop API"
        autofocus
        aria-label="Name"
        data-api-new-name
        @keydown.enter.prevent="submit"
      />
    </EditorFormRow>
    <div>
      <EditorFormRow
        label="Base URL"
        help="The address every call starts with, like “https://api.example.com/v1”"
        stacked
      >
        <EditorInput
          v-model="baseUrl"
          placeholder="https://api.example.com/v1"
          aria-label="Base URL"
          :invalid="!!urlProblem"
          data-api-new-url
          @keydown.enter.prevent="submit"
        />
      </EditorFormRow>
      <p
        v-if="urlProblem"
        class="mt-1 text-[12px] leading-4 text-error"
        role="alert"
        data-api-new-url-error
      >
        {{ plainWords(urlProblem) }}
      </p>
    </div>
    <EditorFormRow
      label="Where it runs"
      stacked
    >
      <EditorChoiceCards
        :model-value="runtime"
        :items="RUNTIMES"
        label="Where it runs"
        hook="data-api-new-runtime"
        @update:model-value="runtime = $event as Runtime"
      />
    </EditorFormRow>
    <EditorFormRow
      label="Sign-in"
      stacked
    >
      <EditorChoiceCards
        :model-value="signIn"
        :items="SIGN_INS"
        label="Sign-in"
        :disabled="runtime === 'browser'"
        hook="data-api-new-signin"
        @update:model-value="signIn = $event as SignIn"
      />
    </EditorFormRow>
    <p
      v-if="runtime === 'browser'"
      class="text-[12px] leading-4 text-muted"
      data-api-new-signin-note
    >
      An API that runs in the browser has no secret key, so it can't sign in. Run it on the server to use one.
    </p>
    <EditorFormRow
      v-if="signIn === 'header'"
      label="Header name"
      help="The header your API reads the key from"
      stacked
    >
      <EditorInput
        v-model="header"
        placeholder="X-Api-Key"
        aria-label="Header name"
        data-api-new-header
        @keydown.enter.prevent="submit"
      />
    </EditorFormRow>
    <p
      v-if="signIn !== 'none'"
      class="flex items-start gap-2 rounded-lg bg-white/4 px-3 py-2 text-[12px] leading-4 text-muted"
    >
      <UIcon
        name="i-lucide-key-round"
        class="size-4 shrink-0"
      />
      <span>The secret key is never typed here. Once the API is made, its page names the variable to set in your <code>.env</code> file.</span>
    </p>
  </DataArtifactDialog>
</template>
