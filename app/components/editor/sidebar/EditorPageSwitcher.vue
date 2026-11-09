<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/** The Layers panel's page switcher, Framer's: the current page with a menu of the others, and Add page. */
const editor = useEditor()
const adding = ref(false)
const newName = ref('')

const items = computed<DropdownMenuItem[]>(() => (editor.project?.pages ?? []).map(page => ({
  label: `${page.name}  /${page.slug}`,
  icon: 'i-lucide-file',
  type: 'checkbox',
  checked: page.id === editor.page?.id,
  onSelect: () => editor.selectPage(page.id)
})))

async function addPage() {
  const name = newName.value.trim()
  if (!name) return
  if (await editor.addPage(name)) {
    newName.value = ''
    adding.value = false
  }
}
</script>

<template>
  <div
    class="border-b border-default px-1.5 pb-1.5"
    data-page-switcher
  >
    <div class="flex items-center gap-1">
      <UDropdownMenu
        :items="items"
        :content="{ align: 'start' }"
      >
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-highlighted hover:bg-elevated"
          aria-label="Switch page"
        >
          <UIcon
            name="i-lucide-file"
            class="size-3.5 shrink-0 text-dimmed"
          />
          <span class="truncate font-medium">{{ editor.page?.name }}</span>
          <span class="truncate text-dimmed">/{{ editor.page?.slug }}</span>
          <UIcon
            name="i-lucide-chevron-down"
            class="ms-auto size-3 shrink-0 text-dimmed"
          />
        </button>
      </UDropdownMenu>
      <UButton
        icon="i-lucide-plus"
        size="xs"
        color="neutral"
        variant="ghost"
        aria-label="Add page"
        @click="adding = !adding"
      />
    </div>
    <form
      v-if="adding"
      class="px-1.5 pt-1"
      @submit.prevent="addPage"
    >
      <UInput
        v-model="newName"
        size="sm"
        placeholder="Page name"
        autofocus
        class="w-full"
        @keydown.esc="adding = false"
      />
    </form>
  </div>
</template>
