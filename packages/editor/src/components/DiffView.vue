<script setup lang="ts">
import { computed } from 'vue'

/** A unified diff (generated → disk) with added and removed lines coloured. */
const props = defineProps<{ diff: string }>()

type LineKind = 'add' | 'del' | 'hunk' | 'meta' | 'ctx'

const kindOf = (line: string): LineKind => {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('\\')) return 'meta'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'ctx'
}

const CLASSES: Record<LineKind, string> = {
  add: 'bg-success/10 text-success',
  del: 'bg-error/10 text-error',
  hunk: 'text-info',
  meta: 'text-muted',
  ctx: 'text-default'
}

const lines = computed(() => props.diff.replace(/\n$/, '').split('\n').map(text => ({ text, kind: kindOf(text) })))
</script>

<template>
  <pre
    data-testid="diff"
    class="overflow-auto rounded-md border border-default bg-elevated/50 p-3 font-mono text-xs leading-5"
  ><div
    v-for="(line, index) in lines"
    :key="index"
    :data-line="line.kind"
    :class="CLASSES[line.kind]"
    class="px-1 whitespace-pre"
  >{{ line.text }}</div></pre>
</template>
