<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * PROTOTYPE, throwaway (branch prototype/api-panel-layout): a floating bar that cycles `?variant=` on the current route.
 * ← and → (outside a field) cycle too. Never merge to main.
 */
const { variants } = defineProps<{ variants: { key: string, name: string }[] }>()
const route = useRoute()
const router = useRouter()

const current = computed(() => {
  const wanted = String(route.query.variant ?? variants[0]!.key)
  return variants.find(variant => variant.key === wanted) ?? variants[0]!
})

function go(step: number) {
  const at = variants.indexOf(current.value)
  const next = variants[(at + step + variants.length) % variants.length]!
  void router.replace({ query: { ...route.query, variant: next.key } })
}

function onKey(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"], [role="radiogroup"], [role="tablist"]')) return
  if (event.key === 'ArrowLeft') go(-1)
  else if (event.key === 'ArrowRight') go(1)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div
    class="fixed bottom-16 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border-2 border-amber-400 bg-amber-300 px-1.5 py-1 text-[12px] font-[600] text-black shadow-xl"
    data-prototype-switcher
  >
    <button
      type="button"
      class="flex size-7 items-center justify-center rounded-full hover:bg-black/10"
      aria-label="Previous variant"
      @click="go(-1)"
    >
      <UIcon
        name="i-lucide-chevron-left"
        class="size-4"
      />
    </button>
    <span class="px-2 whitespace-nowrap">PROTOTYPE · {{ current.key }} ({{ current.name }})</span>
    <button
      type="button"
      class="flex size-7 items-center justify-center rounded-full hover:bg-black/10"
      aria-label="Next variant"
      @click="go(1)"
    >
      <UIcon
        name="i-lucide-chevron-right"
        class="size-4"
      />
    </button>
  </div>
</template>
