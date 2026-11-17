<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ActionFile } from '@bildr/codegen/model'
import { attempt, stepSummary } from '../../editor/dataArtifacts.ts'
import { useEditor } from '../../editor/useEditor.ts'

/**
 * An action's Overview tab (S10): a form over `action_update` (the label, the description, and the fields of the body the
 * action takes, when it has one) and, read-only, its HTTP method and path, what it returns and its steps as a list (a kind
 * and a sentence each). The steps are edited as JSON for now (the note links to that tab). What the module refuses is shown
 * under the form, with what was typed kept. Every edit is one `action_update`, saved when the field is left.
 */
const { action } = defineProps<{ action: ActionFile }>()
const editor = useEditor()

const collection = computed(() => editor.collections.find(entry => entry.id === action.input.entity) ?? null)
const output = computed(() => editor.collections.find(entry => entry.id === action.output?.entity) ?? null)
/** The fields of the body an action over a collection may take: its key, then its own. */
const candidates = computed(() => collection.value ? ['id', ...collection.value.fields.map(field => field.name).filter(name => name !== 'id')] : [])
const picked = computed(() => new Set(action.input.pick ?? []))
const params = computed(() => action.input.params ?? [])

const error = ref('')
watch(() => action.id, () => {
  error.value = ''
})

async function update(patch: Record<string, unknown>) {
  error.value = ''
  const done = await attempt(editor, 'action_update', { action: action.id, ...patch }, 'Could not save the action')
  if ('error' in done) error.value = done.error
}

const toggle = (name: string, on: boolean) => update({
  input: { ...action.input, pick: candidates.value.filter(field => field === name ? on : picked.value.has(field)) }
})

const steps = computed(() => action.steps.map(step => ({ kind: String(step.kind), summary: stepSummary(step, editor.model) })))
</script>

<template>
  <div
    class="size-full overflow-y-auto"
    data-action-overview
  >
    <div class="w-full max-w-2xl space-y-6 px-0.5 py-4">
      <section class="space-y-3">
        <EditorFormRow label="Label">
          <EditorInput
            :model-value="action.label"
            commit="change"
            aria-label="Action label"
            data-action-field="label"
            @commit="update({ label: $event })"
          />
        </EditorFormRow>
        <EditorFormRow
          label="Description"
          help="The business rule, in words"
        >
          <EditorTextarea
            :model-value="action.description ?? ''"
            commit="change"
            :rows="2"
            aria-label="Action description"
            data-action-field="description"
            @commit="update({ description: $event === '' ? null : $event })"
          />
        </EditorFormRow>
        <EditorFormRow
          label="Route"
          help="Set by the action: change it in the JSON tab"
        >
          <code
            class="flex h-[30px] items-center rounded-lg bg-elevated px-2.5 font-mono text-[11px] font-[550] text-toned"
            data-action-route
          >{{ action.http.method }} {{ action.http.path }}</code>
        </EditorFormRow>
        <EditorFormRow label="Returns">
          <span
            class="flex h-[30px] items-center text-[12px] text-toned"
            data-action-output
          >{{ output ? `A ${output.name}` : 'Nothing' }}</span>
        </EditorFormRow>
      </section>

      <section
        v-if="collection"
        class="space-y-2"
      >
        <h3 class="text-[12px] font-[550] text-highlighted">
          Input fields
        </h3>
        <p class="text-xs text-dimmed">
          The fields of a {{ collection.name }} this action takes.
        </p>
        <div class="flex flex-wrap gap-x-6 gap-y-2">
          <EditorSwitch
            v-for="name in candidates"
            :key="name"
            :model-value="picked.has(name)"
            :label="name"
            :data-pick="name"
            @update:model-value="toggle(name, $event)"
          />
        </div>
      </section>
      <section
        v-else-if="params.length"
        class="space-y-2"
        data-action-params
      >
        <h3 class="text-[12px] font-[550] text-highlighted">
          Input
        </h3>
        <p
          v-for="param in params"
          :key="param.name"
          class="text-[12px] text-toned"
        >
          <code class="font-mono">{{ param.name }}</code> <span class="text-dimmed">{{ param.type }}, from the {{ param.from ?? 'route' }}</span>
        </p>
      </section>

      <section class="space-y-2">
        <h3 class="text-[12px] font-[550] text-highlighted">
          Steps
        </h3>
        <ol class="space-y-1">
          <li
            v-for="(step, index) in steps"
            :key="index"
            class="flex items-start gap-2.5 rounded-lg bg-white/3 px-3 py-2 text-[12px]"
            :data-action-step="step.kind"
          >
            <span class="w-20 shrink-0 font-mono text-[11px] text-dimmed">{{ step.kind }}</span>
            <span class="min-w-0 text-toned">{{ step.summary }}</span>
          </li>
        </ol>
        <p
          class="text-xs text-dimmed"
          data-steps-note
        >
          The steps are listed here.
          <button
            type="button"
            class="text-muted underline underline-offset-2 hover:text-highlighted"
            @click="editor.dataTab = 'json'"
          >
            Edit the steps in the JSON tab.
          </button>
        </p>
      </section>

      <p
        v-if="error"
        class="rounded-lg bg-error/10 px-3 py-2 text-[12px] leading-4 text-error"
        role="alert"
        data-action-error
      >
        {{ error }}
      </p>
    </div>
  </div>
</template>
