<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { BreakpointBase } from '#shared/design/tokens'
import type { Project, ProjectSummary } from '#shared/document/schema'
import { matches } from '#shared/editor/sidebar'

/**
 * The projects page, Framer's: a slim top bar (wordmark, search, New project)
 * over a grid of project cards on the canvas colour, each with its slug, last
 * update, a Published badge and a `…` menu (Delete project…). It wears the
 * dark editor chrome, like the editor page. New project asks for a name and
 * the starting device: Desktop (a desktop-first project, the default) or
 * Mobile (mobile-first), `project_create {base}`.
 */
useSeoMeta({ title: 'Projects · bildr' })

const toast = useToast()
const { data: projects, refresh } = useAsyncData('projects', () => callAction<ProjectSummary[]>('project_list'))
const { data: published } = useAsyncData(
  'projects-published',
  async () => {
    const list = projects.value ?? []
    const infos = await Promise.all(list.map(p => callAction<{ version: number } | null>('project_published_info', { projectId: p.id }).catch(() => null)))
    return Object.fromEntries(list.map((p, i) => [p.id, !!infos[i]]))
  },
  { watch: [projects], default: () => ({} as Record<string, boolean>) }
)

const query = ref('')
const shown = computed(() => (projects.value ?? []).filter(p => matches(query.value, p.name, p.slug)))

const createOpen = ref(false)
const name = ref('')
const base = ref<BreakpointBase>('desktop')
const creating = ref(false)
const BASES: { value: BreakpointBase, label: string }[] = [{ value: 'desktop', label: 'Desktop' }, { value: 'mobile', label: 'Mobile' }]

watch(createOpen, (open) => {
  if (!open) return
  name.value = ''
  base.value = 'desktop'
})

async function create() {
  if (!name.value.trim()) return
  creating.value = true
  try {
    const project = await callAction<Project>('project_create', { name: name.value.trim(), base: base.value })
    await navigateTo(`/editor/${project.id}`)
  } catch (error) {
    toast.add({ title: 'Could not create the project', description: actionErrorMessage(error), color: 'error' })
  } finally {
    creating.value = false
  }
}

// The project whose delete confirm is open; it stays set while the modal closes, so its text does not blank.
const deleting = ref<ProjectSummary | null>(null)
const confirmOpen = ref(false)

function menu(project: ProjectSummary): DropdownMenuItem[][] {
  return [
    [{ label: 'Open', icon: 'i-lucide-pen-tool', to: `/editor/${project.id}` }],
    [{
      label: 'Delete project…',
      icon: 'i-lucide-trash-2',
      color: 'error',
      onSelect: () => {
        deleting.value = project
        confirmOpen.value = true
      }
    }]
  ]
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]

function updated(at: string) {
  const seconds = (new Date(at).getTime() - Date.now()) / 1000
  const [unit, size] = UNITS.find(([, size]) => Math.abs(seconds) >= size) ?? ['second', 1]
  return unit === 'second' ? 'just now' : relative.format(Math.round(seconds / size), unit)
}

// The dark editor chrome (main.css) on this page's document, as on the editor page.
onMounted(() => document.documentElement.classList.add('bildr-editor'))
onBeforeUnmount(() => document.documentElement.classList.remove('bildr-editor'))
</script>

