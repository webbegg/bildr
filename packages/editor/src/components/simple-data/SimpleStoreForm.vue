<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import type { StateFile } from '@bildr/codegen/model'
import type { RefusedField } from '../../api.ts'
import DataArtifactDelete from '../data/DataArtifactDelete.vue'
import DataArtifactRename from '../data/DataArtifactRename.vue'
import DataDraftFooter from '../data/DataDraftFooter.vue'
import DataFieldSettings from '../data/DataFieldSettings.vue'
import DataFieldUses from '../data/DataFieldUses.vue'
import DataInlineError from '../data/DataInlineError.vue'
import DataStaleNotice from '../data/DataStaleNotice.vue'
import { attempt } from '../../editor/dataArtifactActions.ts'
import { DEFAULT_INPUTS, fieldOfRefusal, moveField, newField, setDefault, setFieldType } from '../../editor/stateDraft.ts'
import type { DraftField } from '../../editor/stateDraft.ts'
import { storeChangedOutside, storeChangesOf, storeDirty, storeDraftOf, storeRebase } from '../../editor/simpleStateDraft.ts'
import type { StoreDraft } from '../../editor/simpleStateDraft.ts'
import { confirmRemoveStateField } from '../../editor/usageWarnings.ts'
import { useDraftForm } from '../../editor/useDraftForm.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { KEEPS_VALUES, PERSISTENCE } from '../../shared/dataArtifacts.ts'
import type { StatePersist } from '../../shared/dataArtifacts.ts'
import { FIELD_TYPE_ICONS, fieldTypeItems } from '../../shared/dataModel.ts'
import type { FieldType } from '../../shared/dataModel.ts'
import { stateFieldUsesByName } from '../../shared/dataUsage.ts'
import { plainWords } from '../../shared/simpleData.ts'
import { stateLabel } from '../../shared/stateModel.ts'

/**
 * A store's form in the simple Data section (simple data, S3): how long it keeps its values and its fields (name, type and the value
 * it starts with) in one draft, with one Save and one Discard. Save is one `state_update` with what changed (`simpleStateDraft.ts`);
 * what the module refuses is shown next to the field it names (`field` of the refusal: a field a page still uses can't be removed,
 * renamed or retyped) or in the footer when it is about the store. The edits are the editor's unsaved edits: moving away from them
 * asks first (`useDraftForm`, as the workspace's forms do), and a store changed under them says so (`DataStaleNotice`). Removing a
 * field a page uses says so and lists the places (`confirmRemoveStateField`). Rename and Delete are the workspace's dialogs
 * (`state_rename`, `state_delete`): Delete is refused while a page, a component or an action uses the store, and lists them.
 * A store with several sets of values (the module does not generate it yet) can only be renamed or deleted.
 *
 * A store changed, renamed or deleted elsewhere while the form has edits does not lose them: a change says so and asks (above), a rename
 * says so and the edits stay on the renamed store (its id is the same), and a deletion (`removed`: the section keeps the form, with the
 * store as it was) says so and has nothing to save them to, so only Discard is left. The words are the section's (`plainWords`).
 */
const { state, removed = false } = defineProps<{ state: StateFile, removed?: boolean }>()
const editor = useEditor()
const root = useTemplateRef<HTMLElement>('root')

const readOnly = computed(() => state.shape !== 'single')
const { draft, base, error, saving, dirty, stale, discard, keepMine } = useDraftForm<StateFile, StoreDraft>({
  stored: () => state,
  id: () => state.id,
  label: () => stateLabel(state),
  open: storeDraftOf,
  dirty: storeDirty,
  changedOutside: storeChangedOutside,
  rebase: storeRebase
})
const changes = computed(() => storeChangesOf(draft.value, base.value))
/** The store was renamed (here or elsewhere) since the draft started: its edits are on the renamed store. */
const renamed = computed(() => dirty.value && !removed && state.name !== base.value.name)

/** The field the module's refusal in `error` is about, when it names one. */
const refusedField = ref<RefusedField | null>(null)
const refusedKey = computed(() => error.value && refusedField.value ? fieldOfRefusal(refusedField.value, draft.value.fields) : null)
const footerError = computed(() => refusedKey.value ? '' : error.value)

async function save() {
  if (removed || stale.value || !dirty.value || saving.value) return
  refusedField.value = null
  if (changes.value.problems.length) {
    error.value = changes.value.problems.join('. ')
    return
  }
  if (!changes.value.input) return
  saving.value = true
  const done = await attempt(editor, 'state_update', { state: state.id, ...changes.value.input }, 'Could not save the store')
  saving.value = false
  if ('error' in done) {
    refusedField.value = done.field ?? null
    error.value = plainWords(done.error)
    return
  }
  // The model is refreshed: the form shows the store as it is now, and that is what the next edits start from.
  discard()
}

