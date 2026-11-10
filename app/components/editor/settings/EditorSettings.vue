<script setup lang="ts">
/**
 * The Settings view: the project's name and slug, what is published, its
 * environment variables (EditorVariables), how to connect an agent over MCP, and the
 * Danger zone (EditorDangerZone, which deletes the project). The name saves on blur or Enter
 * (`project_rename`); the slug is read-only, so published URLs never change.
 * Shares the published info with the top bar
 * (same async data key), so a publish there shows here too.
 */
const editor = useEditor()
const toast = useToast()

const { data: published } = useAsyncData(
  `published-${editor.projectId}`,
  () => callAction<{ url: string, version: number, publishedAt: string } | null>('project_published_info', { projectId: editor.projectId })
)

const mcpCommand = computed(() => `claude mcp add --transport http bildr ${window.location.origin}/mcp`)
const publishedAt = computed(() => (published.value ? new Date(published.value.publishedAt).toLocaleString() : ''))

// A refused name (blank, or a failed action) puts the saved one back in the field.
const nameField = ref(0)
async function rename(name: string) {
  if (!await editor.renameProject(name)) nameField.value++
}

async function copyCommand() {
  await navigator.clipboard.writeText(mcpCommand.value)
  toast.add({ title: 'Copied', description: 'Paste it in a terminal to connect Claude Code.', icon: 'i-lucide-clipboard-check', color: 'success' })
}
</script>

<template>
  <div
    class="mx-auto max-w-xl space-y-8 px-6 py-10"
    data-settings
  >
    <h1 class="text-lg font-semibold text-highlighted">
      Project settings
    </h1>

    <section class="space-y-3">
      <h2 class="text-xs font-semibold text-muted uppercase">
        General
      </h2>
      <UFormField
        label="Name"
        size="sm"
      >
        <EditorCommitInput
          :key="nameField"
          :model-value="editor.project?.name ?? ''"
          data-settings-name
          @commit="rename"
        />
      </UFormField>
      <UFormField
        label="Slug"
        size="sm"
        :help="`Published at /p/${editor.project?.slug}. Renaming the project keeps the slug, so published links keep working.`"
      >
        <UInput
          :model-value="editor.project?.slug"
          size="sm"
          class="w-full"
          readonly
        />
      </UFormField>
    </section>

    <section class="space-y-2">
      <h2 class="text-xs font-semibold text-muted uppercase">
        Publishing
      </h2>
      <div
        v-if="published"
        class="flex items-center gap-3 text-sm"
        data-settings-published
      >
        <UIcon
          name="i-lucide-rocket"
          class="size-4 text-success"
        />
        <span>Version {{ published.version }}, published {{ publishedAt }}</span>
        <UButton
          :to="published.url"
          target="_blank"
          :label="published.url"
          trailing-icon="i-lucide-external-link"
          color="neutral"
          variant="link"
          size="sm"
          class="ms-auto"
        />
      </div>
      <p
        v-else
        class="text-sm text-muted"
      >
        Not published yet. Publish from the top bar to serve the app at /p/{{ editor.project?.slug }}.
      </p>
    </section>

    <EditorVariables />

    <section class="space-y-2">
      <h2 class="text-xs font-semibold text-muted uppercase">
        Connect an agent (MCP)
      </h2>
      <p class="text-sm text-muted">
        Every editor action is an MCP tool. Connect Claude Code to this editor:
      </p>
      <div class="flex items-center gap-2 rounded-md bg-muted px-3 py-2 ring ring-default">
        <code
          class="min-w-0 flex-1 truncate font-mono text-xs text-highlighted"
          data-mcp-command
        >{{ mcpCommand }}</code>
        <UButton
          icon="i-lucide-copy"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Copy command"
          @click="copyCommand"
        />
      </div>
      <p class="text-xs text-dimmed">
        The endpoint has no authentication: keep it on your machine.
      </p>
    </section>

    <section class="space-y-2">
      <h2 class="text-xs font-semibold text-muted uppercase">
        WebMCP
      </h2>
      <p class="text-sm text-muted">
        Published apps register WebMCP tools for agents in the visitor's browser: list_pages, navigate_to_page and get_page_content, plus list_records and submit_form for public collections. Browsers without WebMCP ignore them.
      </p>
    </section>

    <EditorDangerZone
      v-if="editor.project"
      :project="editor.project"
      @deleted="navigateTo('/')"
    />
  </div>
</template>
