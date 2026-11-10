<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { envRef, insertAt } from '#shared/env/insert'

/**
 * The braces button inside a text field: a menu of the project's variables
 * that types `{{ env.NAME }}` over the field's selection and emits `insert`
 * with the new text (the parent commits it), then puts focus and the caret
 * back after the ref. The field is the nearest input or textarea around the
 * button. Secrets only resolve on the server, so `secrets` enables them
 * (API URLs and headers); elsewhere they are listed but disabled.
 */
const props = defineProps<{ secrets?: boolean }>()
const emit = defineEmits<{ insert: [text: string] }>()
const editor = useEditor()

const anchor = useTemplateRef<HTMLElement>('anchor')
let caret: number | null = null

function field(): HTMLInputElement | HTMLTextAreaElement | null {
  let el = anchor.value?.parentElement
  while (el && !el.querySelector('input, textarea')) el = el.parentElement
  return el?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea') ?? null
}

function pick(name: string) {
  const el = field()
  if (!el) return
  const value = el.value
  const result = insertAt(value, el.selectionStart ?? value.length, el.selectionEnd ?? value.length, envRef(name))
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

function manage() {
  editor.mode = 'settings'
  editor.variablesRequest++
}

const SECRET_HINT = 'Secrets only work in API URLs and headers'
const NAME_UI = { itemLabel: 'font-mono text-[12px]' }

const items = computed<DropdownMenuItem[][]>(() => {
  const variables: DropdownMenuItem[] = editor.env.map(v => v.secret
    ? { label: v.name, icon: 'i-lucide-lock', slot: 'secret' as const, description: props.secrets ? undefined : SECRET_HINT, disabled: !props.secrets, ui: NAME_UI, onSelect: () => pick(v.name) }
    : { label: v.name, icon: 'i-lucide-braces', description: v.value || undefined, ui: NAME_UI, onSelect: () => pick(v.name) })
  return [
    variables.length ? variables : [{ label: 'No variables yet', disabled: true }],
    [{ label: 'Manage variables…', icon: 'i-lucide-settings-2', onSelect: manage }]
  ]
})

const MENU_UI = { content: 'min-w-36 max-w-64 rounded-xl bg-elevated p-1 ring-white/8', item: 'px-2.5 py-1.5 text-[13px]', itemDescription: 'truncate text-[11px] text-dimmed' }
</script>

<template>
  <span
    ref="anchor"
    class="contents"
  >
    <UDropdownMenu
      :items="items"
      :content="{ align: 'end', side: 'bottom', sideOffset: 4, onCloseAutoFocus: restoreFocus }"
      :ui="MENU_UI"
    >
      <button
        type="button"
        class="grid size-5 shrink-0 place-items-center rounded text-dimmed hover:bg-white/8 hover:text-highlighted aria-expanded:bg-white/8 aria-expanded:text-highlighted"
        aria-label="Insert variable"
        data-variable-picker
      >
        <UIcon
          name="i-lucide-braces"
          class="size-3.5"
        />
      </button>
      <template #secret-trailing>
        <span class="ms-auto text-[11px] text-dimmed">secret</span>
      </template>
    </UDropdownMenu>
  </span>
</template>
