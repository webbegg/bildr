<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import type { ApiSource } from '@bildr/codegen/edit'
import type { ApiModel } from '@bildr/codegen/model'
import SimpleApiPaneBar from './SimpleApiPaneBar.vue'
import DataStaleNotice from '../data/DataStaleNotice.vue'
import { attempt } from '../../editor/dataArtifactActions.ts'
import { modelChangedOutside, modelDirty, modelDraftOf, modelOutput, modelProblems, moveField, newField, setFieldType, takesRange } from '../../editor/simpleApiDraft.ts'
import type { FieldDraft, ModelDraft } from '../../editor/simpleApiDraft.ts'
import { useDraftForm } from '../../editor/useDraftForm.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { CURRENCIES, FIELD_TYPES } from '../../shared/simpleApi.ts'
import { plainWords } from '../../shared/simpleData.ts'

/**
 * The editor of a model of an API (simple data, S6): the shape of what the API answers or takes, as a table of fields (name, type, whether
 * it is a list, whether it may be missing, whether it may be empty, and the key the API calls it) that can be added to, removed from and
 * reordered, in one draft with one Save (`api_model_set`) and one Discard. A field may hold another model (not this one: the module
 * refuses a model that holds itself). Save and Discard are in the header (`SimpleApiPaneBar`); what the module refuses shows under it, in the section's words, and the edits stay. A model
 * that is new is only a name until it is saved; a rename (`name` changes) keeps the form and its edits.
 */
const { source, name } = defineProps<{ source: ApiSource, name: string }>()
const emit = defineEmits<{ back: [], rename: [] }>()
const editor = useEditor()
const root = useTemplateRef<HTMLElement>('root')

const stored = (): ApiModel | null => source.models.find(entry => entry.name === name) ?? null
const { draft, error, saving, dirty, stale, discard, keepMine } = useDraftForm<ApiModel | null, ModelDraft>({
  stored,
  id: () => 'model',
  label: () => name,
  open: modelDraftOf,
  dirty: modelDirty,
  changedOutside: modelChangedOutside,
  rebase: draft => draft
})

/** The models a field may hold: every one but this. */
const others = computed(() => source.models.filter(model => model.name !== name).map(model => ({ value: model.name, label: model.name })))
const label = (field: { name: string }) => field.name.trim() || 'new field'

/** The fields whose limits line is open; a field with a min or max always shows it. */
const limitsOpen = ref(new Set<string>())
const showsLimits = (field: FieldDraft) => takesRange(field.type) && (limitsOpen.value.has(field.key) || field.min.trim() !== '' || field.max.trim() !== '')
function toggleLimits(field: FieldDraft) {
  const open = new Set(limitsOpen.value)
  if (open.has(field.key)) open.delete(field.key)
  else open.add(field.key)
  limitsOpen.value = open
  if (open.has(field.key)) void nextTick(() => root.value?.querySelector<HTMLInputElement>(`[data-model-field="${field.key}"] [data-model-field-min]`)?.focus())
}

async function save() {
  if (stale.value || !dirty.value || saving.value) return
  const problems = modelProblems(draft.value)
  if (problems.length) {
    error.value = problems.join('. ')
    return
  }
  saving.value = true
  const done = await attempt(editor, 'api_model_set', { datasource: source.id, model: modelOutput(name, draft.value) }, 'Could not save the model')
  saving.value = false
  if ('error' in done) {
    error.value = plainWords(done.error)
    return
  }
  discard()
}

async function add() {
  const field = newField()
  draft.value.fields.push(field)
  await nextTick()
  root.value?.querySelector<HTMLInputElement>(`[data-model-field="${field.key}"] [data-model-field-name], [data-model-field="${field.key}"][data-model-field-name]`)?.focus()
}
const move = (index: number, by: -1 | 1) => {
  draft.value.fields = moveField(draft.value, index, index + by)
}
/** The currencies offered to a money field: the common ones, and the one it has when it is another. */
const currencies = (field: FieldDraft) => field.currency && !CURRENCIES.includes(field.currency) ? [field.currency, ...CURRENCIES] : CURRENCIES
const remove = (key: string) => {
  draft.value.fields = draft.value.fields.filter(field => field.key !== key)
}

