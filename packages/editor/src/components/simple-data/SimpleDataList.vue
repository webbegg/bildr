<script setup lang="ts">
import type { StateFile } from '@bildr/codegen/model'
import type { SimpleChoice } from '../../editor/useSimpleData.ts'
import { FOCUS_RING } from '../../editorUi.ts'
import { PERSISTENCE } from '../../shared/dataArtifacts.ts'
import type { SimpleApi } from '../../shared/simpleData.ts'
import { stateLabel } from '../../shared/stateModel.ts'

/**
 * The simple Data section's list (simple data, S2): two sections, **State** (the stores the app's pages share: every state of the
 * model, each with how long it keeps its values) and **APIs** (the remote APIs the app calls, each with its base URL's host). A row
 * chooses what the section shows; the State section's + makes a store. Each section has an empty state that says what it is for. An
 * API is made in a later step, so its section has no way to make one yet. The rows are plain words: a store, an API.
 */
const { stores, apis, shown, creating } = defineProps<{
  stores: StateFile[]
  apis: SimpleApi[]
  shown: SimpleChoice | null
  creating: boolean
}>()
const emit = defineEmits<{ choose: [choice: SimpleChoice], create: [] }>()

const keeps = (store: StateFile) => PERSISTENCE.find(choice => choice.value === store.persist)?.label ?? ''
const isShown = (kind: SimpleChoice['kind'], id: string) => shown?.kind === kind && shown.id === id
const ROW = 'flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors'
</script>

<template>
  <div
    class="flex size-full flex-col gap-4 overflow-y-auto p-2"
    role="group"
    aria-label="Stores and APIs"
    data-simple-list
  >
    <section
      data-simple-section="state"
      aria-labelledby="simple-state-heading"
    >
      <div class="flex h-8 items-center justify-between ps-2.5 pe-1">
        <h2
          id="simple-state-heading"
          class="text-[12px] font-[550] text-muted"
        >
          State
        </h2>
        <EditorButton
          variant="ghost"
          size="xs"
          icon="i-lucide-plus"
          aria-label="New store"
          title="New store"
          data-simple-new-store
          @click="emit('create')"
        />
      </div>
      <ul
        v-if="stores.length"
        class="space-y-0.5"
      >
        <li
          v-for="store in stores"
          :key="store.id"
        >
          <button
            type="button"
            :class="[ROW, FOCUS_RING, isShown('state', store.id) ? 'bg-white/8 text-highlighted' : 'text-toned hover:bg-white/4']"
            :aria-current="isShown('state', store.id) ? 'true' : undefined"
            :data-simple-store="store.id"
            @click="emit('choose', { kind: 'state', id: store.id })"
          >
            <UIcon
              name="i-lucide-toggle-right"
              class="size-4 shrink-0 text-dimmed"
            />
            <span class="min-w-0 flex-1">
              <span
                class="block truncate text-[13px]"
                data-simple-row-name
              >{{ stateLabel(store) }}</span>
              <span
                class="block truncate text-[11px] text-dimmed"
                data-simple-row-note
              >{{ keeps(store) }}</span>
            </span>
          </button>
        </li>
      </ul>
      <div
        v-else
        class="mx-1 rounded-xl border border-dashed border-white/10 px-3 py-4 text-center"
        data-simple-empty="state"
      >
        <UIcon
          name="i-lucide-toggle-right"
          class="mx-auto size-5 text-dimmed"
        />
        <p class="mt-2 text-[13px] font-[550] text-highlighted">
          No stores yet
        </p>
        <p class="mt-1 text-[12px] leading-4 text-muted">
          A store keeps values your pages share, like a filter or a toggle.
        </p>
        <EditorButton
          class="mt-3"
          variant="primary"
          size="xs"
          icon="i-lucide-plus"
          label="New store"
          :disabled="creating"
          data-simple-empty-new
          @click="emit('create')"
        />
      </div>
    </section>

    <section
      data-simple-section="apis"
      aria-labelledby="simple-apis-heading"
    >
      <div class="flex h-8 items-center ps-2.5">
        <h2
          id="simple-apis-heading"
          class="text-[12px] font-[550] text-muted"
        >
          APIs
        </h2>
      </div>
      <ul
        v-if="apis.length"
        class="space-y-0.5"
      >
        <li
          v-for="api in apis"
          :key="api.id"
        >
          <button
            type="button"
            :class="[ROW, FOCUS_RING, isShown('api', api.id) ? 'bg-white/8 text-highlighted' : 'text-toned hover:bg-white/4']"
            :aria-current="isShown('api', api.id) ? 'true' : undefined"
            :data-simple-api="api.id"
            @click="emit('choose', { kind: 'api', id: api.id })"
          >
            <UIcon
              name="i-lucide-globe"
              class="size-4 shrink-0 text-dimmed"
            />
            <span class="min-w-0 flex-1">
              <span
                class="block truncate text-[13px]"
                data-simple-row-name
              >{{ api.name }}</span>
              <span
                class="block truncate text-[11px] text-dimmed"
                data-simple-row-note
              >{{ api.host }}</span>
            </span>
          </button>
        </li>
      </ul>
      <div
        v-else
        class="mx-1 rounded-xl border border-dashed border-white/10 px-3 py-4 text-center"
        data-simple-empty="apis"
      >
        <UIcon
          name="i-lucide-globe"
          class="mx-auto size-5 text-dimmed"
        />
        <p class="mt-2 text-[13px] font-[550] text-highlighted">
          No APIs yet
        </p>
        <p class="mt-1 text-[12px] leading-4 text-muted">
          The remote APIs your app calls will be listed here, with their address.
        </p>
      </div>
    </section>
  </div>
</template>
