<script setup lang="ts">
import { STYLE_DEFAULT, styleFieldGroups, styleFieldItems, styleFieldUpdate } from '#shared/editor/styleFields'

defineProps<{ styles: Record<string, string> }>()
const emit = defineEmits<{ update: [style: Record<string, string | null>] }>()

const groups = styleFieldGroups().map(({ group, fields }) => ({
  group,
  fields: fields.map(field => ({ ...field, items: styleFieldItems(field) }))
}))
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
          <USelect
            :model-value="styles[field.key] ?? STYLE_DEFAULT"
            :items="field.items"
            size="sm"
            class="w-full"
            :data-style-key="field.key"
            @update:model-value="emit('update', styleFieldUpdate(field.key, $event))"
          />
        </UFormField>
      </div>
    </div>
  </div>
</template>
