<script lang="ts">
/** The last "Environment variables" request each editor's Settings answered, so one made before it mounts (⌘K from the Canvas) still scrolls. */
</script>

<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from 'vue'
import { useEditor } from '../../../editor/useEditor.ts'
import type { EnvStatusEntry } from '../../../editor/useEditor.ts'

const answeredRequests = new WeakMap<object, number>()

/**
 * The Settings view's Variables section: the environment variables the
 * project's data sources read (`env_status`), one row each with its name,
 * the data source setting it fills, whether it is set (in the process
 * environment or the project's `.env`) and a Secret tag. The module never
 * returns or writes values: they live in `.env`, which the user edits, so the
 * hosted rows' value fields, Secret switch, Replace and "Add variable" are
 * gone. Reload reads them again.
 */
const editor = useEditor()

const HELP = 'The data sources read these at runtime: set them in the project\'s .env file or the environment of the dev server. Their values are never shown here, and secret ones never leave the server.'

const section = useTemplateRef<HTMLElement>('section')
watch(() => editor.variablesRequest, async (request) => {
  if (request > (answeredRequests.get(editor) ?? 0)) {
    await nextTick()
    section.value?.scrollIntoView({ block: 'start' })
  }
  answeredRequests.set(editor, request)
}, { immediate: true })

const reloading = ref(false)
async function reload() {
  reloading.value = true
  try {
    await editor.reloadEnv()
  } finally {
    reloading.value = false
  }
}

const status = (entry: EnvStatusEntry) => {
  if (entry.set) return entry.from === 'env' ? 'Set in the environment' : 'Set in .env'
  return entry.hasDefault ? 'Not set · uses the default' : 'Not set'
}
</script>

<template>
  <section
    ref="section"
    class="scroll-mt-6 space-y-2"
    data-env-section
  >
    <div class="flex items-center gap-2">
      <h2 class="min-w-0 flex-1 text-[12px] font-[550] text-highlighted">
        Variables
      </h2>
      <EditorButton
        label="Reload"
        icon="i-lucide-refresh-cw"
        variant="ghost"
        size="xs"
        :loading="reloading"
        data-env-reload
        @click="reload"
      />
    </div>
    <p class="text-[12px] text-muted">
      {{ HELP }}
    </p>

    <div
      v-if="editor.env.length"
      class="divide-y divide-white/6 rounded-lg bg-white/4"
    >
      <div
        v-for="entry in editor.env"
        :key="entry.name"
        class="flex items-center gap-2 py-1.5 ps-3 pe-3"
        :data-env-row="entry.name"
        :data-env-secret="entry.secret || undefined"
        :data-env-set="entry.set || undefined"
      >
        <code
          class="w-48 shrink-0 truncate font-mono text-[12px] text-highlighted"
          :title="entry.name"
        >{{ entry.name }}</code>
        <span
          class="min-w-0 flex-1 truncate text-[12px] text-dimmed"
          data-env-source
        >{{ entry.datasource }} · {{ entry.setting }}</span>
        <span
          v-if="entry.secret"
          class="shrink-0 rounded-sm bg-white/8 px-1 text-[10px] leading-4 font-[550] text-toned"
          data-env-secret-tag
        >Secret</span>
        <span
          class="shrink-0 text-[12px]"
          :class="entry.set ? 'text-success' : entry.hasDefault ? 'text-dimmed' : 'text-warning'"
          data-env-status
        >{{ status(entry) }}</span>
      </div>
    </div>
    <p
      v-else
      class="text-[12px] text-dimmed"
      data-env-empty
    >
      No data source reads an environment variable yet.
    </p>
  </section>
</template>
