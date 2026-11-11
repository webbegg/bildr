<script setup lang="ts">
/**
 * A labelled control for modals and settings: inline puts the 13 px muted
 * label in a 120 px column (the inspector's EditorRow uses 88 px), `stacked`
 * puts a 12 px label above. `help` sits under the control; an `error`
 * replaces it. `for` ties the label to the control's id.
 */
defineProps<{ label: string, help?: string, error?: string, stacked?: boolean, for?: string }>()
</script>

<template>
  <div
    :class="stacked ? 'flex flex-col gap-1.5' : 'grid grid-cols-[120px_minmax(0,1fr)] items-start gap-x-3'"
    :data-form-row="label"
  >
    <label
      :for="$props.for"
      :class="stacked ? 'text-[12px] text-muted' : 'flex h-[30px] min-w-0 items-center truncate text-[12px] text-muted'"
    >{{ label }}</label>
    <div class="min-w-0">
      <div class="flex min-h-[30px] min-w-0 items-center gap-2">
        <slot />
      </div>
      <p
        v-if="error"
        class="mt-1 text-[12px] leading-4 text-error"
        role="alert"
      >
        {{ error }}
      </p>
      <p
        v-else-if="help"
        class="mt-1 text-[12px] leading-4 text-dimmed"
      >
        {{ help }}
      </p>
    </div>
  </div>
</template>