const label = (field: DraftField) => field.name.trim() || 'new field'
const CHECKBOX = 'size-3.5 cursor-pointer scheme-dark accent-(--ui-primary)'
const COLUMNS = 'grid-cols-[minmax(0,1fr)_9.5rem_minmax(0,1fr)_auto]'

const setToggle = (field: DraftField, event: Event) => {
  field.default = (event.target as HTMLInputElement).checked ? 'true' : 'false'
}

async function add() {
  const field = newField()
  draft.value.fields.push(field)
  await nextTick()
  root.value?.querySelector<HTMLInputElement>(`[data-simple-field="${field.key}"] [data-simple-field-name]`)?.focus()
}

const move = (index: number, by: -1 | 1) => {
  draft.value = { ...draft.value, fields: moveField(draft.value, index, index + by).fields }
}

/** The name a saved field has now: who uses it is read by it, whatever the draft calls it. */
const savedName = (field: DraftField) => state.fields.find(entry => entry.id === field.id)?.name
const uses = computed(() => stateFieldUsesByName(editor.model, state.id))
const usesOf = (field: DraftField) => uses.value.get(savedName(field) ?? '') ?? []
const usesOpen = ref<string | null>(null)

async function remove(field: DraftField) {
  // A field a page uses can't go (the module refuses it too): the places are listed, and the field stays. One only added here asks nothing.
  const name = savedName(field)
  if (name !== undefined && !await confirmRemoveStateField(editor, state, name)) return
  const at = draft.value.fields.findIndex(entry => entry.key === field.key)
  if (at >= 0) draft.value.fields.splice(at, 1)
}

const renaming = ref<{ kind: 'state', id: string } | null>(null)
const deleting = ref<{ kind: 'state', id: string } | null>(null)
</script>

