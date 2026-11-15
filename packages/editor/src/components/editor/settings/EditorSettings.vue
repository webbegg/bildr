<script setup lang="ts">
import { computed, ref } from 'vue'
import { useToast } from '@nuxt/ui/composables/useToast'
import { FIELD_MONO } from '../../../editorUi.ts'
import { useEditor } from '../../../editor/useEditor.ts'

/**
 * The Settings view: the project's name, the environment variables its data
 * sources read (EditorVariables), and how to connect an agent over MCP. The
 * name saves on blur or Enter (`project_update`).
 *
 * Not in the module, so not here: the slug and what is published (there is no
 * hosted project to publish: the app is the developer's own Nuxt app), WebMCP
 * for published apps, and the Danger zone (the hosted `EditorDangerZone` deletes
 * the project, and the project's folder is the developer's).
 */
const editor = useEditor()
const toast = useToast()

/** The MCP endpoint takes the session token as a header (the cookie alone is not enough), the one in the dev server log. */
const mcpCommand = computed(() => `claude mcp add --transport http bildr ${window.location.origin}/__bildr/mcp --header "x-bildr-token: <token from the dev server log>"`)

// A refused name (blank, or a failed action) puts the saved one back in the field.
const nameField = ref(0)
async function rename(name: string) {
  if (!await editor.renameProject(name)) nameField.value++
}

async function copyCommand() {
  try {
    await navigator.clipboard.writeText(mcpCommand.value)
    toast.add({ title: 'Copied', description: 'Paste it in a terminal, with the token from the dev server log, to connect Claude Code.', icon: 'i-lucide-clipboard-check', color: 'success' })
  } catch {
    toast.add({ title: 'Could not copy the command', description: mcpCommand.value, icon: 'i-lucide-circle-alert', color: 'error' })
  }
}
</script>

<template>
  <div
    class="mx-auto max-w-xl space-y-8 px-6 py-10"
    data-settings
  >
    <h1 class="text-base font-[550] text-highlighted">
      Project settings
    </h1>

    <section class="space-y-2">
      <h2 class="text-[12px] font-[550] text-highlighted">
        General
      </h2>
      <EditorFormRow label="Name">
        <EditorCommitInput
          :key="nameField"
          :model-value="editor.model?.project.name ?? ''"
          data-settings-name
          @commit="rename"
        />
      </EditorFormRow>
    </section>

    <EditorVariables />

    <section class="space-y-2">
      <h2 class="text-[12px] font-[550] text-highlighted">
        Connect an agent (MCP)
      </h2>
      <p class="text-[12px] text-muted">
        Every editor action is an MCP tool. Connect Claude Code to this editor:
      </p>
      <div :class="`${FIELD_MONO} flex items-center gap-2 ps-2.5 pe-0.5`">
        <code
          class="min-w-0 flex-1 truncate text-highlighted"
          :title="mcpCommand"
          data-mcp-command
        >{{ mcpCommand }}</code>
        <EditorButton
          icon="i-lucide-copy"
          variant="ghost"
          size="xs"
          aria-label="Copy command"
          @click="copyCommand"
        />
      </div>
      <p class="text-[12px] text-dimmed">
        The endpoint needs the session token of the dev server log: keep it on your machine.
      </p>
    </section>
  </div>
</template>
