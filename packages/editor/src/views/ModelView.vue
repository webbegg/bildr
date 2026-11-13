<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { callAction, errorMessage } from '../api.ts'
import ArtifactForm from '../components/ArtifactForm.vue'
import ProblemsList from '../components/ProblemsList.vue'
import RawFileEditor from '../components/RawFileEditor.vue'
import { KINDS, MODULE_KINDS, artifactLabel, classifyPath, isObject, moduleFolders } from '../model.ts'
import type { ArtifactRef, KindKey } from '../model.ts'
import type { Json, JsonObject, ModelGetResult, ModelProblem } from '../types.ts'

/**
 * The `.bildr/` model, grouped by module (plus the top-level data sources),
 * one list per kind and a form for the selected or a new artifact. Lists are
 * built from the files `model_get` returns, so they still show while the
 * model is invalid; then the problems are listed and any file can be edited
 * as JSON.
 */

const loading = ref(true)
const loadError = ref<string | null>(null)
const result = ref<ModelGetResult | null>(null)
/** The selected existing artifact, or the kind (and module) of a new one. */
const selection = ref<{ path: string } | { kind: KindKey, module?: string, nonce: number } | null>(null)
let nonce = 0

const files = computed<Record<string, Json>>(() => result.value?.files ?? {})
const problems = computed<ModelProblem[]>(() => result.value && !result.value.ok ? result.value.problems : [])
const artifacts = computed<ArtifactRef[]>(() => Object.keys(files.value).sort().flatMap(path => classifyPath(path) ?? []))

const modules = computed(() => {
  const folders = new Set(moduleFolders(Object.keys(files.value)))
  if (result.value?.ok) for (const folder of Object.keys(result.value.model.modules)) folders.add(folder)
  return [...folders].sort().map((folder) => {
    const file = files.value[`.bildr/modules/${folder}/module.json`]
    const fromModel = result.value?.ok ? result.value.model.modules[folder]?.module.label : undefined
    const label = isObject(file) && typeof file.label === 'string' ? file.label : typeof fromModel === 'string' ? fromModel : folder
    return { folder, label }
  })
})

const idsOf = (kind: KindKey) => artifacts.value.filter(ref => ref.kind === kind).flatMap((ref) => {
  const file = files.value[ref.path]
  return isObject(file) && typeof file.id === 'string' ? [file.id] : []
})
const entityIds = computed(() => idsOf('entity'))
const datasourceIds = computed(() => idsOf('datasource'))

const listOf = (kind: KindKey, module?: string) => artifacts.value
  .filter(ref => ref.kind === kind && ref.module === module)
  .map(ref => ({ ...ref, label: artifactLabel(files.value[ref.path], ref.path) }))

const form = computed(() => {
  const current = selection.value
  if (!current) return null
  if ('path' in current) {
    const ref = classifyPath(current.path)
    const file = files.value[current.path]
    if (!ref || !isObject(file)) return null
    return { key: `edit:${current.path}`, kind: ref.kind, path: current.path, module: ref.module, initial: file }
  }
  return { key: `new:${current.kind}:${current.module ?? ''}:${current.nonce}`, kind: current.kind, path: undefined, module: current.module, initial: KINDS[current.kind].blank() as JsonObject }
})

const load = async () => {
  try {
    result.value = await callAction<ModelGetResult>('model_get')
    loadError.value = null
  } catch (error) {
    loadError.value = errorMessage(error)
  } finally {
    loading.value = false
  }
}

const select = (path: string) => {
  selection.value = { path }
}
const create = (kind: KindKey, module?: string) => {
  selection.value = { kind, module, nonce: ++nonce }
}
const onSaved = async (path: string) => {
  await load()
  if (classifyPath(path) && files.value[path] !== undefined) selection.value = { path }
}
const onDeleted = async () => {
  selection.value = null
  await load()
}

onMounted(load)

const isSelected = (path: string) => selection.value !== null && 'path' in selection.value && selection.value.path === path
</script>

<template>
  <div class="flex h-full min-h-0">
    <aside class="w-72 shrink-0 space-y-5 overflow-y-auto border-r border-default p-4">
      <section
        data-testid="datasources"
        class="space-y-1"
      >
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-semibold tracking-wide text-muted uppercase">
            {{ KINDS.datasource.label }}
          </h3>
          <UButton
            data-testid="new-datasource"
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-plus"
            aria-label="New data source"
            @click="create('datasource')"
          />
        </div>
        <UButton
          v-for="item in listOf('datasource')"
          :key="item.path"
          :data-path="item.path"
          block
          size="sm"
          :color="isSelected(item.path) ? 'primary' : 'neutral'"
          :variant="isSelected(item.path) ? 'soft' : 'ghost'"
          icon="i-lucide-database"
          :label="item.label"
          class="justify-start"
          @click="select(item.path)"
        />
      </section>

      <section
        v-for="mod in modules"
        :key="mod.folder"
        :data-testid="`module-${mod.folder}`"
        class="space-y-3"
      >
        <h2 class="flex items-center gap-1.5 text-sm font-semibold">
          <UIcon
            name="i-lucide-package"
            class="size-4"
          />
          {{ mod.label }}
        </h2>
        <div
          v-for="kind in MODULE_KINDS"
          :key="kind"
          class="space-y-1 pl-2"
        >
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-semibold tracking-wide text-muted uppercase">
              {{ KINDS[kind].label }}
            </h3>
            <UButton
              :data-testid="`new-${mod.folder}-${kind}`"
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-plus"
              :aria-label="`New ${KINDS[kind].singular} in ${mod.label}`"
              @click="create(kind, mod.folder)"
            />
          </div>
          <UButton
            v-for="item in listOf(kind, mod.folder)"
            :key="item.path"
            :data-path="item.path"
            block
            size="sm"
            :color="isSelected(item.path) ? 'primary' : 'neutral'"
            :variant="isSelected(item.path) ? 'soft' : 'ghost'"
            :label="item.label"
            class="justify-start"
            @click="select(item.path)"
          />
          <p
            v-if="!listOf(kind, mod.folder).length"
            class="pl-2 text-xs text-dimmed"
          >
            None yet
          </p>
        </div>
      </section>
    </aside>

    <main class="min-w-0 flex-1 space-y-6 overflow-y-auto p-6">
      <ProblemsList
        v-if="loadError"
        title="Could not load the model"
        :message="loadError"
      />
      <div
        v-if="problems.length"
        data-testid="model-problems"
      >
        <ProblemsList
          title="The model does not load"
          message="Fix these files; the code is not regenerated until the model is valid."
          :problems="problems"
        />
      </div>

      <ArtifactForm
        v-if="form"
        :key="form.key"
        :kind="form.kind"
        :path="form.path"
        :module="form.module"
        :initial="form.initial"
        :entity-ids="entityIds"
        :datasource-ids="datasourceIds"
        @saved="onSaved"
        @deleted="onDeleted"
      />
      <p
        v-else-if="!loading && !problems.length"
        class="text-sm text-muted"
      >
        Select an artifact, or add one with +.
      </p>

      <RawFileEditor
        v-if="problems.length"
        :files="files"
        @saved="load"
      />
    </main>
  </div>
</template>
