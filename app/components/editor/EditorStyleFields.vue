<script setup lang="ts">
import type { AccordionItem } from '@nuxt/ui'
import { styleClasses } from '#shared/design/tokens'
import type { StyleToken } from '#shared/design/tokens'
import { setStyleTokens, spacingItems, styleFieldControl, styleFieldGroups } from '#shared/editor/styleFields'

/**
 * Design-token pickers for a node's style: swatches from the project theme
 * for colours, the spacing scale in px for the project density, segments or
 * selects for the rest. Every pick is one `update` (one undo step).
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

const groups = computed(() => styleFieldGroups(props.styles))
const applied = computed(() => setStyleTokens(props.styles))
const items = computed<AccordionItem[]>(() => groups.value.map(g => ({ label: g.group, value: g.group, setCount: g.setCount })))
// Opens the groups the node uses (the inspector remounts this per node).
const openGroups = groups.value.filter(g => g.setCount).map(g => g.group)

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
</script>

<template>
  <div class="space-y-3">
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
          >
            <span
              class="truncate text-xs"
              :class="styles[field.key] !== undefined ? 'font-medium text-highlighted' : 'text-muted'"
            >{{ field.label }}</span>

            <EditorSwatchPicker
              v-if="styleFieldControl(field) === 'color' && editor.theme"
              :token="field"
              :value="styles[field.key]"
              :theme="editor.theme"
              @update="set(field.key, $event)"
            />
            <EditorSegmented
              v-else-if="styleFieldControl(field) === 'segmented'"
              :items="segments(field)"
              :model-value="styles[field.key]"
              :data-style-key="field.key"
              @update:model-value="set(field.key, $event)"
            />
            <USelect
              v-else
              :model-value="styles[field.key]"
              :items="options(field)"
              placeholder="—"
              size="xs"
              class="w-full"
              :aria-label="field.label"
              :data-style-key="field.key"
              @update:model-value="set(field.key, $event)"
            >
              <template
                v-if="field.key === 'font'"
                #item-label="{ item: option }"
              >
                <span :class="styleClasses({ font: option.value })">{{ option.label }}</span>
              </template>
            </USelect>

            <UButton
              v-if="styles[field.key] !== undefined"
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="xs"
              class="p-0.5"
              :aria-label="`Clear ${field.label}`"
              @click="set(field.key, null)"
            />
          </div>
        </div>
      </template>
    </UAccordion>
  </div>
</template>
