<script setup lang="ts">
import type { ResolvedRequest } from '../../editor/tryRequest.ts'

/**
 * The request Try it will send (api-calls T1, S5), before it is: the method and the full URL, the headers (the sign-in as `••••`: its
 * secret comes from the env on the server and is never in the editor), and the body. A path parameter with no value yet stays `:name` in
 * the URL, and is named under it.
 */
const { request } = defineProps<{ request: ResolvedRequest }>()
</script>

<template>
  <div
    class="space-y-2 rounded-lg border border-default px-3 py-2.5"
    data-try-request
  >
    <p class="flex min-w-0 items-start gap-2">
      <span
        class="shrink-0 rounded-md bg-white/6 px-1.5 py-0.5 font-mono text-[11px] font-[550] text-highlighted"
        data-try-request-method
      >{{ request.method }}</span>
      <code
        class="min-w-0 pt-0.5 font-mono text-[11px] leading-4 break-all text-toned"
        data-try-request-url
      >{{ request.url }}</code>
    </p>
    <p
      v-if="request.missing.length"
      class="text-[12px] leading-4 text-warning"
      data-try-request-missing
    >
      Needs a value for {{ request.missing.map(name => `“${name}”`).join(', ') }}.
    </p>
    <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-[11px] leading-4">
      <template
        v-for="header in request.headers"
        :key="header.name"
      >
        <dt class="text-dimmed">
          {{ header.name }}
        </dt>
        <dd
          class="min-w-0 truncate"
          :class="header.masked ? 'text-muted' : 'text-toned'"
          :data-try-request-header="header.name"
        >
          {{ header.value }}
        </dd>
      </template>
    </dl>
    <p
      v-if="request.signIn !== 'none'"
      class="text-[12px] leading-4 text-dimmed"
      data-try-request-signin
    >
      <template v-if="request.signIn === 'sent'">
        The sign-in's secret is added on the server, from the env. It never reaches the editor.
      </template>
      <template v-else>
        Sent without the sign-in: the visitor's browser calls this API, and it has no secret there.
      </template>
    </p>
    <pre
      v-if="request.body !== undefined"
      class="max-h-40 overflow-auto rounded-md bg-black/20 p-2 font-mono text-[11px] leading-4 text-toned"
      data-try-request-body
    >{{ request.body }}</pre>
  </div>
</template>
