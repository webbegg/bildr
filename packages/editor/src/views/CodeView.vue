<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { callAction, errorMessage } from '../api.ts'
import DiffView from '../components/DiffView.vue'
import ProblemsList from '../components/ProblemsList.vue'
import StateBadge from '../components/StateBadge.vue'
import { artifactLabel } from '../model.ts'
import { stateLabel } from '../shared/fileStates.ts'
import type { CodeFile, ModelGetResult } from '../types.ts'

/**
 * The files bildr generates from one model file (`?path=`), read-only, with their state; ones edited by hand show their diff. `&file=` is the generated file a link of the
 * Checks screen (S8) opens: its tab is the one shown when the files are read for that link, and a hint says so when this model file does not generate it.
 * Reading the files again (Reload) keeps the tab the user is on.
 */

const route = useRoute()
const router = useRouter()

const path = computed(() => typeof route.query.path === 'string' && route.query.path ? route.query.path : undefined)
const file = computed(() => typeof route.query.file === 'string' && route.query.file ? route.query.file : undefined)
const model = ref<ModelGetResult | null>(null)
const files = ref<CodeFile[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const choices = computed(() => {
  const all = model.value?.files ?? {}
  return Object.keys(all).filter(file => file.startsWith('.bildr/') && !file.startsWith('.bildr/.')).sort()
    .map(file => ({ label: `${artifactLabel(all[file], file)} — ${file}`, value: file }))
})

/** The tab shown, by its place in `files`. */
const active = ref('0')
/** Shows the tab of the file `wanted`, or the first when this model file does not generate it. */
const showFile = (wanted: string | undefined) => {
  const index = files.value.findIndex(entry => entry.path === wanted)
  active.value = String(Math.max(0, index))
}
/** The link names a file this model file does not generate (any more). */
const unknownFile = computed(() => !!file.value && !loading.value && files.value.length > 0 && !files.value.some(entry => entry.path === file.value))

const tabs = computed(() => files.value.map((file, index) => ({
  label: file.path.split('/').at(-1)!,
  value: String(index),
  badge: file.state === 'managed' ? undefined : { label: stateLabel(file.state), color: file.state === 'detached' ? 'warning' as const : 'neutral' as const, variant: 'subtle' as const },
  file
})))

/** Reads the files; `keepTab` shows the file whose tab the user is on instead of the link's. */
const load = async ({ keepTab = false } = {}) => {
  const shown = files.value[Number(active.value)]?.path
  files.value = []
  error.value = null
  if (!path.value) return
  loading.value = true
  try {
    files.value = (await callAction<{ files: CodeFile[] }>('code_view', { path: path.value })).files
    showFile(keepTab ? shown : file.value)
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

const choose = (next: unknown) => {
  const value = typeof next === 'object' && next !== null && 'value' in next ? (next as { value: unknown }).value : next
  if (typeof value === 'string') void router.replace({ path: '/code', query: { path: value } })
}

onMounted(async () => {
  void callAction<ModelGetResult>('model_get').then((result) => {
    model.value = result
  }).catch(() => {})
  await load()
})
watch(path, () => load())
watch(file, () => showFile(file.value))
</script>

<template>
  <div class="space-y-4 p-6">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-xl font-semibold">
        Code
      </h1>
      <USelectMenu
        :model-value="choices.find(choice => choice.value === path)"
        :items="choices"
        placeholder="Choose a model file"
        class="w-full max-w-xl"
        @update:model-value="choose"
      />
      <UButton
        v-if="path"
        color="neutral"
        variant="ghost"
        icon="i-lucide-refresh-cw"
        label="Reload"
        :loading="loading"
        @click="load({ keepTab: true })"
      />
    </div>

    <p
      v-if="!path"
      data-testid="code-empty"
      class="text-sm text-muted"
    >
      Choose an artifact to see the code bildr generates from it.
    </p>
    <ProblemsList
      v-else-if="error"
      title="Could not read the generated code"
      :message="error"
    />
    <p
      v-else-if="!loading && !files.length"
      class="text-sm text-muted"
    >
      No generated files come from <code>{{ path }}</code>.
    </p>

    <p
      v-if="unknownFile"
      class="text-sm text-warning"
      data-testid="code-file-unknown"
    >
      That file isn't generated from this model any more
    </p>

    <UTabs
      v-if="files.length"
      v-model="active"
      data-testid="code-tabs"
      :items="tabs"
      :unmount-on-hide="false"
      variant="link"
      class="w-full"
    >
      <template #content="{ item }">
        <div
          data-testid="code-file"
          :data-file="item.file.path"
          class="space-y-3"
        >
          <div class="flex items-center gap-2">
            <code class="text-sm">{{ item.file.path }}</code>
            <StateBadge :state="item.file.state" />
          </div>
          <div
            v-if="item.file.diff"
            class="space-y-1"
          >
            <h3 class="text-sm font-medium">
              Your changes against what bildr generates
            </h3>
            <DiffView :diff="item.file.diff" />
          </div>
          <pre
            v-if="item.file.content !== undefined"
            class="max-h-[70vh] overflow-auto rounded-md border border-default bg-elevated/50 p-3 font-mono text-xs leading-5"
          >{{ item.file.content }}</pre>
          <p
            v-else
            class="text-sm text-muted"
          >
            Not on disk.
          </p>
        </div>
      </template>
    </UTabs>
  </div>
</template>