<template>
  <div class="flex min-h-screen flex-col bg-(--editor-canvas)">
    <header class="sticky top-0 z-20 grid h-12 shrink-0 grid-cols-[1fr_minmax(0,320px)_1fr] items-center gap-3 border-b border-default bg-default px-3">
      <NuxtLink
        to="/"
        class="flex items-center gap-2 justify-self-start rounded-lg px-1.5 text-[15px] font-semibold tracking-tight text-highlighted"
      >
        <span class="grid size-6 place-items-center rounded-lg bg-(--editor-selection) text-white">
          <UIcon
            name="i-lucide-blocks"
            class="size-3.5"
          />
        </span>
        bildr
      </NuxtLink>
      <EditorInput
        v-model="query"
        icon="i-lucide-search"
        placeholder="Search projects"
        aria-label="Search projects"
        data-projects-search
        @keydown.esc="query = ''"
      />
      <EditorButton
        variant="primary"
        icon="i-lucide-plus"
        label="New project"
        class="justify-self-end"
        data-new-project
        @click="createOpen = true"
      />
    </header>

    <main class="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <h1 class="mb-4 text-[12px] font-[550] text-highlighted">
        Projects
      </h1>
      <div
        class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        data-projects-grid
      >
        <div
          v-for="project in shown"
          :key="project.id"
          class="group relative overflow-hidden rounded-xl bg-default ring ring-white/8 transition hover:ring-white/16"
          :data-project-card="project.slug"
        >
          <NuxtLink
            :to="`/editor/${project.id}`"
            class="block focus-visible:outline-2 focus-visible:outline-(--editor-selection)"
            :aria-label="`Open ${project.name}`"
          >
            <div class="grid aspect-[16/10] place-items-center border-b border-default bg-elevated/60">
              <UIcon
                name="i-lucide-app-window"
                class="size-8 text-dimmed transition group-hover:text-muted"
              />
            </div>
            <div class="space-y-1 px-3.5 py-3 pe-10">
              <p class="truncate text-[12px] font-[550] text-highlighted">
                {{ project.name }}
              </p>
              <p class="flex min-w-0 items-center gap-1.5 text-[12px] text-dimmed">
                <span class="truncate">/{{ project.slug }}</span>
                <span aria-hidden="true">·</span>
                <span
                  class="shrink-0"
                  :title="new Date(project.updatedAt).toLocaleString()"
                >{{ updated(project.updatedAt) }}</span>
              </p>
            </div>
          </NuxtLink>
          <span
            v-if="published[project.id]"
            class="pointer-events-none absolute top-2.5 left-2.5 rounded-md bg-success/15 px-1.5 py-0.5 text-[11px] font-medium text-success"
            data-published-badge
          >Published</span>
          <EditorMenu
            :items="menu(project)"
            :content="{ align: 'end' }"
          >
            <button
              type="button"
              :class="ACTION"
              class="absolute right-2 bottom-3 z-10"
              :aria-label="`${project.name} options`"
              data-project-menu
            >
              <UIcon
                name="i-lucide-ellipsis"
                class="size-4"
              />
            </button>
          </EditorMenu>
        </div>
      </div>
      <p
        v-if="projects && !projects.length"
        class="mt-8 text-[12px] text-dimmed"
      >
        No projects yet. Start one with New project.
      </p>
      <p
        v-else-if="projects && !shown.length"
        class="mt-8 text-[12px] text-dimmed"
      >
        No projects match “{{ query }}”.
      </p>
    </main>

    <EditorModal
      v-model:open="createOpen"
      title="New project"
      description="Build it visually, or let an agent build it with you."
      width="sm"
    >
      <form
        id="new-project"
        data-new-project-form
        @submit.prevent="create"
      >
        <EditorFormRow label="Name">
          <EditorInput
            v-model="name"
            placeholder="New project name"
            aria-label="Project name"
            autofocus
          />
        </EditorFormRow>
        <EditorFormRow
          label="Starting device"
          help="The device you design first; the other sizes override it."
          class="mt-3"
        >
          <EditorSegmented
            :model-value="base"
            :items="BASES"
            aria-label="Starting device"
            data-new-project-base
            @update:model-value="base = $event as BreakpointBase"
          />
        </EditorFormRow>
      </form>
      <template #footer>
        <EditorButton
          variant="ghost"
          label="Cancel"
          @click="createOpen = false"
        />
        <EditorButton
          variant="primary"
          type="submit"
          form="new-project"
          label="Create"
          :loading="creating"
          :disabled="!name.trim()"
        />
      </template>
    </EditorModal>

    <EditorDangerZone
      v-if="deleting"
      v-model:open="confirmOpen"
      :project="deleting"
      :section="false"
      @deleted="refresh()"
    />
  </div>
</template>
