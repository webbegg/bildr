<script setup lang="ts">
import { computed } from 'vue'
import type { FileState } from '../types.ts'

/** Who owns a generated file now (decision D1). */
const props = defineProps<{ state: FileState }>()

type Color = 'primary' | 'neutral' | 'warning' | 'error' | 'info' | 'success'

const COLORS: Record<string, Color> = {
  managed: 'success',
  scaffold: 'info',
  detached: 'warning',
  deleted: 'error',
  orphaned: 'neutral',
  pending: 'neutral'
}

const color = computed<Color>(() => COLORS[props.state] ?? 'neutral')
</script>

<template>
  <UBadge
    data-testid="state"
    :color="color"
    variant="subtle"
    size="sm"
    :label="state"
  />
</template>
