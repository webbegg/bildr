<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { sessionEnded } from './api.ts'
import { registerScreens } from './editor/views.ts'
import { routes } from './router.ts'
import { usePolling, useStatus } from './status.ts'

/** The editor shell: left nav, the pending-migration banner on every screen, and the current screen; one notice instead, once the session ended. */

const route = useRoute()
const router = useRouter()
const status = useStatus()

// The Data view is its own screen: an editor that is asked for it (or for the Canvas, Design or Settings from there) opens the other one (editor/views.ts).
// The navigation's result goes back to views.ts, so a failed or cancelled one drops what was carried for the next screen.
onBeforeUnmount(registerScreens(screen => router.push(screen === 'data' ? '/data' : '/design')))

usePolling(status.refresh)

// No database (V7): no migrations, so no Migrations screen in the nav.
const nav = computed(() => routes.filter(record => record.meta?.label && (record.path !== '/migrations' || status.database.value)).map(record => ({
  label: String(record.meta!.label),
  icon: String(record.meta!.icon),
  to: record.path,
  active: route.path === record.path,
  ...(record.path === '/migrations' && status.pending.value ? { badge: { label: '1', color: 'error' as const } } : {})
})))

const losses = computed(() => {
  const count = status.pending.value?.losing.length ?? 0
  return `${count} ${count === 1 ? 'loss' : 'losses'}`
})
</script>

<template>
  <UApp>
    <div
      v-if="sessionEnded"
      class="h-screen bg-default p-6 text-default"
    >
      <UAlert
        data-testid="session-ended"
        color="neutral"
        variant="subtle"
        icon="i-lucide-plug-zap"
        title="This editor session ended. Open the editor again from the link in the nuxt dev log."
      />
    </div>
    <div
      v-else
      class="flex h-screen bg-default text-default"
    >
      <nav class="flex w-52 shrink-0 flex-col gap-4 border-r border-default p-3">
        <div class="flex items-center gap-2 px-2 pt-1 font-semibold">
          <UIcon
            name="i-lucide-blocks"
            class="size-5 text-primary"
          />
          bildr
        </div>
        <UNavigationMenu
          orientation="vertical"
          :items="nav"
        />
      </nav>
      <div class="flex min-w-0 flex-1 flex-col">
        <UAlert
          v-if="status.pending.value"
          data-testid="migration-banner"
          color="warning"
          variant="subtle"
          icon="i-lucide-database-zap"
          :ui="{ root: 'rounded-none' }"
          :title="`A destructive migration waits for confirmation (${losses}).`"
          :actions="route.path === '/migrations' ? [] : [{ label: 'Review', to: '/migrations', color: 'warning', variant: 'solid' }]"
        />
        <div class="relative min-h-0 flex-1 overflow-y-auto">
          <RouterView />
        </div>
      </div>
    </div>
  </UApp>
</template>
