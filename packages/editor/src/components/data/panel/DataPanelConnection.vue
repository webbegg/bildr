<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue'
import { useEditor } from '../../../editor/useEditor.ts'
import { NEW_CONNECTION_URL } from '../../../shared/dataModel.ts'
import type { DataConnection } from '../../../shared/dataModel.ts'

/**
 * The connection's settings, the top of its Endpoints tab: its name, base URL, timeout and how it authenticates (`datasource_update`,
 * undoable). A connection is a REST data source. The hosted headers list becomes its `auth`: a
 * bearer token or one header, whose secret is an env var only, never a value in the model. The
 * panel says whether that variable is set (`env_status`, read-only: the user edits `.env`).
 * A new connection focuses its base URL.
 */
const props = defineProps<{ connection: DataConnection }>()
const editor = useEditor()

const AUTH_TYPES = [{ label: 'None', value: 'none' }, { label: 'Bearer token', value: 'bearer' }, { label: 'Header', value: 'header' }]

function update(patch: Record<string, unknown>) {
  return editor.run('datasource_update', { datasource: props.connection.id, ...patch })
}

const auth = computed(() => props.connection.auth)
const secretStatus = computed(() => editor.env.find(entry => entry.name === auth.value?.env))
const baseUrlStatus = computed(() => editor.env.find(entry => entry.name === props.connection.baseUrlEnv))

function setAuthType(type: string) {
  if (type === 'none') return void update({ auth: null })
  if (type === auth.value?.type) return
  void update({ auth: type === 'bearer' ? { type, secret: auth.value?.secret ?? 'apiKey' } : { type, secret: auth.value?.secret ?? 'apiKey', header: auth.value?.header ?? 'X-Api-Key' } })
}

function setHeader(header: string) {
  if (auth.value && header.trim()) void update({ auth: { type: 'header', secret: auth.value.secret, header: header.trim() } })
}

/** Whole seconds from 1 to `max`, null for an empty field, or undefined for anything else (not sent; the field says so). */
const secondsOf = (value: string, max: number): number | null | undefined => {
  const text = value.trim()
  if (text === '') return null
  const seconds = Number(text)
  return /^\d+$/.test(text) && seconds >= 1 && seconds <= max ? seconds : undefined
}

/** A timeout is 1 to 60 s; empty gives the default back. */
const timeoutInvalid = ref(false)
function setTimeoutS(value: string) {
  const seconds = secondsOf(value, 60)
  timeoutInvalid.value = seconds === undefined
  if (seconds !== undefined) void update({ timeout: seconds })
}

/** How long the server keeps its reads: 1 s to a day; empty for no cache. */
const cacheInvalid = ref(false)
function setCacheTtl(value: string) {
  const seconds = secondsOf(value, 86_400)
  cacheInvalid.value = seconds === undefined
  if (seconds !== undefined) void update({ cache: seconds === null ? null : { ttl: seconds } })
}

function showVariables() {
  editor.mode = 'settings'
  editor.variablesRequest++
}

const baseUrl = useTemplateRef<HTMLElement>('baseUrl')
onMounted(async () => {
  if (props.connection.baseUrl !== NEW_CONNECTION_URL) return
  await nextTick()
  const input = baseUrl.value?.querySelector('input')
  input?.focus()
  input?.select()
})
</script>

<template>
  <div
    data-connection-panel
    :data-connection-id="connection.id"
  >
    <EditorStyleSection label="Connection">
      <EditorRow
        label="Name"
        name="name"
      >
        <EditorCommitInput
          :model-value="connection.name"
          aria-label="Connection name"
          size="xs"
          variant="soft"
          data-connection-name-input
          @commit="update({ name: $event })"
        />
      </EditorRow>
      <EditorRow
        label="Base URL"
        title="Endpoint paths are relative to it"
        name="baseUrl"
      >
        <div
          ref="baseUrl"
          class="min-w-0 flex-1"
          data-connection-base-url
        >
          <EditorCommitInput
            :model-value="connection.baseUrl"
            aria-label="Base URL"
            placeholder="https://api.example.com/v1"
            size="xs"
            variant="soft"
            @commit="update({ defaults: { baseUrl: $event.trim() } })"
          />
        </div>
        <template
          v-if="connection.baseUrlEnv"
          #below
        >
          <p
            class="text-[11px] leading-4 text-dimmed"
            data-base-url-env
          >
            Set <code>{{ connection.baseUrlEnv }}</code> in <code>.env</code> to change it per environment{{ baseUrlStatus?.set ? ' (set)' : '' }}
          </p>
        </template>
      </EditorRow>
      <EditorRow
        label="Timeout"
        title="Seconds a call may wait for its answer (1 to 60), retries included; empty for 10"
        name="timeout"
      >
        <EditorCommitInput
          :model-value="connection.timeout === undefined ? '' : String(connection.timeout)"
          aria-label="Timeout"
          placeholder="10"
          size="xs"
          variant="soft"
          numeric
          :invalid="timeoutInvalid"
          data-connection-timeout
          @edit="timeoutInvalid = false"
          @commit="setTimeoutS"
        />
      </EditorRow>
      <EditorRow
        label="Cache"
        title="Seconds the server keeps the answers to its reads (1 to 86400), in its memory; a write through it forgets them. Empty for none"
        name="cache"
      >
        <EditorCommitInput
          :model-value="connection.cacheTtl === undefined ? '' : String(connection.cacheTtl)"
          aria-label="Cache"
          placeholder="None"
          size="xs"
          variant="soft"
          numeric
          :invalid="cacheInvalid"
          data-connection-cache
          @edit="cacheInvalid = false"
          @commit="setCacheTtl"
        />
      </EditorRow>
    </EditorStyleSection>

    <EditorStyleSection label="Auth">
      <EditorRow
        label="Type"
        title="How requests to the API are authenticated"
        name="authType"
      >
        <EditorSelect
          :model-value="auth?.type ?? 'none'"
          :items="AUTH_TYPES"
          aria-label="Auth type"
          class="min-w-0 flex-1"
          data-auth-type
          @update:model-value="setAuthType"
        />
      </EditorRow>
      <EditorRow
        v-if="auth?.type === 'header'"
        label="Header"
        title="The header that carries the secret"
        name="authHeader"
      >
        <EditorCommitInput
          :model-value="auth.header ?? ''"
          aria-label="Header name"
          placeholder="X-Api-Key"
          size="xs"
          variant="soft"
          data-auth-header
          @commit="setHeader"
        />
      </EditorRow>
      <EditorRow
        v-if="auth"
        label="Secret"
        title="The env var that holds the secret: its value is never in the model"
        name="authSecret"
      >
        <span class="flex h-[30px] min-w-0 flex-1 items-center gap-2 text-[12px]">
          <code
            class="truncate font-mono text-[11px] text-toned"
            :title="auth.env"
            data-auth-env
          >{{ auth.env }}</code>
          <span
            class="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-[550]"
            :class="secretStatus?.set ? 'bg-success/12 text-success' : 'bg-white/6 text-dimmed'"
            data-auth-status
          >{{ secretStatus?.set ? 'Set' : 'Not set' }}</span>
        </span>
      </EditorRow>
      <p class="text-[11px] leading-4 text-dimmed">
        The secret is sent only to the base URL's origin, and set in <code>.env</code>, never here.
        <button
          type="button"
          class="text-toned underline-offset-2 hover:text-highlighted hover:underline"
          data-show-variables
          @click="showVariables"
        >
          Settings › Variables
        </button>
      </p>
    </EditorStyleSection>
  </div>
</template>
