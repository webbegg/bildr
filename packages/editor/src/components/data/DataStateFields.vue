<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import type { StateFile } from '@bildr/codegen/model'
import { attempt } from '../../editor/dataArtifactActions.ts'
import { sameJson } from '../../editor/draftJson.ts'
import { changedOutside, changesOf, draftOf, fieldOfRefusal, moveField, newField, rebaseDraft } from '../../editor/stateDraft.ts'
import type { DraftField, StateDraft } from '../../editor/stateDraft.ts'
import { useDraftForm } from '../../editor/useDraftForm.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { confirmRemoveStateField } from '../../editor/usageWarnings.ts'
import { FIELD_TYPE_ICONS, FIELD_TYPE_LABELS, fieldTypeItems } from '../../shared/dataModel.ts'
import type { FieldType } from '../../shared/dataModel.ts'
import { stateFieldUsesByName } from '../../shared/dataUsage.ts'
import DataFieldUses from './DataFieldUses.vue'

/**
 * A state's Fields tab (B2, S1): a table of its fields, one row each: the name, the type, the default (an input that fits the type:
 * a checkbox for a toggle, a number box, a date box…) and whether it is required, with the arrows that reorder, a "−" that removes and
 * `Add field`. Edits are a draft: Save sends the whole list with `state_update` (`editor/stateDraft.ts`, each field with its id so
 * the module matches it), and what the module refuses is shown next to the field it names (a field a page still uses can't be removed,
 * renamed or retyped), or in the footer when it is about the state. Removing a field that is used says so first, listing the places,
 * as removing a collection's field does. A save refreshes the model, so the tree, Used in and the header show the change.
 *
 * The draft, its base and the notice for a state that changed under it are the shared draft form (`useDraftForm`, `DataStaleNotice`,
 * `DataDraftFooter`). A state with several rows (not generated yet) is listed read-only.
 */
const { state } = defineProps<{ state: StateFile }>()
const editor = useEditor()
const root = useTemplateRef<HTMLElement>('root')

const readOnly = computed(() => state.shape !== 'single')
const { draft, base, error, saving, dirty, stale, discard, keepMine } = useDraftForm<StateFile, StateDraft>({
  stored: () => state,
  id: () => state.id,
  label: () => state.label || state.name,
  open: draftOf,
  dirty: (current, saved) => !sameJson(current, draftOf(saved)),
  changedOutside,
  rebase: rebaseDraft
})
const changes = computed(() => changesOf(draft.value, base.value))

/** Whether the error shown is the module's refusal (and so may belong to a field), not a problem the form found in a box. */
const refused = ref(false)
/** The row the module's refusal is about, when it names one. */
const refusedKey = computed(() => refused.value && error.value ? fieldOfRefusal(error.value, draft.value.fields, base.value.fields) : null)
const footerError = computed(() => refusedKey.value ? '' : error.value)

async function save() {
  if (stale.value || !dirty.value) return
  refused.value = false
  if (changes.value.problems.length) {
    error.value = changes.value.problems.join('. ')
    return
  }
  saving.value = true
  const done = await attempt(editor, 'state_update', { state: state.id, fields: changes.value.fields }, 'Could not save the state')
  saving.value = false
  if ('error' in done) {
    refused.value = true
    error.value = done.error
    return
  }
  // The model is refreshed: the form shows the state as it is now, and that is what the next edits start from.
  discard()
}

/** The input type that fits each field type's default. */
const INPUTS: Record<FieldType, string> = { text: 'text', integer: 'number', number: 'number', boolean: 'checkbox', date: 'date', datetime: 'datetime-local', image: 'text', uuid: 'text' }
const label = (field: DraftField) => field.name.trim() || 'new field'
const CHECKBOX = 'size-3.5 cursor-pointer scheme-dark accent-(--ui-primary)'

function setType(field: DraftField, type: FieldType) {
  field.type = type
  // What was typed for another type may not fit this one. A toggle shows its default as a checkbox, which starts unchecked: that is "no", so it is the default.
  field.default = type === 'boolean' ? 'false' : ''
}

function setToggle(field: DraftField, event: Event) {
  field.default = (event.target as HTMLInputElement).checked ? 'true' : 'false'
}

async function add() {
  const field = newField()
  draft.value.fields.push(field)
  await nextTick()
  root.value?.querySelector<HTMLInputElement>(`[data-state-field="${field.key}"] [data-state-name]`)?.focus()
}

function move(index: number, by: -1 | 1) {
  draft.value = moveField(draft.value, index, index + by)
}

/** The name a saved field has now: who uses it is read by it, whatever the draft calls it. */
const savedName = (field: DraftField) => state.fields.find(entry => entry.id === field.id)?.name
const uses = computed(() => stateFieldUsesByName(editor.model, state.id))
const usesOf = (field: DraftField) => uses.value.get(savedName(field) ?? '') ?? []
/** The field whose list of places is open, under its row. */
const usesOpen = ref<string | null>(null)

async function remove(field: DraftField) {
  // A field a page uses can't go (the module refuses it too): the places are listed, and the field stays. One only added here asks nothing.
  const name = savedName(field)
  if (name !== undefined && !await confirmRemoveStateField(editor, state, name)) return
  const at = draft.value.fields.findIndex(entry => entry.key === field.key)
  if (at >= 0) draft.value.fields.splice(at, 1)
}
</script>

