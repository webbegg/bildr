<script setup lang="ts">
import type { ComponentFile } from '@bildr/codegen/model'
import MotionSection from './MotionSection.vue'
import PropertyList from './PropertyList.vue'
import { PROPERTY_KINDS } from './kinds.ts'
import VariantsSection from './VariantsSection.vue'

/** What the inspector shows of the component being edited: its properties, variants and states, interactions and transition. */

defineProps<{ component: ComponentFile }>()
</script>

<template>
  <div
    class="flex flex-col"
    data-testid="component-panel"
  >
    <section class="flex flex-col gap-2 border-b border-default p-3">
      <h3 class="text-xs font-semibold">
        Properties
      </h3>
      <PropertyList
        :owner="{ kind: 'component', id: component.id }"
        :items="component.properties"
        :kinds="PROPERTY_KINDS"
      />
    </section>
    <section class="flex flex-col gap-2 border-b border-default p-3">
      <h3 class="text-xs font-semibold">
        Variants
      </h3>
      <VariantsSection :component="component" />
    </section>
    <section class="flex flex-col gap-2 p-3">
      <h3 class="text-xs font-semibold">
        Motion
      </h3>
      <MotionSection :component="component" />
    </section>
  </div>
</template>
