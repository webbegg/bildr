<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { sessionEnded } from './api.ts'
import { registerScreens } from './editor/views.ts'
import ScreenBar from './shell/ScreenBar.vue'
import { usePolling, useStatus } from './status.ts'

/** The editor shell: the pending-migration banner on every screen (on the Data screen, unless the workspace already shows the plan: a collection's banner, or the Migrations entry; S6), the top bar's view menu (the editor's own toolbar, or the ScreenBar of the screens without an editor) and the current screen; one notice instead, once the session ended. */

const route = useRoute()
const router = useRouter()
const status = useStatus()

// The Data view is its own screen: an editor that is asked for it (or for the Canvas, Design or Settings from there) opens the other one (editor/views.ts).
// The navigation's result goes back to views.ts, so a failed or cancelled one drops what was carried for the next screen.
onBeforeUnmount(registerScreens(screen => router.push(screen === 'data' ? '/data' : '/design')))

usePolling(status.refresh)

const losses = computed(() => {
  const count = status.plan.value?.losing.length ?? 0
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
      <div class="flex min-w-0 flex-1 flex-col">
        <UAlert
          v-if="status.plan.value && !status.planShown.value"
          data-testid="migration-banner"
          color="warning"
          variant="subtle"
          icon="i-lucide-database-zap"
          :ui="{ root: 'rounded-none' }"
          :title="`A destructive migration waits for confirmation (${losses}).`"
          :actions="[{ label: 'Review', to: { path: '/data', query: { item: 'migrations' } }, color: 'warning', variant: 'solid' }]"
        />
        <ScreenBar v-if="route.meta.bar" />
        <div class="relative min-h-0 flex-1 overflow-y-auto">
          <RouterView />
        </div>
      </div>
    </div>
  </UApp>
</template>
