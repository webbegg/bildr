<script setup lang="ts">
import { getComponent } from '#shared/document/components'
import type { PropValue } from '#shared/document/components'

const editor = useEditor()

const node = computed(() => editor.selected)
const isRoot = computed(() => !!node.value && node.value.id === editor.page?.root.id)
const propDefs = computed(() => (node.value ? getComponent(node.value.type)?.props ?? [] : []))

function propValue(name: string, fallback: PropValue): PropValue {
  return node.value?.props[name] ?? fallback
}

function renamePage(field: 'name' | 'slug', value: string) {
  const next = value.trim()
  if (next) editor.runOnPage('page_rename', { [field]: next })
}
</script>

<template>
  <div class="p-3">
    <p class="text-xs font-semibold text-muted uppercase">
      Properties
    </p>
    <p
      v-if="!node"
      class="mt-3 text-sm text-dimmed"
    >
      Select a component on the canvas or in the layers.
    </p>
    <div
      v-else
      :key="node.id"
      class="mt-3 space-y-5"
    >
      <div class="flex items-center gap-1">
        <p class="min-w-0 flex-1 truncate text-sm">
          {{ node.type }} <span class="text-dimmed">{{ node.id }}</span>
        </p>
        <template v-if="!isRoot">
          <UTooltip
            text="Duplicate"
            :kbds="['meta', 'd']"
          >
            <UButton
              icon="i-lucide-copy"
              color="neutral"
              variant="ghost"
              size="xs"
              aria-label="Duplicate"
              @click="editor.duplicate()"
            />
          </UTooltip>
          <UTooltip
            text="Delete"
            :kbds="['delete']"
          >
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              aria-label="Delete"
              @click="editor.remove()"
            />
          </UTooltip>
        </template>
      </div>

      <div
        v-if="isRoot && editor.page"
        class="space-y-3"
      >
        <UFormField
          label="Page name"
          size="sm"
        >
          <EditorCommitInput
            :model-value="editor.page.name"
            @commit="renamePage('name', $event)"
          />
        </UFormField>
        <UFormField
          label="Slug"
          size="sm"
        >
          <EditorCommitInput
            :model-value="editor.page.slug"
            @commit="renamePage('slug', $event)"
          />
        </UFormField>
      </div>

      <div
        v-if="propDefs.length"
        class="space-y-3"
      >
        <EditorPropField
          v-for="def in propDefs"
          :key="def.name"
          :def="def"
          :value="propValue(def.name, def.default)"
          @update="editor.updateProps(node.id, { [def.name]: $event })"
        />
      </div>

      <div>
        <p class="mb-3 border-t border-default pt-4 text-xs font-semibold text-muted uppercase">
          Style
        </p>
        <EditorStyleFields
          :styles="node.style"
          @update="editor.updateStyle(node.id, $event)"
        />
      </div>
    </div>
  </div>
</template>
