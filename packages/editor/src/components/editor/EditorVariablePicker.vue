<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'
import type { ScopeName } from '@bildr/codegen/edit'
import type { Value } from '@bildr/codegen/model'
import ApiArgInput from '../../design/ApiArgInput.vue'
import { ACTION } from '../../editorUi.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { insertAt, pathToken } from '../../shared/bindings.ts'
import { pickerSources } from '../../shared/dataPicker.ts'
import type { PickerField, PickerSource } from '../../shared/dataPicker.ts'
import { pageDataOffers } from '../../shared/pageDataOffers.ts'

/**
 * The braces button inside a text field: a popover over the data the selected node can read, in two levels so many APIs, stores and
 * nested models stay readable (`pickerSources`). First the sources: what the node reads (a record's fields inside a List, a
 * component's properties, `layout.x`, `site`, what the page uses) and, on a page, its module's stores and the API queries it doesn't
 * use yet (`pageDataOffers`); then the fields of the one picked, a nested model or a list as a level of its own. Typing searches every
 * field at once. Picking a field types `{path}` over the field's selection and emits `insert` with the new text (the parent commits
 * it, as a `{ $bind }` or `{ $template }`, see `textValue`), then puts focus and the caret back after the token; for a store or an
 * API query the page doesn't use yet, the page's use is added first (`page_use_add`), and a refused use inserts nothing. A query
 * whose required parameters the page's route doesn't give asks for them first (ApiArgInput, as the page's Data this page uses does).
 * The field is the nearest input or textarea around the button. `names` lists other names instead, and no offers (a step's text in
 * the Interactions popover reads only what the generated handler resolves).
 */
const props = defineProps<{ names?: ScopeName[] }>()
const emit = defineEmits<{ insert: [text: string] }>()
const editor = useEditor()

const anchor = useTemplateRef<HTMLElement>('anchor')
const open = ref(false)
const searchTerm = ref('')
let caret: number | null = null

function field(): HTMLInputElement | HTMLTextAreaElement | null {
  let el = anchor.value?.parentElement
  while (el && !el.querySelector('input, textarea')) el = el.parentElement
  return el?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea') ?? null
}

const selectionOf = (el: HTMLInputElement | HTMLTextAreaElement) => ({ value: el.value, start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length })

/** Inserts `path` where the field's selection was when the popover opened, adding the page's use of an offered source first. */
async function choose(source: PickerSource, path: string) {
  const el = field()
  if (!el) return
  const at = selectionOf(el)
  open.value = false
  const page = editor.page?.id
  const use = source.offer && source.offer.missing.length && 'api' in source.offer.use
    ? { ...source.offer.use, args: { ...source.offer.use.args, ...given.value } }
    : source.offer?.use
  if (use && (!page || !await editor.run('page_use_add', { page, ...use }))) return
  const result = insertAt(at.value, at.start, at.end, pathToken(path))
  emit('insert', result.text)
  caret = result.caret
  // The popover has closed already when an added use comes back: the caret is put back here, not on its close.
  if (source.offer) await putCaret()
}

async function putCaret() {
  if (caret === null) return
  const at = caret
  caret = null
  await nextTick()
  const el = field()
  el?.focus()
  el?.setSelectionRange(at, at)
}

function restoreFocus(event: Event) {
  if (caret === null) return
  event.preventDefault()
  void putCaret()
}

const scope = computed(() => props.names ?? (editor.selectedId ? editor.scopeOf(editor.selectedId) : []))
/** The stores and API queries the page could read: only for a node's own text (no `names`) on a page. */
const offers = computed(() => (props.names || !editor.selectedId || editor.component || editor.layout || !editor.page ? [] : pageDataOffers(editor.model, editor.page.id)))
const sources = computed(() => pickerSources(scope.value, offers.value))

/**
 * A query that needs parameters the route doesn't give asks for them first (`asking`, the values in `given`), then lists its fields
 * (`chosen`); the use is added with them when a field is picked. Each opening starts again from the sources.
 */
const asking = ref<PickerSource | null>(null)
const chosen = ref<PickerSource | null>(null)
const given = ref<Record<string, Value>>({})
watch(open, (now) => {
  if (!now) return
  asking.value = null
  chosen.value = null
  given.value = {}
  searchTerm.value = ''
})
const ask = (source: PickerSource) => {
  given.value = {}
  asking.value = source
}
const setGiven = (name: string, value: Value | null) => {
  const next = { ...given.value }
  if (value === null) Reflect.deleteProperty(next, name)
  else next[name] = value
  given.value = next
}
const ready = computed(() => !!asking.value?.offer?.missing.every(param => given.value[param.name] !== undefined))
function toFields() {
  chosen.value = asking.value
  asking.value = null
}
function back() {
  asking.value = null
  chosen.value = null
  given.value = {}
}

const ICONS: Record<PickerSource['group'], string> = { page: 'i-lucide-file-text', store: 'i-lucide-box', api: 'i-lucide-globe' }
const GROUP_LABELS: Record<PickerSource['group'], string> = { page: 'This page reads', store: 'Stores', api: 'APIs' }