<template>
  <div
    ref="root"
    class="flex size-full flex-col overflow-y-auto"
    data-state-fields
  >
    <div class="w-full max-w-3xl flex-1 space-y-3 px-0.5 py-4">
      <DataStaleNotice
        v-if="stale"
        prefix="state-fields"
        title="This state changed since you started editing"
        description="Your edits are still here. Load the new version to drop them, or keep them: only the fields you changed replace the new version when you save."
        @load-new="discard"
        @keep-mine="keepMine"
      />
      <p
        v-if="readOnly"
        class="flex items-start gap-2 rounded-lg bg-white/4 px-3 py-2 text-[12px] leading-4 text-muted"
        data-state-many
      >
        <UIcon
          name="i-lucide-info"
          class="size-4 shrink-0"
        />
        Not generated yet: a state with several rows is listed here, but it can't be edited. Delete it and create it again to give it one row of values.
      </p>
      <div>
        <p
          class="flex h-9 items-center ps-3.5 pe-2 text-[12px] font-[550] text-highlighted"
          data-state-title
        >
          {{ draft.fields.length }} {{ draft.fields.length === 1 ? 'field' : 'fields' }}
        </p>
        <p class="px-3.5 pb-2 text-xs text-dimmed">
          The state starts with each field's default.
        </p>
        <div
          class="grid grid-cols-[minmax(0,1fr)_9.5rem_minmax(0,1fr)_4.5rem_6.5rem] items-center gap-x-2 px-2 pb-1 text-[11px] text-dimmed"
          data-state-header-row
        >
          <span class="ps-1.5">Name</span>
          <span>Type</span>
          <span>Default</span>
          <span class="text-center">Required</span>
          <span />
        </div>
        <div class="px-2">
          <div
            v-for="(field, index) in draft.fields"
            :key="field.key"
            class="rounded-lg py-0.5"
            :data-state-field="field.key"
          >
            <div class="grid grid-cols-[minmax(0,1fr)_9.5rem_minmax(0,1fr)_4.5rem_6.5rem] items-center gap-x-2">
              <template v-if="readOnly">
                <span
                  class="truncate ps-1.5 text-[12px] text-toned"
                  data-state-name
                >{{ field.name }}</span>
                <span class="flex items-center gap-1.5 text-[12px] text-muted">
                  <UIcon
                    :name="FIELD_TYPE_ICONS[field.type]"
                    class="size-4 shrink-0 text-dimmed"
                  />
                  {{ FIELD_TYPE_LABELS[field.type] }}
                </span>
                <span class="truncate text-[12px] text-muted">{{ field.default }}</span>
                <span class="text-center text-[12px] text-muted">{{ field.required ? 'Yes' : '' }}</span>
                <span />
              </template>
              <template v-else>
                <EditorInput
                  v-model="field.name"
                  placeholder="Name, e.g. showDrafts"
                  :aria-label="`Name of ${label(field)}`"
                  :invalid="refusedKey === field.key"
                  data-state-name
                />
                <EditorSelect
                  :model-value="field.type"
                  :items="fieldTypeItems"
                  :icon="FIELD_TYPE_ICONS[field.type]"
                  :aria-label="`Type of ${label(field)}`"
                  :ui="{ content: 'min-w-32' }"
                  data-state-type
                  @update:model-value="setType(field, $event as FieldType)"
                />
                <input
                  v-if="field.type === 'boolean'"
                  type="checkbox"
                  :class="CHECKBOX"
                  :checked="field.default === 'true'"
                  :aria-label="`Default of ${label(field)}`"
                  data-state-default
                  @change="setToggle(field, $event)"
                >
                <EditorInput
                  v-else
                  :model-value="field.type === 'datetime' ? field.default.slice(0, 16) : field.default"
                  :type="INPUTS[field.type]"
                  :step="field.type === 'integer' ? 1 : field.type === 'number' ? 'any' : undefined"
                  placeholder="No default"
                  :aria-label="`Default of ${label(field)}`"
                  data-state-default
                  @update:model-value="field.default = String($event)"
                />
                <span class="grid place-items-center">
                  <input
                    v-model="field.required"
                    type="checkbox"
                    :class="CHECKBOX"
                    :aria-label="`${label(field)} is required`"
                    data-state-required
                  >
                </span>
                <span class="flex items-center justify-end gap-0.5">
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
                    data-state-up
                    @click="move(index, -1)"
                  />
                  <EditorButton
                    icon="i-lucide-arrow-down"
                    variant="ghost"
                    size="xs"
                    :aria-label="`Move ${label(field)} down`"
                    :disabled="index === draft.fields.length - 1"
                    data-state-down
                    @click="move(index, 1)"
                  />
                  <EditorButton
                    icon="i-lucide-minus"
                    variant="ghost"
                    size="xs"
                    :aria-label="`Remove ${label(field)}`"
                    data-state-remove
                    @click="remove(field)"
                  />
                </span>
              </template>
            </div>
            <DataFieldUses
              v-if="field.id"
              part="list"
              :name="savedName(field) ?? field.name"
              :uses="usesOf(field)"
              :open="usesOpen === field.key"
            />
            <p
              v-if="refusedKey === field.key"
              class="mt-1 rounded-lg bg-error/10 px-3 py-2 text-[12px] leading-4 text-error"
              role="alert"
              data-state-field-error
            >
              {{ error }}
            </p>
          </div>
          <button
            v-if="!readOnly"
            type="button"
            class="flex h-9 w-full items-center gap-1.5 rounded-lg ps-1.5 text-left text-[12px] text-muted hover:bg-white/4 hover:text-toned"
            aria-label="Add field"
            data-state-add
            @click="add"
          >
            <UIcon
              name="i-lucide-plus"
              class="size-4 shrink-0"
            />
            Add field
          </button>
        </div>
      </div>
    </div>

    <DataDraftFooter
      v-if="!readOnly"
      prefix="state-fields"
      :error="footerError"
      :dirty="dirty"
      :saving="saving"
      :disabled="!dirty || stale"
      @discard="discard"
      @save="save"
    />
  </div>
</template>
