<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { actionSummary, apiSourceOf, modelSummary, querySummary } from '../../shared/simpleApi.ts'
import { FOCUS_RING } from '../../editorUi.ts'
import PrototypeSwitcher from '../PrototypeSwitcher.vue'
import type { OverviewSection } from './SimpleApiOverview.vue'
import type { SimpleApi } from '../../shared/simpleData.ts'
import { useEditor } from '../../editor/useEditor.ts'
import SimpleApiItemDialog from './SimpleApiItemDialog.vue'
import type { ItemKind, ItemTarget } from './SimpleApiItemDialog.vue'
import SimpleApiModel from './SimpleApiModel.vue'
import SimpleApiOperation from './SimpleApiOperation.vue'
import SimpleApiOverview from './SimpleApiOverview.vue'

/**
 * An API's panel in the simple Data section (simple data, S2, S4, S6): the API's overview, its settings and its lists of queries, actions
 * and models (`SimpleApiOverview`), or the editor of the one item opened from a list, a query or an action (`SimpleApiOperation`) or a
 * model (`SimpleApiModel`), shown instead with a way back. Every write is a module action (`api_*`, `datasource_delete`). The API's own
 * Delete, and the New, Rename and Delete of a list's items, are one dialog (`SimpleApiItemDialog`).
 *
 * Moving to an editor, or back, asks about unsaved edits first, as the workspace does (`leaveData`); an item opened from the + is not saved
 * until its editor is, so it is only a name until then. A rename keeps the open editor (and its edits) on the renamed item.
 */
const { api } = defineProps<{ api: SimpleApi }>()
const editor = useEditor()

const source = computed(() => apiSourceOf(editor.model, api.id))

/** The item whose editor is open. `key` tells one opening from another, so a rename keeps the editor and its edits. */
const editing = ref<{ kind: ItemKind, name: string, key: number } | null>(null)
let openings = 0
const dialog = ref<ItemTarget | null>(null)

const show = (kind: ItemKind, name: string) => editor.leaveData(() => {
  editing.value = { kind, name, key: ++openings }
})
const back = () => editor.leaveData(() => {
  editing.value = null
})
/** A new item asks for its name first: moving to its editor comes after, so unsaved edits are asked about before the dialog. */
const create = (kind: ItemKind) => editor.leaveData(() => {
  dialog.value = { mode: 'new', kind, name: '' }
})
const rename = (kind: ItemKind, name: string) => {
  dialog.value = { mode: 'rename', kind, name }
}
const remove = (kind: ItemKind | 'api', name: string) => {
  dialog.value = { mode: 'delete', kind, name }
}

// ── PROTOTYPE (api-panel-layout), throwaway: layouts switched by `?variant=` ─────────────────────────
const VARIANTS = [
  { key: 'A', name: 'Sections sidebar' },
  { key: 'B', name: 'Tree sidebar' },
  { key: 'C', name: 'Rail + list + editor' },
  { key: 'now', name: 'Today' }
]
const route = useRoute()
const variant = computed(() => VARIANTS.some(v => v.key === route.query.variant) ? String(route.query.variant) : 'A')

type Group = 'queries' | 'actions' | 'models'
const section = ref<OverviewSection>('general')
const GROUPS: { key: Group, kind: ItemKind, title: string, icon: string, empty: string }[] = [
  { key: 'queries', kind: 'query', title: 'Queries', icon: 'i-lucide-download', empty: 'No queries yet. A query reads data from the API.' },
  { key: 'actions', kind: 'action', title: 'Actions', icon: 'i-lucide-zap', empty: 'No actions yet. An action changes data in the API.' },
  { key: 'models', kind: 'model', title: 'Models', icon: 'i-lucide-shapes', empty: 'No models yet. A model is the shape of what the API answers.' }
]
const groupOf = (kind: ItemKind): Group => kind === 'query' ? 'queries' : kind === 'action' ? 'actions' : 'models'
const rowsOf = (group: Group) => {
  const s = source.value
  if (!s) return []
  if (group === 'queries') return s.queries.map(q => ({ name: q.name, note: querySummary(q) }))
  if (group === 'actions') return s.actions.map(a => ({ name: a.name, note: actionSummary(a) }))
  return s.models.map(m => ({ name: m.name, note: modelSummary(m) }))
}
/** Sidebar pick: a section, or (B, C) an item. Moving asks about unsaved edits first. */
const pick = (to: OverviewSection) => editor.leaveData(() => {
  editing.value = null
  section.value = to
})
/** C: a group opens its first item next to the list. */
const pickGroup = (group: Group) => editor.leaveData(() => {
  section.value = group
  const first = rowsOf(group)[0]
  const kind = GROUPS.find(g => g.key === group)!.kind
  editing.value = first ? { kind, name: first.name, key: ++openings } : null
})
const isOpen = (kind: ItemKind, name: string) => editing.value?.kind === kind && editing.value.name === name
const sectionActive = (to: OverviewSection) => editing.value ? groupOf(editing.value.kind) === to : section.value === to
const navItem = (active: boolean) => ['flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px]', FOCUS_RING, active ? 'bg-white/8 text-highlighted' : 'text-muted hover:bg-white/4 hover:text-toned']

