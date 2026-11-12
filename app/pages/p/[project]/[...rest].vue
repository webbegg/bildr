<script setup lang="ts">
/**
 * A published app's path with more segments than `<page>/<key>`
 * (`/p/<site>/<page>/<key>/extra`): the app's not-found state, as for an
 * unknown page or key, instead of Nuxt's generic 404. Paths of up to two
 * segments are `[[page]]/[[record]].vue`'s, which the router prefers.
 */
definePageMeta({ layout: false })
useHead({ title: 'Not found' })
</script>

<template>
  <UError :error="{ statusCode: 404, statusMessage: 'Page not found' }" />
</template>
