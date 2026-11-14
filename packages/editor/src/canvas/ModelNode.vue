<script lang="ts">
import { defineComponent, h } from 'vue'
import type { Component, PropType, VNode } from 'vue'
import UButton from '@nuxt/ui/components/Button.vue'
import UCheckbox from '@nuxt/ui/components/Checkbox.vue'
import UFormField from '@nuxt/ui/components/FormField.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import ULink from '@nuxt/ui/components/Link.vue'
import UTextarea from '@nuxt/ui/components/Textarea.vue'
import type { PlanChild, PlanElement } from './render.ts'

/**
 * Renders one element of the canvas render plan (`render.ts`) and its
 * children: an HTML tag, or the Nuxt UI component the generated app uses
 * (D11), with the plan's classes, inline style and attributes, plus the
 * canvas's `data-node` mapping (`data-node-type`, `data-copy` on List
 * repetitions, `data-placeholder` on stand-ins for missing data). Gestures
 * are the canvas runtime's (`CanvasApp.vue`), delegated from the document.
 */
const COMPONENTS: Record<string, Component> = { UButton, UCheckbox, UFormField, UIcon, UInput, ULink, UTextarea }

const renderChild = (child: PlanChild): VNode | string => typeof child === 'string' ? child : h(ModelNode, { element: child, key: undefined })

const ModelNode = defineComponent({
  name: 'ModelNode',
  props: {
    element: { type: Object as PropType<PlanElement>, required: true }
  },
  setup(props) {
    return () => {
      const element = props.element
      const attrs = {
        ...element.attrs,
        'class': element.class || undefined,
        'style': element.style,
        'data-node': element.node,
        'data-node-type': element.node ? element.type : undefined,
        'data-copy': element.copy ? '' : undefined,
        'data-placeholder': element.placeholder ? '' : undefined
      }
      const component = COMPONENTS[element.tag]
      if (!component) return h(element.tag, attrs, element.children.map(renderChild))
      // Nuxt UI components take their content in the default slot (a Link's icon and text, a field's control).
      return element.children.length
        ? h(component, attrs, { default: () => element.children.map(renderChild) })
        : h(component, attrs)
    }
  }
})

export default ModelNode
</script>
