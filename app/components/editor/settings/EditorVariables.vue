<script lang="ts">
/** The last "Environment variables" request each editor's Settings answered, so one made before it mounts (⌘K from the Canvas) still scrolls. */
</script>

<script setup lang="ts">
import { ENV_NAME, ENV_NAME_HINT } from '#shared/env/variables'

const answeredRequests = new WeakMap<object, number>()

/**
 * The Settings view's Variables section: the project's environment variables
 * (`env_*` actions, not undoable), one row each with its name, value and
 * Secret switch. Public values commit on blur or Enter; secret ones are
 * write-only, so they show masked with Replace. Turning a variable secret is
 * direct (with a republish reminder, since the published snapshot still holds
 * the old public value); turning a secret public asks for a new value, never
 * revealing it.
 */
const editor = useEditor()
const toast = useToast()
// Settings' published info (same key); null once known to be unpublished.
const { data: published } = useNuxtData(`published-${editor.projectId}`)

const HELP = 'Use {{ env.NAME }} in texts, links, images, theme colours and API URLs. Secret values are only used on the server for API requests and never reach the browser.'
const MASK = '••••••••'

const section = useTemplateRef<HTMLElement>('section')
watch(() => editor.variablesRequest, async (request) => {
  if (request > (answeredRequests.get(editor) ?? 0)) {
    await nextTick()
    section.value?.scrollIntoView({ block: 'start' })
  }
  answeredRequests.set(editor, request)
}, { immediate: true })

/** A secret whose value is being replaced; `toPublic` when the new value also makes it public. */
const replacing = ref<{ name: string, toPublic: boolean } | null>(null)
const replacement = ref('')

function startReplace(name: string, toPublic = false) {
  replacing.value = { name, toPublic }
  replacement.value = ''
}

async function saveReplace() {
  const target = replacing.value
  if (!target) return
  replacing.value = null
  if (!replacement.value) return
  await editor.runEnv('env_set', { name: target.name, value: replacement.value, ...(target.toPublic ? { secret: false } : {}) })
}

function setValue(name: string, value: string) {
  void editor.runEnv('env_set', { name, value })
}

async function setSecret(name: string, secret: boolean) {
  if (!secret) return startReplace(name, true)
  if (await editor.runEnv('env_set', { name, secret: true }) && published.value !== null) {
    toast.add({ title: `"${name}" is now secret`, description: 'Republish to remove the old value from the published app.', color: 'warning', icon: 'i-lucide-triangle-alert' })
  }
}

function remove(name: string) {
  if (confirm(`Delete the variable "${name}"? References to it stop resolving.`)) void editor.runEnv('env_delete', { name })
}

const adding = ref(false)
const draft = reactive({ name: '', value: '', secret: false })
const nameProblem = computed(() => {
  if (!draft.name) return ''
  if (!ENV_NAME.test(draft.name)) return ENV_NAME_HINT
  return editor.env.some(v => v.name === draft.name) ? `The variable "${draft.name}" already exists` : ''
})

function startAdd() {
  Object.assign(draft, { name: '', value: '', secret: false })
  adding.value = true
}

async function add() {
  if (!draft.name || nameProblem.value) return
  if (await editor.runEnv('env_set', { ...draft })) adding.value = false
}
</script>

<template>
  <section
    ref="section"
    class="scroll-mt-6 space-y-3"
    data-env-section
  >
    <h2 class="text-xs font-semibold text-muted uppercase">
      Variables
    </h2>
    <p class="text-sm text-muted">
      {{ HELP }}
    </p>

    <div
      v-if="editor.env.length || adding"
      class="divide-y divide-default rounded-md ring ring-default"
    >
      <div
        v-for="v in editor.env"
        :key="v.name"
        class="flex items-center gap-2 px-3 py-1.5"
        :data-env-row="v.name"
        :data-env-secret="v.secret || undefined"
      >
        <code
          class="w-40 shrink-0 truncate font-mono text-xs text-highlighted"
          :title="v.name"
        >{{ v.name }}</code>
        <div class="min-w-0 flex-1">
          <UInput
            v-if="replacing?.name === v.name"
            v-model="replacement"
            :placeholder="replacing.toPublic ? 'New public value' : 'New secret value'"
            :type="replacing.toPublic ? 'text' : 'password'"
            size="sm"
            class="w-full"
            autofocus
            data-env-replace-input
            @keydown.enter="saveReplace"
            @keydown.esc="replacing = null"
            @blur="saveReplace"
          />
          <div
            v-else-if="v.secret"
            class="flex items-center gap-2"
          >
            <span
              class="flex-1 font-mono text-sm text-muted"
              data-env-masked
            >{{ MASK }}</span>
            <UButton
              label="Replace"
              color="neutral"
              variant="outline"
              size="xs"
              data-env-replace
              @click="startReplace(v.name)"
            />
          </div>
          <EditorCommitInput
            v-else
            :model-value="v.value"
            data-env-value
            @commit="value => setValue(v.name, value)"
          />
        </div>
        <USwitch
          :model-value="v.secret"
          label="Secret"
          size="sm"
          data-env-secret-switch
          @update:model-value="value => setSecret(v.name, value)"
        />
        <UButton
          icon="i-lucide-minus"
          color="neutral"
          variant="ghost"
          size="xs"
          :aria-label="`Delete ${v.name}`"
          data-env-delete
          @click="remove(v.name)"
        />
      </div>

      <form
        v-if="adding"
        class="space-y-1 px-3 py-2"
        data-env-new
        @submit.prevent="add"
      >
        <div class="flex items-center gap-2">
          <UInput
            v-model="draft.name"
            placeholder="NAME"
            size="sm"
            class="w-40 shrink-0"
            :ui="{ base: 'font-mono' }"
            :color="nameProblem ? 'error' : undefined"
            :highlight="!!nameProblem"
            autofocus
            data-env-new-name
            @keydown.esc="adding = false"
          />
          <UInput
            v-model="draft.value"
            placeholder="Value"
            :type="draft.secret ? 'password' : 'text'"
            size="sm"
            class="min-w-0 flex-1"
            data-env-new-value
            @keydown.esc="adding = false"
          />
          <USwitch
            v-model="draft.secret"
            label="Secret"
            size="sm"
            data-env-new-secret
          />
        </div>
        <p
          v-if="nameProblem"
          class="text-xs text-error"
          data-env-name-hint
        >
          {{ nameProblem }}
        </p>
        <div class="flex justify-end gap-2 pt-1">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="adding = false"
          />
          <UButton
            type="submit"
            label="Add"
            size="xs"
            :disabled="!draft.name || !!nameProblem"
            data-env-new-save
          />
        </div>
      </form>
    </div>

    <UButton
      v-if="!adding"
      label="Add variable"
      icon="i-lucide-plus"
      color="neutral"
      variant="outline"
      size="sm"
      data-env-add
      @click="startAdd"
    />
  </section>
</template>
