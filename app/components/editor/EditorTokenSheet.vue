<script setup lang="ts">
import type { BadgeProps, ButtonProps } from '@nuxt/ui'
import { SHADES, spacingBasePx, THEME_COLORS } from '#shared/design/theme'
import type { Theme } from '#shared/design/theme'
import { styleClasses } from '#shared/design/tokens'

/**
 * The Design view's live style guide, rendered inside a canvas iframe so it
 * carries the project theme through the same CSS variables as published
 * apps: the 50–950 shades of each semantic colour, the type scale in the
 * theme font, buttons (each colour solid, soft and outline), an input, a
 * card, badges, the radius scale and spacing at the theme's density.
 */
const { theme = null } = defineProps<{ theme?: Theme | null }>()

const VARIANTS = ['solid', 'soft', 'outline'] as const
const TYPE_SCALE = [
  { name: 'Heading 1', tag: 'h1', classes: 'text-4xl font-bold tracking-tight' },
  { name: 'Heading 2', tag: 'h2', classes: 'text-3xl font-bold tracking-tight' },
  { name: 'Heading 3', tag: 'h3', classes: 'text-2xl font-semibold' },
  { name: 'Heading 4', tag: 'h4', classes: 'text-xl font-semibold' },
  { name: 'Body', tag: 'p', classes: 'text-base' }
]
const RADII = ['sm', 'md', 'lg', 'xl', 'full']
const SPACINGS = ['1', '2', '4', '6', '8', '12', '16']

const label = (name: string) => name[0]!.toUpperCase() + name.slice(1)
const base = computed(() => spacingBasePx(theme?.spacing ?? 'default'))
const px = (n: number) => `${Math.round(n * 10) / 10}px`
</script>

<template>
  <div
    class="space-y-10 bg-default p-8 font-sans text-default"
    data-style-guide
  >
    <section>
      <h2 class="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">
        Colours
      </h2>
      <div class="space-y-3">
        <div
          v-for="color in THEME_COLORS"
          :key="color"
          :data-token-color="color"
        >
          <p class="mb-1 flex items-baseline gap-2 text-sm">
            <span class="font-medium text-highlighted">{{ label(color) }}</span>
            <span class="font-mono text-xs text-dimmed">{{ theme?.colors[color] }}</span>
          </p>
          <div class="grid grid-cols-11 gap-1">
            <div
              v-for="shade in SHADES"
              :key="shade"
              class="min-w-0"
            >
              <div
                class="h-9 rounded-md ring ring-black/5 ring-inset"
                :style="{ background: `var(--ui-color-${color}-${shade})` }"
                :title="`${color}-${shade}`"
                :data-token-shade="`${color}-${shade}`"
              />
              <p class="mt-0.5 text-center font-mono text-[10px] text-dimmed">
                {{ shade }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section>
      <h2 class="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">
        Typography · {{ theme?.font === 'system' ? 'System UI' : theme?.font }}
      </h2>
      <div class="space-y-3">
        <div
          v-for="type in TYPE_SCALE"
          :key="type.name"
          class="flex items-baseline gap-4"
          :data-type-sample="type.tag"
        >
          <span class="w-20 shrink-0 font-mono text-[11px] text-dimmed">{{ type.name }}</span>
          <component
            :is="type.tag"
            class="min-w-0 truncate text-highlighted"
            :class="type.classes"
          >
            {{ type.tag === 'p' ? 'The quick brown fox jumps over the lazy dog.' : 'Build something people love' }}
          </component>
        </div>
      </div>
    </section>

    <section>
      <h2 class="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">
        Buttons
      </h2>
      <div class="space-y-2">
        <div
          v-for="variant in VARIANTS"
          :key="variant"
          class="flex flex-wrap items-center gap-2"
        >
          <span class="w-16 shrink-0 font-mono text-[11px] text-dimmed">{{ variant }}</span>
          <UButton
            v-for="color in THEME_COLORS"
            :key="color"
            :color="color as ButtonProps['color']"
            :variant="variant"
            :label="label(color)"
            size="sm"
            :data-token-button="`${color}-${variant}`"
          />
        </div>
      </div>
    </section>

    <section class="grid gap-6 md:grid-cols-2">
      <div class="space-y-3">
        <h2 class="text-xs font-semibold tracking-wide text-muted uppercase">
          Inputs and badges
        </h2>
        <UFormField
          label="Email"
          help="We never share it."
        >
          <UInput
            placeholder="you@example.com"
            icon="i-lucide-mail"
            class="w-full"
          />
        </UFormField>
        <div class="flex flex-wrap gap-1.5">
          <UBadge
            v-for="color in THEME_COLORS"
            :key="color"
            :color="color as BadgeProps['color']"
            :label="label(color)"
            variant="subtle"
          />
        </div>
        <div class="flex flex-wrap gap-1.5">
          <UBadge
            v-for="color in THEME_COLORS"
            :key="color"
            :color="color as BadgeProps['color']"
            :label="label(color)"
          />
        </div>
      </div>
      <div class="space-y-3">
        <h2 class="text-xs font-semibold tracking-wide text-muted uppercase">
          Card
        </h2>
        <UCard>
          <template #header>
            <p class="font-semibold text-highlighted">
              Starter plan
            </p>
          </template>
          <p class="text-sm text-muted">
            Everything you need to launch, on your own design system.
          </p>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                label="Later"
                color="neutral"
                variant="ghost"
                size="sm"
              />
              <UButton
                label="Choose"
                size="sm"
              />
            </div>
          </template>
        </UCard>
      </div>
    </section>

    <section>
      <h2 class="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">
        Radius · {{ theme?.radius }}
      </h2>
      <div class="flex flex-wrap gap-4">
        <div
          v-for="radius in RADII"
          :key="radius"
          class="text-center"
          :data-token-radius="radius"
        >
          <div
            class="size-14 border-2 border-primary bg-primary/10"
            :class="styleClasses({ rounded: radius })"
          />
          <span class="font-mono text-[11px] text-dimmed">{{ radius }}</span>
        </div>
      </div>
    </section>

    <section>
      <h2 class="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">
        Spacing · {{ theme?.spacing }} ({{ px(base) }} base)
      </h2>
      <div class="space-y-1.5">
        <div
          v-for="space in SPACINGS"
          :key="space"
          class="flex items-center gap-3"
          :data-token-spacing="space"
        >
          <span class="w-24 shrink-0 font-mono text-[11px] text-dimmed">{{ space }} · {{ px(Number(space) * base) }}</span>
          <div
            class="h-3 rounded-xs bg-primary"
            :class="styleClasses({ pl: space })"
          />
        </div>
      </div>
    </section>
  </div>
</template>
