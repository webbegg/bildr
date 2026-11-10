<script setup lang="ts">
/**
 * Deleting a project (`project_delete`): the Settings "Danger zone" section,
 * or with `section` off just its confirm modal (the projects list opens it
 * through `open`). The delete button stays disabled until the slug is typed;
 * emits `deleted` once the project is gone.
 */
const props = withDefaults(defineProps<{
  project: { id: string, name: string, slug: string }
  section?: boolean
}>(), { section: true })
const emit = defineEmits<{ deleted: [] }>()
const open = defineModel<boolean>('open', { default: false })
const toast = useToast()

const typed = ref('')
const deleting = ref(false)
const matches = computed(() => typed.value === props.project.slug)

watch(open, (value) => {
  if (value) typed.value = ''
})

async function remove() {
  if (!matches.value) return
  deleting.value = true
  try {
    await callAction('project_delete', { projectId: props.project.id, confirm: typed.value })
    open.value = false
    toast.add({ title: 'Project deleted', description: props.project.name, icon: 'i-lucide-trash-2' })
    emit('deleted')
  } catch (error) {
    toast.add({ title: 'Could not delete the project', description: actionErrorMessage(error), color: 'error' })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <section
    v-if="section"
    class="space-y-2"
    data-danger-zone
  >
    <h2 class="text-xs font-semibold text-error uppercase">
      Danger zone
    </h2>
    <div class="flex items-center gap-3 rounded-md px-3 py-2 ring ring-error/40">
      <p class="min-w-0 flex-1 text-sm text-muted">
        Delete the project, its data and the published app. This cannot be undone.
      </p>
      <UButton
        label="Delete this project"
        icon="i-lucide-trash-2"
        color="error"
        variant="soft"
        size="sm"
        data-delete-project
        @click="open = true"
      />
    </div>
  </section>

  <UModal
    v-model:open="open"
    :title="`Delete ${project.name}?`"
    description="This cannot be undone."
  >
    <template #body>
      <form
        class="space-y-4"
        data-delete-project-confirm
        @submit.prevent="remove"
      >
        <p class="text-sm text-muted">
          This deletes the project's pages, its data (collections and records), its environment variables and the published app at /p/{{ project.slug }}.
        </p>
        <UFormField
          :label="`Type ${project.slug} to confirm`"
          size="sm"
        >
          <UInput
            v-model="typed"
            :placeholder="project.slug"
            autocomplete="off"
            class="w-full"
            autofocus
            data-delete-project-slug
          />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="open = false"
          />
          <UButton
            type="submit"
            label="Delete project"
            color="error"
            :disabled="!matches"
            :loading="deleting"
            data-delete-project-submit
          />
        </div>
      </form>
    </template>
  </UModal>
</template>
