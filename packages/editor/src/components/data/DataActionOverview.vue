<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { ActionFile } from '@bildr/codegen/model'
import { attempt } from '../../editor/dataArtifactActions.ts'
import { useDirtyReport } from '../../editor/useDirtyReport.ts'
import { useEditor } from '../../editor/useEditor.ts'

/**
 * An action's Overview tab (S10): a form over `action_update` (the label, the description, and the fields of the body the
 * action takes, when it has one) and, read-only, its code name (renamed from the dialog the button opens), its HTTP method and
 * path, what it returns and how many steps it has, with a link to the Steps tab, where they are listed and edited.
 * What the module refuses is shown under the form, with what was typed kept. Every edit is one `action_update`, saved when the
 * field is left; a field whose save was refused still holds its text, so the editor asks before the workspace moves away from it
 * (reported to the editor's registry, as for the JSON editor). A field toggle is not taken while another save is in flight: it would be built from
 * the list before that save.
 */
const { action } = defineProps<{ action: ActionFile }>()
const editor = useEditor()

const collection = computed(() => editor.collections.find(entry => entry.id === action.input.entity) ?? null)
const output = computed(() => editor.collections.find(entry => entry.id === action.output?.entity) ?? null)
/** The fields of the body an action over a collection may take: its key, then its own. */
const candidates = computed(() => collection.value ? ['id', ...collection.value.fields.map(field => field.name).filter(name => name !== 'id')] : [])
const picked = computed(() => new Set(action.input.pick ?? []))
const params = computed(() => action.input.params ?? [])
const stepCount = computed(() => `${action.steps.length} ${action.steps.length === 1 ? 'step' : 'steps'}`)

type TextField = 'label' | 'description'
const error = ref('')
const saving = ref(false)
const renaming = ref(false)
/** The text fields whose last save was refused: they still hold what was typed. */
const refused = reactive(new Set<TextField>())
watch(() => action.id, () => {
  error.value = ''
  refused.clear()
  renaming.value = false
})

const name = computed(() => action.label || action.name)
useDirtyReport(() => refused.size ? name.value : null)

async function update(patch: Record<string, unknown>, field?: TextField) {
  error.value = ''
  saving.value = true
  const done = await attempt(editor, 'action_update', { action: action.id, ...patch }, 'Could not save the action')
  saving.value = false
  if ('error' in done) {
    error.value = done.error
    if (field) refused.add(field)
  } else if (field) {
    refused.delete(field)
  }
}

/**
 * A refused text typed back to what is saved: nothing is left to lose or to save, so the field is not refused any more (its
 * `change` sends nothing, as the text is not a change, so this is the one place that sees it).
 */
function typedBack(field: TextField, event: Event) {
  const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value
  if (!refused.has(field) || value !== (field === 'label' ? action.label : action.description ?? '')) return
  refused.delete(field)
  error.value = ''
}

const toggle = (field: string, on: boolean) => update({
  input: { ...action.input, pick: candidates.value.filter(entry => entry === field ? on : picked.value.has(entry)) }
})
</script>

<template>
  <div
    class="size-full overflow-y-auto"
    data-action-overview
  >
    <div class="w-full max-w-2xl space-y-6 px-0.5 py-4">
      <section class="space-y-3">
        <EditorFormRow
          label="Name"
          help="Names the generated code"
        >
          <code
            class="flex h-[30px] min-w-0 items-center truncate rounded-lg bg-elevated px-2.5 font-mono text-[11px] font-[550] text-toned"
            data-action-name
          >{{ action.name }}</code>
          <EditorButton
            label="Rename…"
            variant="ghost"
            size="xs"
            aria-label="Rename action"
            data-action-rename
            @click="renaming = true"
          />
        </EditorFormRow>
        <EditorFormRow label="Label">
          <EditorInput
            :model-value="action.label"
            commit="change"
            aria-label="Action label"
            data-action-field="label"
            @input="typedBack('label', $event)"
            @commit="update({ label: $event }, 'label')"
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
            placeholder="What the action does, and the rule it keeps"
            aria-label="Action description"
            data-action-field="description"
            @input="typedBack('description', $event)"
            @commit="update({ description: $event === '' ? null : $event }, 'description')"
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
          >{{ output ? `A ${output.name}` : 'No data' }}</span>
        </EditorFormRow>
        <EditorFormRow label="Steps">
          <p
            class="text-[12px] text-toned"
            data-steps-note
          >
            {{ stepCount }} —
            <button
              type="button"
              class="text-muted underline underline-offset-2 hover:text-highlighted"
              data-steps-link
              @click="editor.dataTab = 'steps'"
            >
              Edit the steps
            </button>
          </p>
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
            v-for="field in candidates"
            :key="field"
            :model-value="picked.has(field)"
            :label="field"
            :disabled="saving"
            :data-pick="field"
            @update:model-value="toggle(field, $event)"
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

      <DataInlineError
        v-if="error"
        data-action-error
      >
        {{ error }}
      </DataInlineError>
    </div>

    <DataArtifactRename
      :target="renaming ? { kind: 'action', id: action.id } : null"
      @close="renaming = false"
    />
  </div>
</template>
