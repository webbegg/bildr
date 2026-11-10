<script setup lang="ts">
import type { ApiHeader, Connection } from '#shared/document/schema'
import { NEW_CONNECTION_URL } from '../DataCollections.vue'

/**
 * The connection panel: its name, base URL and the headers sent with every
 * request (`connection_update`, undoable; headers save as a whole list). The
 * values are stored as written, so a secret shows as its `{{ env.NAME }}`
 * reference, never its value. A new connection focuses its base URL.
 */
const props = defineProps<{ connection: Connection }>()
const editor = useEditor()
const SOFT = 'h-[30px] rounded-lg bg-elevated font-mono text-[12px]'

const HEADER_PRESETS: Record<string, ApiHeader> = {
  authorization: { name: 'Authorization', value: 'Bearer {{ env.API_KEY }}' },
  apiKey: { name: 'X-API-Key', value: '{{ env.API_KEY }}' },
  custom: { name: '', value: '' }
}
const headerMenu = [
  { id: 'authorization', label: 'Authorization' },
  { id: 'apiKey', label: 'X-API-Key' },
  { id: 'custom', label: 'Custom header' }
]

const rows = ref<ApiHeader[]>([])
watch(() => props.connection.headers, (headers) => {
  rows.value = headers.map(h => ({ ...h }))
}, { immediate: true })

function update(patch: Record<string, unknown>) {
  return editor.run('connection_update', { connectionId: props.connection.id, ...patch })
}

/** Saves the rows that have a name (an unnamed one is still being typed). */
function saveHeaders() {
  const headers = rows.value.map(h => ({ name: h.name.trim(), value: h.value })).filter(h => h.name)
  if (JSON.stringify(headers) !== JSON.stringify(props.connection.headers)) void update({ headers })
}

function addHeader(id: string) {
  rows.value = [...rows.value, { ...HEADER_PRESETS[id]! }]
  if (rows.value.at(-1)!.name) saveHeaders()
}

function removeHeader(index: number) {
  rows.value = rows.value.filter((_, i) => i !== index)
  saveHeaders()
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
    <DataPanelHead
      icon="i-lucide-server"
      :title="connection.name"
      detail="Connection"
    />

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
            variables="secrets"
            size="xs"
            variant="soft"
            @commit="update({ baseUrl: $event.trim() })"
          />
        </div>
        <template #below>
          <p class="text-[11px] leading-4 text-dimmed">
            Use <code v-text="'{{ env.NAME }}'" /> for values that change per environment
          </p>
        </template>
      </EditorRow>
    </EditorStyleSection>

    <EditorStyleSection
      label="Headers"
      :menu="headerMenu"
      @add="addHeader"
    >
      <div
        v-for="(header, index) in rows"
        :key="index"
        class="group/header flex items-center gap-1.5"
        :data-header-row="header.name || index"
      >
        <UInput
          v-model="header.name"
          placeholder="Name"
          aria-label="Header name"
          size="xs"
          variant="soft"
          :ui="{ base: SOFT }"
          class="w-[42%] shrink-0"
          :autofocus="!header.name"
          data-header-name
          @change="saveHeaders"
        />
        <UInput
          v-model="header.value"
          placeholder="Value"
          :aria-label="`Value of ${header.name || 'the header'}`"
          size="xs"
          variant="soft"
          :ui="{ base: SOFT }"
          class="min-w-0 flex-1"
          data-header-value
          @change="saveHeaders"
        >
          <template #trailing>
            <EditorVariablePicker
              secrets
              @insert="header.value = $event; saveHeaders()"
            />
          </template>
        </UInput>
        <button
          type="button"
          class="grid size-6 shrink-0 place-items-center rounded-md text-dimmed hover:bg-white/8 hover:text-highlighted"
          :aria-label="`Remove ${header.name || 'header'}`"
          data-header-remove
          @click="removeHeader(index)"
        >
          <UIcon
            name="i-lucide-minus"
            class="size-3.5"
          />
        </button>
      </div>
      <p class="text-[11px] leading-4 text-dimmed">
        Keep keys in a secret variable and use its reference, e.g. <code v-text="'Bearer {{ env.API_KEY }}'" />. Headers only go to the base URL's origin.
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