const fieldItem = (source: PickerSource, entry: PickerField): CommandPaletteItem => (entry.children
  ? { label: entry.label, icon: 'i-lucide-folder', placeholder: `${entry.label}…`, children: entry.children.map(child => fieldItem(source, child)) }
  : { label: entry.label, suffix: entry.path, icon: 'i-lucide-database', onSelect: () => void choose(source, entry.path!) })

function sourceItem(source: PickerSource): CommandPaletteItem {
  const base = { label: source.label, icon: ICONS[source.group] }
  if (source.missing.length) return { ...base, suffix: `Needs ${source.missing.join(', ')}`, onSelect: () => ask(source) }
  const lone = source.fields.length === 1 && source.fields[0]!.path === source.alias ? source.fields[0]! : undefined
  if (lone) return { ...base, suffix: source.description, onSelect: () => void choose(source, lone.path!) }
  return { ...base, suffix: source.description, placeholder: `Fields of ${source.label}…`, children: source.fields.map(entry => fieldItem(source, entry)) }
}

const groups = computed<CommandPaletteGroup[]>(() => {
  if (chosen.value) return [{ id: 'fields', label: chosen.value.label, items: chosen.value.fields.map(entry => fieldItem(chosen.value!, entry)) }]
  const byGroup = (['page', 'store', 'api'] as const)
    .map(group => ({ id: group, label: GROUP_LABELS[group], items: sources.value.filter(source => source.group === group).map(sourceItem) }))
    .filter(group => group.items.length)
  if (!searchTerm.value.trim()) return byGroup
  // Searching: every field a text can insert, by its path, before the sources whose name matches.
  const leaves = sources.value.filter(source => !source.missing.length).flatMap(source => source.leaves.map((path): CommandPaletteItem => ({
    label: path, suffix: source.group === 'page' ? source.description : source.label, icon: 'i-lucide-database', onSelect: () => void choose(source, path)
  })))
  return [{ id: 'fields', label: 'Fields', items: leaves }, ...byGroup]
})

const PALETTE_UI = {
  root: 'divide-white/8',
  input: '[&>input]:h-9 [&>input]:text-[12px]',
  viewport: 'divide-white/8',
  group: 'p-1',
  label: 'px-2.5 pt-2 pb-1 text-[11px] font-medium text-dimmed',
  item: 'gap-2 px-2.5 py-1.5 text-[12px] before:rounded-lg data-highlighted:not-data-disabled:before:bg-white/8',
  itemLeadingIcon: 'size-3.5',
  itemLabel: 'font-mono',
  itemLabelSuffix: 'truncate text-[11px] text-dimmed font-sans',
  empty: 'py-6 text-[12px] text-dimmed'
}
</script>

<template>
  <span
    ref="anchor"
    class="contents"
  >
    <UPopover
      v-model:open="open"
      :content="{ align: 'end', sideOffset: 6, onCloseAutoFocus: restoreFocus }"
    >
      <button
        type="button"
        :class="ACTION"
        aria-label="Insert variable"
        data-variable-picker
      >
        <UIcon
          name="i-lucide-braces"
          class="size-3.5"
        />
      </button>
      <template #content>
        <form
          v-if="asking"
          class="flex w-72 flex-col gap-2 p-3 text-[12px]"
          data-picker-params
          @submit.prevent="ready && toFields()"
        >
          <p class="text-dimmed">
            <span class="text-default">{{ asking.label }}</span> needs a value for what it reads. The page keeps it.
          </p>
          <label
            v-for="param in asking.offer?.missing ?? []"
            :key="param.name"
            class="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-2 text-dimmed"
          >
            <span class="truncate pt-1 font-mono">{{ param.name }}</span>
            <ApiArgInput
              :param="param"
              :value="given[param.name]"
              :required="true"
              :test-id="`picker-arg-${param.name}`"
              @commit="setGiven(param.name, $event)"
            />
          </label>
          <div class="flex justify-between gap-1">
            <EditorButton
              variant="ghost"
              icon="i-lucide-arrow-left"
              label="Back"
              data-testid="picker-params-back"
              @click="back"
            />
            <EditorButton
              type="submit"
              variant="primary"
              label="Choose a field"
              :disabled="!ready"
              data-testid="picker-params-next"
            />
          </div>
        </form>
        <div
          v-else
          class="flex flex-col"
        >
          <button
            v-if="chosen"
            type="button"
            class="flex items-center gap-1 px-3 pt-2 text-[11px] text-dimmed hover:text-default"
            data-testid="picker-fields-back"
            @click="back"
          >
            <UIcon
              name="i-lucide-arrow-left"
              class="size-3"
            />
            All data
          </button>
          <UCommandPalette
            v-model:search-term="searchTerm"
            :groups="groups"
            :fuse="{ resultLimit: 50 }"
            preserve-group-order
            size="sm"
            :ui="PALETTE_UI"
            placeholder="Search data…"
            class="h-[min(22rem,60vh)] w-72"
            data-data-picker
          >
            <template #empty>
              Nothing to insert here
            </template>
          </UCommandPalette>
        </div>
      </template>
    </UPopover>
  </span>
</template>
