<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'
import { SHADES, THEME_COLORS } from '#shared/design/theme'
import { getStyleToken, styleClasses } from '#shared/design/tokens'

/**
 * The theme's token preview sheet, rendered inside a canvas iframe so it
 * carries the project theme: colour shades, the type scale, radii, spacing
 * and a few buttons. Built from the token classes the registry ships.
 */
const TEXT_SIZES = getStyleToken('text')!.values
const RADII = getStyleToken('rounded')!.values.filter(r => r !== 'none')
const SPACINGS = ['1', '2', '4', '6', '8', '12', '16']
</script>

<template>
  <div class="space-y-6 bg-default p-4 text-default">
    <section>
      <h2 class="mb-2 text-xs font-semibold text-muted uppercase">
        Colours
      </h2>
      <div class="space-y-1.5">
        <div
          v-for="color in THEME_COLORS"
          :key="color"
          :data-token-color="color"
        >
          <p class="text-[10px] text-muted">
            {{ color }}
          </p>
          <div class="flex overflow-hidden rounded-sm">
            <div
              v-for="shade in SHADES"
              :key="shade"
              class="h-5 flex-1"
              :class="styleClasses({ bg: `${color}-${shade}` })"
              :title="`${color}-${shade}`"
              :data-token-shade="`${color}-${shade}`"
            />
          </div>
        </div>
      </div>
    </section>

    <section>
      <h2 class="mb-2 text-xs font-semibold text-muted uppercase">
        Buttons
      </h2>
      <div class="flex flex-wrap gap-1.5">
        <template
          v-for="color in THEME_COLORS"
          :key="color"
        >
          <UButton
            :color="color as ButtonProps['color']"
            :label="color"
            size="xs"
          />
          <UButton
            :color="color as ButtonProps['color']"
            :label="color"
            variant="outline"
            size="xs"
          />
        </template>
      </div>
    </section>

    <section>
      <h2 class="mb-2 text-xs font-semibold text-muted uppercase">
        Type
      </h2>
      <div class="space-y-1">
        <div
          v-for="size in TEXT_SIZES"
          :key="size"
          class="flex items-baseline gap-2 overflow-hidden whitespace-nowrap"
        >
          <span class="w-14 shrink-0 font-mono text-[10px] text-dimmed">text-{{ size }}</span>
          <span
            class="text-highlighted"
            :class="styleClasses({ text: size })"
          >Ag Design</span>
        </div>
      </div>
    </section>

    <section>
      <h2 class="mb-2 text-xs font-semibold text-muted uppercase">
        Radius
      </h2>
      <div class="flex flex-wrap gap-2">
        <div
          v-for="radius in RADII"
          :key="radius"
          class="text-center"
        >
          <div
            class="size-10 border-2 border-primary bg-primary-100"
            :class="styleClasses({ rounded: radius })"
          />
          <span class="font-mono text-[10px] text-dimmed">{{ radius }}</span>
        </div>
      </div>
    </section>

    <section>
      <h2 class="mb-2 text-xs font-semibold text-muted uppercase">
        Spacing
      </h2>
      <div class="space-y-1">
        <div
          v-for="space in SPACINGS"
          :key="space"
          class="flex items-center gap-2"
        >
          <span class="w-8 shrink-0 font-mono text-[10px] text-dimmed">{{ space }}</span>
          <div
            class="h-3 rounded-xs bg-primary"
            :class="styleClasses({ pl: space })"
          />
        </div>
      </div>
    </section>
  </div>
</template>
