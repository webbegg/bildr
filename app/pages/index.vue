<script setup lang="ts">
import type { Project, ProjectSummary } from '#shared/document/schema'

const toast = useToast()
const { data: projects } = useAsyncData('projects', () => callAction<ProjectSummary[]>('project_list'))

const name = ref('')
const creating = ref(false)

async function create() {
  if (!name.value.trim()) return
  creating.value = true
  try {
    const project = await callAction<Project>('project_create', { name: name.value.trim() })
    await navigateTo(`/editor/${project.id}`)
  } catch (error) {
    toast.add({ title: 'Could not create the project', description: actionErrorMessage(error), color: 'error' })
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <UContainer class="py-10">
    <UPageHeader
      title="Projects"
      description="Build apps visually, or let an agent build them with you."
    />

    <form
      class="mt-6 flex max-w-md gap-2"
      @submit.prevent="create"
    >
      <UInput
        v-model="name"
        placeholder="New project name"
        class="flex-1"
      />
      <UButton
        type="submit"
        icon="i-lucide-plus"
        label="Create"
        :loading="creating"
      />
    </form>

    <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <UPageCard
        v-for="project in projects"
        :key="project.id"
        :title="project.name"
        :description="`/${project.slug} · v${project.version} · ${new Date(project.updatedAt).toLocaleString()}`"
        :to="`/editor/${project.id}`"
        icon="i-lucide-app-window"
      />
    </div>
    <p
      v-if="projects && !projects.length"
      class="mt-8 text-sm text-dimmed"
    >
      No projects yet.
    </p>
  </UContainer>
</template>
