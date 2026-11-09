<script setup lang="ts">
import type { AccordionItem } from '@nuxt/ui'
import { isResponsiveToken, STYLE_TOKENS, styleClasses, styleKey } from '#shared/design/tokens'
import type { Breakpoint, StyleToken } from '#shared/design/tokens'
import type { InheritedToken } from '#shared/editor/styleFields'
import { breakpointStyles, DEVICES, setStyleTokens, spacingItems, styleFieldControl, styleFieldGroups } from '#shared/editor/styleFields'

/**
 * Design-token pickers for a node's style: swatches from the project theme
 * for colours, the spacing scale in px for the project density, segments or
 * selects for the rest. Every pick is one `update` (one undo step).
 * Layout tokens edit the editor device's breakpoint (Mobile is the base,
 * Tablet `md:`, Desktop `lg:`) and show what they inherit from smaller ones;
 * the other tokens have no breakpoint variants and apply to every device.
 */
const props = defineProps<{ styles: Record<string, string> }>()
const emit = defineEmits<{ update: [style: Record<string, string | null>] }>()
const editor = useEditor()

const ALIGN_ICONS: Record<string, string> = {
  left: 'i-lucide-align-left',
  center: 'i-lucide-align-center',
  right: 'i-lucide-align-right',
  justify: 'i-lucide-align-justify'
}

const breakpoint = computed(() => editor.device.breakpoint)
const atBreakpoint = computed(() => breakpointStyles(props.styles, breakpoint.value))

function value(token: StyleToken): string | undefined {
  return isResponsiveToken(token) ? atBreakpoint.value.own[token.key] : props.styles[token.key]
}

function inherited(token: StyleToken): InheritedToken | undefined {
  return isResponsiveToken(token) ? atBreakpoint.value.inherited[token.key] : undefined
}

const breakpointLabel = (b: Breakpoint | undefined) => DEVICES.find(d => d.breakpoint === b)?.label ?? b!
const inheritedLabel = (token: StyleToken) => {
  const from = inherited(token)
  return from ? `${from.value} · ${breakpointLabel(from.from)}` : '—'
}

// The values this device edits, keyed by base token, for the group counts.
const current = computed(() => Object.fromEntries(STYLE_TOKENS.flatMap(t => (value(t) === undefined ? [] : [[t.key, value(t)!]]))))
const groups = computed(() => styleFieldGroups(current.value))
const applied = computed(() => setStyleTokens(props.styles))
const items = computed<AccordionItem[]>(() => groups.value.map(g => ({ label: g.group, value: g.group, setCount: g.setCount })))
// Opens the groups the node uses at this device or inherits (the inspector remounts this per node).
const openGroups = groups.value.filter(g => g.setCount || g.fields.some(f => inherited(f))).map(g => g.group)

function fieldsOf(group: string): StyleToken[] {
  return groups.value.find(g => g.group === group)?.fields ?? []
}

function options(token: StyleToken): { value: string, label: string }[] {
  if (styleFieldControl(token) === 'spacing') return spacingItems(token, editor.theme?.spacing ?? 'default')
  return token.values.map(value => ({ value, label: value }))
}

function segments(token: StyleToken) {
  return token.values.map(value => ({ value, label: value, icon: token.key === 'align' ? ALIGN_ICONS[value] : undefined }))
}

function set(key: string, value: string | null) {
  if ((props.styles[key] ?? null) !== value) emit('update', { [key]: value })
}

function setField(token: StyleToken, value: string | null) {
  set(isResponsiveToken(token) ? styleKey(token.key, breakpoint.value) : token.key, value)
}
</script>

<template>
  <div class="space-y-3">
    <p
      class="flex items-center gap-1.5 text-xs text-muted"
      :data-editing-breakpoint="breakpoint ?? 'base'"
    >
      <UIcon
        :name="editor.device.icon"
        class="size-3.5 shrink-0"
      />
      <span v-if="breakpoint">
        Layout tokens edit <span class="font-medium text-highlighted">{{ editor.device.label }}</span> (<code>{{ breakpoint }}:</code>) and up; colours, borders and shadows apply to every device.
      </span>
      <span v-else>
        Editing the base style (<span class="font-medium text-highlighted">Mobile</span> and up).
      </span>
    </p>

    <div
      v-if="applied.length"
      class="flex flex-wrap gap-1"
    >
      <UBadge
        v-for="token in applied"
        :key="token.key"
        color="neutral"
        variant="soft"
        size="sm"
        class="font-mono"
        :title="token.label"
      >
        {{ token.className }}
        <button
          type="button"
          class="-me-0.5 text-dimmed hover:text-highlighted"
          :aria-label="`Remove ${token.className}`"
          @click="set(token.key, null)"
        >
          <UIcon
            name="i-lucide-x"
            class="size-3"
          />
        </button>
      </UBadge>
    </div>
    <p
      v-else
      class="text-xs text-dimmed"
    >
      No tokens set; the component uses its defaults.
    </p>

    <UAccordion
      type="multiple"
      :items="items"
      :default-value="openGroups"
      :ui="{ trigger: 'py-2 text-xs font-medium', body: 'pb-3 pt-0' }"
    >
      <template #trailing="{ item }">
        <UBadge
          v-if="item.setCount"
          :label="String(item.setCount)"
          size="sm"
          variant="subtle"
          class="ms-auto"
        />
      </template>
      <template #body="{ item }">
        <div class="space-y-1.5">
          <div
            v-for="field in fieldsOf(item.value!)"
            :key="field.key"
            class="grid grid-cols-[5.5rem_1fr_1.25rem] items-center gap-1.5"
            :data-inherited="inherited(field)?.value"
            :title="inherited(field) ? `Inherited from ${breakpointLabel(inherited(field)!.from)}: ${inherited(field)!.value}` : undefined"
          >
            <span
              class="truncate text-xs"
              :class="value(field) !== undefined ? 'font-medium text-highlighted' : 'text-muted'"
            >{{ field.label }}</span>

            <EditorSwatchPicker
              v-if="styleFieldControl(field) === 'color' && editor.theme"
              :token="field"
              :value="value(field)"
              :theme="editor.theme"
              @update="setField(field, $event)"
            />
            <EditorSegmented
              v-else-if="styleFieldControl(field) === 'segmented'"
              :items="segments(field)"
              :model-value="value(field)"
              :inherited="inherited(field)?.value"
              :data-style-key="field.key"
              @update:model-value="setField(field, $event)"
            />
            <USelect
              v-else
              :model-value="value(field)"
              :items="options(field)"
              :placeholder="inheritedLabel(field)"
              size="xs"
              class="w-full"
              :aria-label="field.label"
              :data-style-key="field.key"
              @update:model-value="setField(field, $event)"
            >
              <template
                v-if="field.key === 'font'"
                #item-label="{ item: option }"
              >
                <span :class="styleClasses({ font: option.value })">{{ option.label }}</span>
              </template>
            </USelect>

            <UButton
              v-if="value(field) !== undefined"
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="xs"
              class="p-0.5"
              :aria-label="`Clear ${field.label}`"
              @click="setField(field, null)"
            />
          </div>
        </div>
      </template>
    </UAccordion>
  </div>
</template>