function renamed(kind: ItemKind, from: string, to: string) {
  if (editing.value?.kind === kind && editing.value.name === from) editing.value = { ...editing.value, name: to }
}
function deleted(kind: ItemKind | 'api', name: string) {
  if (kind === 'api') void editor.reloadEnv()
  else if (editing.value?.kind === kind && editing.value.name === name) editing.value = null
}
</script>

<template>
  <div
    class="flex size-full min-w-0 flex-col"
    :data-simple-api-panel="api.id"
  >
    <header class="flex h-12 shrink-0 items-center gap-2 border-b border-default ps-6 pe-3">
      <UIcon
        name="i-lucide-globe"
        class="size-4 shrink-0 text-dimmed"
      />
      <h2
        class="truncate text-[13px] font-[550] text-highlighted"
        data-simple-title
      >
        {{ api.name }}
      </h2>
      <span class="shrink-0 text-[11px] text-dimmed">API</span>
      <span class="shrink-0 truncate font-mono text-[11px] text-dimmed">{{ api.host }}</span>
      <span class="flex-1" />
      <EditorButton
        variant="ghost"
        icon="i-lucide-trash-2"
        label="Delete"
        data-simple-api-delete
        @click="remove('api', api.name)"
      />
    </header>

    <template v-if="source">
      <!-- PROTOTYPE A: a sidebar of sections; an item's editor opens in the right pane, the sidebar stays. -->
      <div
        v-if="variant === 'A'"
        class="flex min-h-0 flex-1"
      >
        <nav
          class="w-52 shrink-0 space-y-4 overflow-y-auto border-r border-default p-3"
          aria-label="API sections"
        >
          <div class="space-y-0.5">
            <p class="px-2 pb-1 text-[11px] font-[550] tracking-wide text-dimmed uppercase">
              Settings
            </p>
            <button
              type="button"
              :class="navItem(sectionActive('general'))"
              @click="pick('general')"
            >
              <UIcon
                name="i-lucide-settings-2"
                class="size-4 shrink-0"
              />
              <span class="flex-1">General</span>
            </button>
            <button
              type="button"
              :class="navItem(sectionActive('signin'))"
              @click="pick('signin')"
            >
              <UIcon
                name="i-lucide-key-round"
                class="size-4 shrink-0"
              />
              <span class="flex-1">Sign-in</span>
              <span class="text-[11px] text-dimmed">{{ source.auth ? source.auth.type === 'bearer' ? 'Bearer' : 'Key' : 'None' }}</span>
            </button>
          </div>
          <div class="space-y-0.5">
            <p class="px-2 pb-1 text-[11px] font-[550] tracking-wide text-dimmed uppercase">
              Calls &amp; data
            </p>
            <button
              v-for="group in GROUPS"
              :key="group.key"
              type="button"
              :class="navItem(sectionActive(group.key))"
              @click="pick(group.key)"
            >
              <UIcon
                :name="group.icon"
                class="size-4 shrink-0"
              />
              <span class="flex-1">{{ group.title }}</span>
              <span class="text-[11px] text-dimmed tabular-nums">{{ rowsOf(group.key).length }}</span>
            </button>
          </div>
        </nav>
        <div class="flex min-w-0 flex-1 flex-col">
          <SimpleApiOperation
            v-if="editing && editing.kind !== 'model'"
            :key="editing.key"
            :source="source"
            :kind="editing.kind"
            :name="editing.name"
            @back="back()"
            @rename="rename(editing.kind, editing.name)"
          />
          <SimpleApiModel
            v-else-if="editing"
            :key="editing.key"
            :source="source"
            :name="editing.name"
            @back="back()"
            @rename="rename('model', editing.name)"
          />
          <SimpleApiOverview
            v-else
            :source="source"
            :section="section"
            wide
            @open="show"
            @create="create"
            @rename="rename"
            @remove="remove"
          />
        </div>
      </div>

      <!-- PROTOTYPE B: a tree of every query, action and model (FlutterFlow's API group); Settings is its first row. -->
      <div
        v-else-if="variant === 'B'"
        class="flex min-h-0 flex-1"
      >
        <nav
          class="w-64 shrink-0 space-y-3 overflow-y-auto border-r border-default p-2"
          aria-label="API contents"
        >
          <button
            type="button"
            :class="navItem(!editing)"
            @click="pick('settings')"
          >
            <UIcon
              name="i-lucide-settings-2"
              class="size-4 shrink-0"
            />
            <span class="flex-1">Settings</span>
            <span class="truncate font-mono text-[10px] text-dimmed">{{ source.auth ? 'signed in' : 'open' }}</span>
          </button>
          <div
            v-for="group in GROUPS"
            :key="group.key"
          >
            <div class="flex h-7 items-center gap-1 ps-2 pe-0.5">
              <span class="flex-1 text-[11px] font-[550] tracking-wide text-dimmed uppercase">{{ group.title }}</span>
              <EditorButton
                variant="ghost"
                size="xs"
                icon="i-lucide-plus"
                :aria-label="`New ${group.kind}`"
                @click="create(group.kind)"
              />
            </div>
            <ul
              v-if="rowsOf(group.key).length"
              class="space-y-0.5"
            >
              <li
                v-for="row in rowsOf(group.key)"
                :key="row.name"
                class="group/row relative"
              >
                <button
                  type="button"
                  :class="[navItem(isOpen(group.kind, row.name)), 'pe-12']"
                  @click="show(group.kind, row.name)"
                >
                  <span
                    v-if="group.kind !== 'model'"
                    class="w-11 shrink-0 font-mono text-[10px] font-[600]"
                    :class="row.note.startsWith('GET') ? 'text-success' : 'text-warning'"
                  >{{ row.note.split(' ')[0] }}</span>
                  <UIcon
                    v-else
                    name="i-lucide-shapes"
                    class="size-3.5 shrink-0"
                  />
                  <span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
                </button>
                <span class="absolute inset-y-0 end-1 hidden items-center group-hover/row:flex">
                  <EditorButton
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-pencil"
                    :aria-label="`Rename ${row.name}`"
                    @click="rename(group.kind, row.name)"
                  />
                  <EditorButton
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-trash-2"
                    :aria-label="`Delete ${row.name}`"
                    @click="remove(group.kind, row.name)"
                  />
                </span>
              </li>
            </ul>
            <p
              v-else
              class="px-2 py-1 text-[11px] text-dimmed"
            >
              None yet
            </p>
          </div>
        </nav>
        <div class="flex min-w-0 flex-1 flex-col">
          <SimpleApiOperation
            v-if="editing && editing.kind !== 'model'"
            :key="editing.key"
            :source="source"
            :kind="editing.kind"
            :name="editing.name"
            @back="back()"
            @rename="rename(editing.kind, editing.name)"
          />
          <SimpleApiModel
            v-else-if="editing"
            :key="editing.key"
            :source="source"
            :name="editing.name"
            @back="back()"
            @rename="rename('model', editing.name)"
          />
          <SimpleApiOverview
            v-else
            :source="source"
            section="settings"
            wide
            @open="show"
            @create="create"
            @rename="rename"
            @remove="remove"
          />
        </div>
      </div>

      <!-- PROTOTYPE C: an icon rail of sections, the chosen group's list, and its item's editor (three panes). -->
      <div
        v-else-if="variant === 'C'"
        class="flex min-h-0 flex-1"
      >
        <nav
          class="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-default py-2"
          aria-label="API sections"
        >
          <button
            v-for="item in [{ key: 'settings', title: 'Settings', icon: 'i-lucide-settings-2', count: 0 }, ...GROUPS.map(g => ({ key: g.key, title: g.title, icon: g.icon, count: rowsOf(g.key).length }))]"
            :key="item.key"
            type="button"
            :title="item.title"
            :aria-label="item.title"
            class="relative flex size-9 items-center justify-center rounded-md"
            :class="[FOCUS_RING, section === item.key || (item.key === 'settings' && ['general', 'signin'].includes(section)) ? 'bg-white/10 text-highlighted' : 'text-muted hover:bg-white/4 hover:text-toned']"
            @click="item.key === 'settings' ? pick('settings') : pickGroup(item.key as Group)"
          >
            <UIcon
              :name="item.icon"
              class="size-4"
            />
            <span
              v-if="item.count"
              class="absolute -end-0.5 -top-0.5 rounded-full bg-white/15 px-1 text-[9px] leading-3.5 text-toned tabular-nums"
            >{{ item.count }}</span>
          </button>
        </nav>
        <div
          v-if="section === 'settings' || section === 'general' || section === 'signin'"
          class="flex min-w-0 flex-1 flex-col"
        >
          <SimpleApiOverview
            :source="source"
            section="settings"
            wide
            @open="show"
            @create="create"
            @rename="rename"
            @remove="remove"
          />
        </div>
        <template v-else>
          <div
            v-for="group in GROUPS.filter(g => g.key === section)"
            :key="group.key"
            class="flex w-60 shrink-0 flex-col border-r border-default"
          >
            <div class="flex h-11 shrink-0 items-center gap-1 border-b border-default ps-3 pe-1.5">
              <span class="flex-1 text-[12px] font-[550] text-highlighted">{{ group.title }}</span>
              <EditorButton
                variant="ghost"
                size="xs"
                icon="i-lucide-plus"
                :aria-label="`New ${group.kind}`"
                @click="create(group.kind)"
              />
            </div>
            <ul
              v-if="rowsOf(group.key).length"
              class="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5"
            >
              <li
                v-for="row in rowsOf(group.key)"
                :key="row.name"
              >
                <button
                  type="button"
                  :class="['w-full rounded-md px-2.5 py-1.5 text-left', FOCUS_RING, isOpen(group.kind, row.name) ? 'bg-white/8' : 'hover:bg-white/4']"
                  @click="show(group.kind, row.name)"
                >
                  <span class="block truncate text-[12px] text-toned">{{ row.name }}</span>
                  <span class="block truncate font-mono text-[10px] text-dimmed">{{ row.note }}</span>
                </button>
              </li>
            </ul>
            <p
              v-else
              class="m-3 rounded-lg border border-dashed border-white/10 p-3 text-[12px] leading-4 text-muted"
            >
              {{ group.empty }}
            </p>
          </div>
          <div class="flex min-w-0 flex-1 flex-col">
            <SimpleApiOperation
              v-if="editing && editing.kind !== 'model'"
              :key="editing.key"
              :source="source"
              :kind="editing.kind"
              :name="editing.name"
              @back="back()"
              @rename="rename(editing.kind, editing.name)"
            />
            <SimpleApiModel
              v-else-if="editing"
              :key="editing.key"
              :source="source"
              :name="editing.name"
              @back="back()"
              @rename="rename('model', editing.name)"
            />
            <div
              v-else
              class="flex flex-1 items-center justify-center text-[12px] text-dimmed"
            >
              Pick one on the left, or make a new one with +.
            </div>
          </div>
        </template>
      </div>

      <!-- Today's layout, for comparison. -->
      <template v-else>
        <SimpleApiOperation
          v-if="editing && editing.kind !== 'model'"
          :key="editing.key"
          :source="source"
          :kind="editing.kind"
          :name="editing.name"
          @back="back()"
          @rename="rename(editing.kind, editing.name)"
        />
        <SimpleApiModel
          v-else-if="editing"
          :key="editing.key"
          :source="source"
          :name="editing.name"
          @back="back()"
          @rename="rename('model', editing.name)"
        />
        <SimpleApiOverview
          v-else
          :source="source"
          @open="show"
          @create="create"
          @rename="rename"
          @remove="remove"
        />
      </template>
      <PrototypeSwitcher :variants="VARIANTS" />
      <SimpleApiItemDialog
        :target="dialog"
        :source="source"
        @close="dialog = null"
        @named="show"
        @renamed="renamed"
        @deleted="deleted"
      />
    </template>
  </div>
</template>
