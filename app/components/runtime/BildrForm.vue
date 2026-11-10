<script setup lang="ts">
import type { DocNode } from '#shared/document/schema'
import { formValues } from '#shared/runtime/form'
import { resolveLink } from '#shared/runtime/render'

/**
 * A Form node: a real `<form>` whose submit sends its Inputs' values (named by
 * their `field`) through the runtime's `submitForm`, then shows the success
 * toast and resets or navigates. In the canvas it never submits.
 */
const props = defineProps<{ node: DocNode }>()
const runtime = useRuntime()
const scope = useListItem()
const toast = useToast()
const sending = ref(false)

const text = (name: string) => bindValue(String(props.node.props[name] ?? ''), runtime, scope?.item)

async function onSubmit(event: Event) {
  const form = event.currentTarget as HTMLFormElement
  const collection = text('collection')
  if (runtime.editable || !runtime.submitForm || !collection || sending.value) return
  sending.value = true
  try {
    await runtime.submitForm(collection, formValues(new FormData(form)))
  } catch (error) {
    toast.add({ title: error instanceof Error ? error.message : 'Could not send the form', color: 'error', icon: 'i-lucide-circle-alert' })
    return
  } finally {
    sending.value = false
  }
  toast.add({ title: text('successMessage') || 'Thanks!', color: 'success', icon: 'i-lucide-check' })
  const link = resolveLink(text('redirectTo'), runtime.base)
  if (link?.external) window.location.assign(link.to)
  else if (link) await navigateTo(link.to)
  else if (props.node.props.resetOnSuccess !== false) form.reset()
}
</script>

<template>
  <form
    :aria-busy="sending || undefined"
    @submit.prevent="onSubmit"
  >
    <slot />
  </form>
</template>