<template>
  <div
    ref="root"
    class="flex size-full min-w-0 flex-col"
    :data-simple-store-form="state.id"
  >
    <header class="flex h-12 shrink-0 items-center gap-2 border-b border-default ps-6 pe-3">
      <UIcon
        name="i-lucide-toggle-right"
        class="size-4 shrink-0 text-dimmed"
      />
      <h2
        class="truncate text-[13px] font-[550] text-highlighted"
        data-simple-title
      >
        {{ stateLabel(state) }}
      </h2>
      <span class="shrink-0 text-[11px] text-dimmed">Store</span>
      <span class="flex-1" />
      <template v-if="!removed">
        <EditorButton
          variant="ghost"
          icon="i-lucide-pencil"
          label="Rename"
          data-simple-rename
          @click="renaming = { kind: 'state', id: state.id }"
        />
        <EditorButton
          variant="ghost"
          icon="i-lucide-trash-2"
          label="Delete"
          data-simple-delete
          @click="deleting = { kind: 'state', id: state.id }"
        />
      </template>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto w-full max-w-2xl space-y-6 px-6 py-6">
        <UAlert
          v-if="removed"
          color="warning"
          variant="subtle"
          icon="i-lucide-trash-2"
          title="This store was deleted"
          description="Your edits are still here, but there is no store left to save them to. Discard them to close this form."
          data-simple-state-removed
        />
        <UAlert
          v-else-if="renamed"
          color="warning"
          variant="subtle"
          icon="i-lucide-pencil"
          title="This store was renamed"
          description="Your edits are still here: they are saved to the renamed store."
          data-simple-state-renamed
        />
        <DataStaleNotice
          v-if="stale"
          prefix="simple-state"
          title="This store changed since you started editing"
          description="Your edits are still here. Load the new version to drop them, or keep them: only what you changed replaces the new version when you save."
          @load-new="discard"
          @keep-mine="keepMine"
        />

        <p
          class="flex items-start gap-2 rounded-lg bg-white/4 px-3 py-2 text-[12px] leading-4 text-muted"
          data-simple-shape
        >
          <UIcon
            name="i-lucide-info"
            class="size-4 shrink-0"
          />
          <span v-if="readOnly">This store holds several sets of values, which can't be edited yet. You can rename or delete it.</span>
          <span v-else>One set of values: each field holds one value at a time, and starts with its default.</span>
        </p>

        <template v-if="!readOnly">
          <EditorFormRow
            :label="KEEPS_VALUES"
            stacked
          >
            <EditorChoiceCards
              :model-value="draft.persist"
              :items="PERSISTENCE"
              :label="KEEPS_VALUES"
              hook="data-simple-persist"
              @update:model-value="draft.persist = $event as StatePersist"
            />
          </EditorFormRow>

          <section>
            <h3
              class="flex h-9 items-center text-[12px] font-[550] text-highlighted"
              data-simple-fields-title
            >
              {{ draft.fields.length }} {{ draft.fields.length === 1 ? 'field' : 'fields' }}
            </h3>
            <div
              class="grid items-center gap-x-2 px-1 pb-1 text-[11px] text-dimmed"
              :class="COLUMNS"
            >
              <span class="ps-1.5">Name</span>
              <span>Type</span>
              <span>Starts as</span>
              <span class="w-[5.5rem]" />
            </div>
            <div
              v-for="(field, index) in draft.fields"
              :key="field.key"
              class="rounded-lg px-1 py-0.5"
              :data-simple-field="field.key"
            >
              <div
                class="grid items-center gap-x-2"
                :class="COLUMNS"
              >
                <EditorInput
                  v-model="field.name"
                  placeholder="Name, e.g. Show drafts"
                  :aria-label="`Name of ${label(field)}`"
                  :invalid="refusedKey === field.key"
                  data-simple-field-name
                />
                <EditorSelect
                  :model-value="field.type"
                  :items="fieldTypeItems"
                  :icon="FIELD_TYPE_ICONS[field.type]"
                  :aria-label="`Type of ${label(field)}`"
                  :ui="{ content: 'min-w-32' }"
                  data-simple-field-type
                  @update:model-value="setFieldType(field, $event as FieldType)"
                />
                <input
                  v-if="field.type === 'boolean'"
                  type="checkbox"
                  :class="CHECKBOX"
                  :checked="field.default === 'true'"
                  :aria-label="`Starting value of ${label(field)}`"
                  data-simple-field-default
                  @change="setToggle(field, $event)"
                >
                <EditorInput
                  v-else
                  :model-value="field.default"
                  :type="DEFAULT_INPUTS[field.type]"
                  :step="field.type === 'integer' ? 1 : field.type === 'number' ? 'any' : undefined"
                  placeholder="Nothing"
                  :aria-label="`Starting value of ${label(field)}`"
                  class="min-w-0"
                  data-simple-field-default
                  @update:model-value="setDefault(field, String($event))"
                />
                <span class="flex w-[5.5rem] items-center justify-end gap-0.5">
                  <DataFieldUses
                    v-if="field.id"
                    part="badge"
                    :name="savedName(field) ?? field.name"
                    :uses="usesOf(field)"
                    :open="usesOpen === field.key"
                    @toggle="usesOpen = usesOpen === field.key ? null : field.key"
                  />
                  <EditorButton
                    icon="i-lucide-arrow-up"
                    variant="ghost"
                    size="xs"
                    :aria-label="`Move ${label(field)} up`"
                    :disabled="index === 0"
                    @click="move(index, -1)"
                  />
                  <EditorButton
                    icon="i-lucide-arrow-down"
                    variant="ghost"
                    size="xs"
                    :aria-label="`Move ${label(field)} down`"
                    :disabled="index === draft.fields.length - 1"
                    @click="move(index, 1)"
                  />
                  <EditorButton
                    icon="i-lucide-minus"
                    variant="ghost"
                    size="xs"
                    :aria-label="`Remove ${label(field)}`"
                    data-simple-field-remove
                    @click="remove(field)"
                  />
                </span>
              </div>
              <DataFieldSettings
                v-model:options="field.options"
                v-model:currency="field.currency"
                :type="field.type"
                :label="label(field)"
                hook="simple-field"
              />
              <DataFieldUses
                v-if="field.id"
                part="list"
                :name="savedName(field) ?? field.name"
                :uses="usesOf(field)"
                :open="usesOpen === field.key"
              />
              <DataInlineError
                v-if="refusedKey === field.key"
                class="mt-1"
                data-simple-field-error
              >
                {{ error }}
              </DataInlineError>
            </div>
            <button
              type="button"
              class="mt-1 flex h-9 w-full items-center gap-1.5 rounded-lg ps-2 text-left text-[12px] text-muted hover:bg-white/4 hover:text-toned"
              aria-label="Add field"
              data-simple-field-add
              @click="add"
            >
              <UIcon
                name="i-lucide-plus"
                class="size-4 shrink-0"
              />
              Add field
            </button>
          </section>
        </template>
      </div>
    </div>

    <DataDraftFooter
      v-if="!readOnly"
      prefix="simple-state"
      inner="mx-auto max-w-2xl px-6"
      :error="footerError"
      :dirty="dirty"
      :saving="saving"
      :disabled="!dirty || stale || removed"
      @discard="discard"
      @save="save"
    />

    <DataArtifactRename
      :target="renaming"
      plain
      @close="renaming = null"
    />
    <DataArtifactDelete
      :target="deleting"
      plain
      @close="deleting = null"
    />
  </div>
</template>
