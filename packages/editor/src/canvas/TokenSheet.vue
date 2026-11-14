<script setup lang="ts">
import { SHADES, THEME_COLORS, customColorVar } from '@bildr/codegen/design'
import type { Theme } from '@bildr/codegen/design'

/**
 * The token sheet (`bildr:render` with `view: 'tokens'`): what the project's
 * theme gives the design, painted with the theme's own CSS variables so it
 * follows the theme as the page does: each semantic colour's shades, the
 * project's own colours, the corner radius, the spacing unit and the font.
 */

defineProps<{ theme: Theme }>()
const RADII = { sm: 'rounded-sm', md: 'rounded-md', lg: 'rounded-lg', xl: 'rounded-xl' } as const
const STEPS = ['1', '2', '4', '8', '16'] as const
</script>

<template>
  <div
    class="flex flex-col gap-6 p-6"
    data-token-sheet
  >
    <section
      v-for="name in THEME_COLORS"
      :key="name"
      class="flex flex-col gap-1.5"
      :data-token-color="name"
    >
      <h3 class="text-sm font-medium">
        {{ name }} <span class="text-xs font-normal text-muted">{{ theme.colors[name] }}</span>
      </h3>
      <div class="grid grid-cols-11 gap-1">
        <div
          v-for="shade in SHADES"
          :key="shade"
          class="flex h-12 items-end rounded-sm p-0.5 text-[10px] text-white mix-blend-normal"
          :style="{ backgroundColor: `var(--ui-color-${name}-${shade})` }"
          :data-shade="shade"
        >
          <span class="rounded-sm bg-black/30 px-0.5">{{ shade }}</span>
        </div>
      </div>
    </section>

    <section
      v-if="Object.keys(theme.custom ?? {}).length"
      class="flex flex-col gap-1.5"
    >
      <h3 class="text-sm font-medium">
        Your colors
      </h3>
      <div class="flex flex-wrap gap-2">
        <div
          v-for="(value, name) in theme.custom"
          :key="name"
          class="flex flex-col gap-1 text-xs"
        >
          <div
            class="h-12 w-20 rounded-md ring ring-default"
            :style="{ backgroundColor: `var(${customColorVar(String(name))})` }"
            :data-token-custom="name"
          />
          {{ name }} <span class="text-muted">{{ value }}</span>
        </div>
      </div>
    </section>

    <section
      class="flex flex-col gap-1.5"
      data-token-radius
    >
      <h3 class="text-sm font-medium">
        Radius <span class="text-xs font-normal text-muted">{{ theme.radius }}</span>
      </h3>
      <div class="flex gap-3">
        <div
          v-for="(rounded, size) in RADII"
          :key="size"
          class="flex h-16 w-24 items-center justify-center bg-primary text-xs text-inverted"
          :class="rounded"
        >
          {{ size }}
        </div>
      </div>
    </section>

    <section
      class="flex flex-col gap-1.5"
      data-token-spacing
    >
      <h3 class="text-sm font-medium">
        Spacing <span class="text-xs font-normal text-muted">{{ theme.spacing }}</span>
      </h3>
      <div class="flex items-end gap-3">
        <div
          v-for="step in STEPS"
          :key="step"
          class="flex flex-col items-center gap-1 text-xs"
        >
          <div
            class="bg-primary"
            :style="{ width: `calc(var(--spacing) * ${step})`, height: `calc(var(--spacing) * ${step})` }"
          />
          {{ step }}
        </div>
      </div>
    </section>

    <section
      class="flex flex-col gap-1.5"
      data-token-font
    >
      <h3 class="text-sm font-medium">
        Font <span class="text-xs font-normal text-muted">{{ theme.font }}</span>
      </h3>
      <p class="text-2xl font-semibold">
        The quick brown fox jumps over the lazy dog
      </p>
      <p class="text-sm">
        Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kk Ll Mm Nn Oo Pp Qq Rr Ss Tt Uu Vv Ww Xx Yy Zz 0123456789
      </p>
    </section>
  </div>
</template>
