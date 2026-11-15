<script setup lang="ts">
import { computed, nextTick, useTemplateRef } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import { bindingPaths } from '@bildr/codegen/edit'
import type { ScopeName } from '@bildr/codegen/edit'
import { ACTION } from '../../editorUi.ts'
import { useEditor } from '../../editor/useEditor.ts'
import { insertAt, pathToken } from '../../shared/bindings.ts'

/**
 * The braces button inside a text field: a menu of the names the selected node can read (a
 * record's fields inside a List, a component's properties, `layout.x`, `site.name`, what the
 * page uses) that types `{name}` over the field's selection and emits `insert` with the new
 * text (the parent commits it, as a `{ $bind }` or `{ $template }`, see `textValue`), then puts
 * focus and the caret back after the token. The field is the nearest input or textarea around the button.
 * The hosted editor listed its `{{ env.NAME }}` variables and the record's `{{ item.x }}` fields
 * here; the model's variables are the names in scope (`design.scopeOf`).
 */
const emit = defineEmits<{ insert: [text: string] }>()
const editor = useEditor()

const anchor = useTemplateRef<HTMLElement>('anchor')
let caret: number | null = null

function field(): HTMLInputElement | HTMLTextAreaElement | null {
  let el = anchor.value?.parentElement
  while (el && !el.querySelector('input, textarea')) el = el.parentElement
  return el?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea') ?? null
}

function insert(path: string) {
  const el = field()
  if (!el) return
  const value = el.value
  const result = insertAt(value, el.selectionStart ?? value.length, el.selectionEnd ?? value.length, pathToken(path))
  caret = result.caret
  emit('insert', result.text)
}

async function restoreFocus(event: Event) {
  if (caret === null) return
  event.preventDefault()
  const at = caret
  caret = null
  await nextTick()
  const el = field()
  el?.focus()
  el?.setSelectionRange(at, at)
}

const NAME_UI = { itemLabel: 'font-mono text-[12px]' }
const SOURCE_LABELS: Record<ScopeName['source'], string> = {
  item: 'Item of a List', query: 'Query', state: 'State', action: 'Action', computed: 'Computed value', prop: 'Property', layout: 'Layout variable', site: 'The site'
}

const scope = computed(() => (editor.selectedId ? editor.scopeOf(editor.selectedId) : []))

const items = computed<DropdownMenuItem[][]>(() => {
  const groups = scope.value
    .map(entry => ({ entry, paths: bindingPaths([entry], { leaves: true }) }))
    .filter(group => group.paths.length)
    .map(({ entry, paths }): DropdownMenuItem[] => [
      { label: entry.name, type: 'label' as const },
      ...paths.map(path => ({ label: path, icon: 'i-lucide-database', description: SOURCE_LABELS[entry.source], ui: NAME_UI, onSelect: () => insert(path) }))
    ])
  return groups.length ? groups : [[{ label: 'Nothing to insert here', disabled: true }]]
})

const PICKER_UI = { content: 'max-w-64', itemDescription: 'truncate text-dimmed' }
</script>

<template>
  <span
    ref="anchor"
    class="contents"
  >
    <EditorMenu
      :items="items"
      :content="{ align: 'end' }"
      :on-close-auto-focus="restoreFocus"
      :ui="PICKER_UI"
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
    </EditorMenu>
  </span>
</template>
