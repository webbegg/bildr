<script setup lang="ts">
import { STYLE_FIELDS, STYLE_GROUPS } from '#shared/editor/styleFields'

defineProps<{ styles: Record<string, string> }>()
const emit = defineEmits<{ update: [style: Record<string, string | null>] }>()

const groups = STYLE_GROUPS.map(group => ({ group, fields: STYLE_FIELDS.filter(f => f.group === group) }))

function set(key: string, value: string) {
  emit('update', { [key]: value.trim() || null })
}
</script>

<template>
  <div class="space-y-4">
    <div
      v-for="{ group, fields } in groups"
      :key="group"
    >
      <p class="mb-2 text-xs font-medium text-muted">
        {{ group }}
      </p>
      <div class="grid grid-cols-2 gap-2">
        <UFormField
          v-for="field in fields"
          :key="field.key"
          :label="field.label"
          size="xs"
        >
          <div
            v-if="field.options"
            class="flex items-center gap-0.5"
          >
            <USelect
              :model-value="styles[field.key]"
              :items="field.options"
              placeholder="Default"
              size="sm"
              class="min-w-0 flex-1"
              @update:model-value="set(field.key, $event)"
            />
            <UButton
              v-if="styles[field.key]"
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-label="`Clear ${field.label}`"
              @click="set(field.key, '')"
            />
          </div>
          <EditorCommitInput
            v-else
            :model-value="styles[field.key] ?? ''"
            :placeholder="field.placeholder"
            @commit="set(field.key, $event)"
          />
        </UFormField>
      </div>
    </div>
  </div>
</template>