const CHECKBOX = 'size-3.5 cursor-pointer scheme-dark accent-(--ui-primary)'
const COLUMNS = 'grid-cols-[minmax(0,1fr)_9.5rem_3rem_3.5rem_4rem_minmax(0,1fr)_7rem]'
</script>

<template>
  <div
    ref="root"
    class="flex min-h-0 flex-1 flex-col"
    :data-api-editor="`model:${name}`"
  >
    <SimpleApiPaneBar
      prefix="simple-model"
      :error="error"
      :dirty="dirty"
      :saving="saving"
      :disabled="!dirty || stale"
      @discard="discard"
      @save="save"
    >
      <EditorButton
        variant="ghost"
        icon="i-lucide-arrow-left"
        :label="source.name"
        :aria-label="`Back to ${source.name}`"
        data-api-back
        @click="emit('back')"
      />
      <span class="text-dimmed">/</span>
      <h3
        class="truncate text-[13px] font-[550] text-highlighted"
        data-api-editor-title
      >
        {{ name }}
      </h3>
      <span class="shrink-0 text-[11px] text-dimmed">Model</span>
      <template #actions>
        <EditorButton
          v-if="stored()"
          variant="ghost"
          icon="i-lucide-pencil"
          label="Rename"
          class="shrink-0"
          data-api-editor-rename
          @click="emit('rename')"
        />
      </template>
    </SimpleApiPaneBar>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="w-full max-w-3xl space-y-6 px-8 py-6">
        <DataStaleNotice
          v-if="stale"
          prefix="simple-model"
          title="This model changed since you started editing"
          description="Your edits are still here. Load the new version to drop them, or keep them: your version replaces the new one when you save."
          @load-new="discard"
          @keep-mine="keepMine"
        />

        <p class="text-[12px] leading-4 text-muted">
          A model is the shape of what the API answers or takes. Each field is one value, or a list of them, with the type it has.
        </p>

        <section>
          <h3
            class="flex h-9 items-center text-[12px] font-[550] text-highlighted"
            data-model-fields-title
          >
            {{ draft.fields.length }} {{ draft.fields.length === 1 ? 'field' : 'fields' }}
          </h3>
          <div
            class="grid items-center gap-x-2 px-1 pb-1 text-[11px] text-dimmed"
            :class="COLUMNS"
          >
            <span class="ps-1.5">Name</span>
            <span>Type</span>
            <span>List</span>
            <span>Optional</span>
            <span>Can be empty</span>
            <span>Called in the API</span>
            <span />
          </div>
          <div
            v-for="(field, index) in draft.fields"
            :key="field.key"
            class="rounded-lg px-1 py-0.5"
            :data-model-field="field.key"
          >
            <div
              class="grid items-center gap-x-2"
              :class="COLUMNS"
            >
              <EditorInput
                v-model="field.name"
                placeholder="Name, e.g. Title"
                :aria-label="`Name of ${label(field)}`"
                data-model-field-name
              />
              <EditorSelect
                :model-value="field.type"
                :items="FIELD_TYPES"
                :aria-label="`Type of ${label(field)}`"
                data-model-field-type
                @update:model-value="setFieldType(field, $event as FieldDraft['type'])"
              />
              <input
                type="checkbox"
                :class="CHECKBOX"
                :checked="field.list"
                :aria-label="`${label(field)} is a list`"
                data-model-field-list
                @change="field.list = ($event.target as HTMLInputElement).checked"
              >
              <input
                type="checkbox"
                :class="CHECKBOX"
                :checked="field.optional"
                :aria-label="`${label(field)} may be missing`"
                data-model-field-optional
                @change="field.optional = ($event.target as HTMLInputElement).checked"
              >
              <input
                type="checkbox"
                :class="CHECKBOX"
                :checked="field.nullable"
                :aria-label="`${label(field)} may be empty`"
                data-model-field-nullable
                @change="field.nullable = ($event.target as HTMLInputElement).checked"
              >
              <EditorInput
                v-model="field.remote"
                placeholder="Same name"
                :aria-label="`The name the API gives ${label(field)}`"
                data-model-field-remote
              />
              <span class="flex w-[7rem] items-center justify-end gap-0.5">
                <EditorButton
                  v-if="takesRange(field.type)"
                  icon="i-lucide-ruler"
                  variant="ghost"
                  size="xs"
                  :aria-label="`Limits of ${label(field)}`"
                  :aria-pressed="showsLimits(field)"
                  :class="showsLimits(field) ? 'text-highlighted' : ''"
                  data-model-field-limits
                  @click="toggleLimits(field)"
                />
                <EditorButton
                  icon="i-lucide-arrow-up"
                  variant="ghost"
                  size="xs"
                  :aria-label="`Move ${label(field)} up`"
                  :disabled="index === 0"
                  data-model-field-up
                  @click="move(index, -1)"
                />
                <EditorButton
                  icon="i-lucide-arrow-down"
                  variant="ghost"
                  size="xs"
                  :aria-label="`Move ${label(field)} down`"
                  :disabled="index === draft.fields.length - 1"
                  data-model-field-down
                  @click="move(index, 1)"
                />
                <EditorButton
                  icon="i-lucide-minus"
                  variant="ghost"
                  size="xs"
                  :aria-label="`Remove ${label(field)}`"
                  data-model-field-remove
                  @click="remove(field.key)"
                />
              </span>
            </div>
            <div
              v-if="showsLimits(field)"
              class="mt-1 flex items-center gap-2 ps-1.5"
              data-model-field-range
            >
              <span class="shrink-0 text-[11px] text-dimmed">{{ field.type === 'text' ? 'Length' : 'Value' }}</span>
              <EditorInput
                v-model="field.min"
                placeholder="Min"
                inputmode="decimal"
                :aria-label="`${field.type === 'text' ? 'Shortest length' : 'Lowest value'} of ${label(field)}`"
                class="w-20"
                data-model-field-min
              />
              <span class="text-[11px] text-dimmed">to</span>
              <EditorInput
                v-model="field.max"
                placeholder="Max"
                inputmode="decimal"
                :aria-label="`${field.type === 'text' ? 'Longest length' : 'Highest value'} of ${label(field)}`"
                class="w-20"
                data-model-field-max
              />
              <span class="min-w-0 truncate text-[11px] text-dimmed">Checked on what the app sends</span>
            </div>
            <div
              v-if="field.type === 'model'"
              class="mt-1 ps-1.5"
            >
              <EditorSelect
                :model-value="field.model || undefined"
                :items="others"
                :placeholder="others.length ? 'Choose a model' : 'No other models yet'"
                :disabled="!others.length"
                :aria-label="`Model of ${label(field)}`"
                class="max-w-56"
                data-model-field-model
                @update:model-value="field.model = $event"
              />
            </div>
            <div
              v-else-if="field.type === 'select'"
              class="mt-1 flex items-center gap-2 ps-1.5"
            >
              <span class="shrink-0 text-[11px] text-dimmed">Options</span>
              <EditorInput
                v-model="field.options"
                placeholder="Separated by commas, e.g. draft, live, &quot;on hold, waiting&quot;"
                :aria-label="`Options of ${label(field)}`"
                class="max-w-md"
                data-model-field-options
              />
            </div>
            <div
              v-else-if="field.type === 'money'"
              class="mt-1 flex items-center gap-2 ps-1.5"
            >
              <span class="shrink-0 text-[11px] text-dimmed">Currency</span>
              <EditorSelect
                :model-value="field.currency"
                :items="currencies(field)"
                :aria-label="`Currency of ${label(field)}`"
                class="max-w-28"
                data-model-field-currency
                @update:model-value="field.currency = $event"
              />
            </div>
          </div>
          <button
            type="button"
            class="mt-1 flex h-9 w-full items-center gap-1.5 rounded-lg ps-2 text-left text-[12px] text-muted hover:bg-white/4 hover:text-toned"
            aria-label="Add field"
            data-model-field-add
            @click="add"
          >
            <UIcon
              name="i-lucide-plus"
              class="size-4 shrink-0"
            />
            Add field
          </button>
        </section>
      </div>
    </div>
  </div>
</template>
