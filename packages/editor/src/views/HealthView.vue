<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { callAction, errorMessage } from '../api.ts'
import DiffView from '../components/DiffView.vue'
import ProblemsList from '../components/ProblemsList.vue'
import StateBadge from '../components/StateBadge.vue'
import { useStatus } from '../status.ts'
import { CHECK_NAMES } from '../types.ts'
import type { CheckName, CheckResult, DriftReport } from '../types.ts'

/** The Health report (RA §7): model status, drift with diffs, and the project's checks with a Run button each. Health never blocks editing. */

const status = useStatus()
const health = status.health

const LABELS: Record<CheckName, string> = { lint: 'Lint and boundaries', types: 'Types', tests: 'Tests', build: 'Build' }

/** Results from runs started here, until the next `health_get` carries them. */
const fresh = reactive<Partial<Record<CheckName, CheckResult>>>({})
const running = reactive<Partial<Record<CheckName, boolean>>>({})
const runError = ref<string | null>(null)
const openDiffs = ref<Set<string>>(new Set())

const checkOf = (name: CheckName): CheckResult | undefined => {
  const stored = health.value?.checks[name]
  const local = fresh[name]
  if (!local) return stored
  if (!stored) return local
  return stored.startedAt > local.startedAt ? stored : local
}

const drift = computed<DriftReport | null>(() => {
  const value = health.value?.drift
  return value && 'files' in value ? value : null
})
const driftError = computed(() => {
  const value = health.value?.drift
  return value && 'error' in value ? value.error : null
})
const anyRunning = computed(() => CHECK_NAMES.some(name => running[name]))

const run = async (names: CheckName[]) => {
  runError.value = null
  for (const name of names) running[name] = true
  try {
    const { results } = await callAction<{ results: CheckResult[] }>('health_run', { checks: names })
    for (const result of results) fresh[result.name] = result
  } catch (caught) {
    runError.value = errorMessage(caught)
  } finally {
    for (const name of names) running[name] = false
  }
  void status.refreshHealth()
}

const toggleDiff = (path: string) => {
  const next = new Set(openDiffs.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  openDiffs.value = next
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`
const when = (iso: string) => iso ? new Date(iso).toLocaleString() : ''

onMounted(() => {
  if (!health.value) void status.refreshHealth()
})
</script>

<template>
  <div class="space-y-6 p-6">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-xl font-semibold">
        Checks
      </h1>
      <span
        v-if="health?.updatedAt"
        class="text-sm text-muted"
      >Updated {{ when(health.updatedAt) }}</span>
      <UButton
        data-testid="run-all"
        class="ml-auto"
        icon="i-lucide-play"
        label="Run all"
        :loading="anyRunning"
        :disabled="anyRunning"
        @click="run([...CHECK_NAMES])"
      />
    </div>

    <ProblemsList
      v-if="status.healthError.value"
      title="Could not read the Health report"
      :message="status.healthError.value"
    />
    <ProblemsList
      v-if="runError"
      title="The check did not run"
      :message="runError"
    />

    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Model
        </h2>
      </template>
      <div data-testid="model-status">
        <UBadge
          v-if="!health?.model"
          color="neutral"
          variant="subtle"
          label="unknown"
        />
        <UBadge
          v-else-if="health.model.ok"
          color="success"
          variant="subtle"
          icon="i-lucide-check"
          label="valid"
        />
        <ProblemsList
          v-else
          title="invalid: the code is not regenerated until it loads"
          :problems="health.model.problems"
        />
      </div>
    </UCard>

    <UCard data-testid="drift">
      <template #header>
        <h2 class="font-semibold">
          Drift
        </h2>
      </template>
      <p
        v-if="driftError"
        class="text-sm text-error"
      >
        {{ driftError }}
      </p>
      <p
        v-else-if="drift?.missingManifest"
        class="text-sm text-muted"
      >
        No manifest yet: bildr has not synced this project.
      </p>
      <p
        v-else-if="!drift?.files.length"
        class="text-sm text-muted"
      >
        Every generated file matches the model.
      </p>
      <ul
        v-else
        class="divide-y divide-default"
      >
        <li
          v-for="file in drift.files"
          :key="file.path"
          class="space-y-2 py-2"
        >
          <div class="flex items-center gap-2">
            <StateBadge :state="file.state" />
            <code class="text-sm">{{ file.path }}</code>
            <UButton
              v-if="file.diff"
              class="ml-auto"
              size="xs"
              color="neutral"
              variant="ghost"
              :icon="openDiffs.has(file.path) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              :label="openDiffs.has(file.path) ? 'Hide diff' : 'Show diff'"
              @click="toggleDiff(file.path)"
            />
          </div>
          <DiffView
            v-if="file.diff"
            v-show="openDiffs.has(file.path)"
            :diff="file.diff"
          />
        </li>
      </ul>
    </UCard>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <UCard
        v-for="name in CHECK_NAMES"
        :key="name"
        :data-testid="`check-${name}`"
      >
        <template #header>
          <div class="flex items-center gap-2">
            <h2 class="font-semibold">
              {{ LABELS[name] }}
            </h2>
            <span data-testid="ok">
              <UBadge
                v-if="checkOf(name)"
                :color="checkOf(name)!.ok ? 'success' : 'error'"
                variant="subtle"
                :label="checkOf(name)!.ok ? 'passing' : 'failing'"
              />
            </span>
            <UButton
              data-testid="run"
              class="ml-auto"
              size="sm"
              color="neutral"
              variant="outline"
              icon="i-lucide-play"
              label="Run"
              :loading="running[name]"
              :disabled="running[name]"
              @click="run([name])"
            />
          </div>
        </template>
        <template v-if="checkOf(name)">
          <p class="text-sm">
            {{ checkOf(name)!.summary }}
          </p>
          <p class="text-xs text-muted">
            {{ seconds(checkOf(name)!.durationMs) }} · {{ when(checkOf(name)!.startedAt) }}
          </p>
          <ul
            v-if="checkOf(name)!.findings.length"
            class="mt-3 space-y-1"
          >
            <li
              v-for="(finding, index) in checkOf(name)!.findings"
              :key="index"
              :data-boundary="finding.boundary === true ? 'true' : 'false'"
              :class="finding.boundary ? 'border-l-2 border-error bg-error/10 pl-2' : 'pl-2.5'"
              class="py-0.5 text-sm"
            >
              <UBadge
                v-if="finding.boundary"
                color="error"
                size="sm"
                label="boundary"
                class="mr-1"
              />
              <code
                v-if="finding.file"
                class="text-xs"
              >{{ finding.file }}{{ finding.line ? `:${finding.line}` : '' }}</code>
              {{ finding.message }}
              <span
                v-if="finding.rule"
                class="text-xs text-muted"
              >({{ finding.rule }})</span>
            </li>
          </ul>
          <details
            v-if="checkOf(name)!.output"
            class="mt-3"
          >
            <summary class="cursor-pointer text-xs text-muted">
              Output
            </summary>
            <pre class="mt-1 max-h-64 overflow-auto rounded-md bg-elevated/50 p-2 font-mono text-xs">{{ checkOf(name)!.output }}</pre>
          </details>
        </template>
        <p
          v-else
          class="text-sm text-muted"
        >
          Not run yet
        </p>
      </UCard>
    </div>
  </div>
</template>
