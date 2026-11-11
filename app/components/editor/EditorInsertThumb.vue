<script setup lang="ts">
import type { CanvasToEditor, EditorToCanvas } from '#shared/editor/protocol'
import { isCanvasMessage } from '#shared/editor/protocol'
import type { ThumbnailKind } from '#shared/editor/thumbnails'
import { thumbnailFit, thumbnailRenderSlot, thumbnailSignature, thumbnailSnapshots, thumbnailSource } from '#shared/editor/thumbnails'

/** The canvas document as static HTML: its styles and rendered DOM, without scripts. */
function snapshotHtml(doc: Document): string {
  const clone = doc.documentElement.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script, link[rel="modulepreload"], link[as="script"]').forEach(el => el.remove())
  return `<!DOCTYPE html>${clone.outerHTML}`
}

/**
 * An Insert tile's thumbnail: a small static render of a component
 * definition (its primary) or a layout, made by the canvas renderer (a
 * `/canvas` iframe at the Mobile or Desktop width) and scaled to fit. Lazy:
 * it renders once the tile scrolls into view, two at a time
 * (`thumbnailRenderSlot`). Cached: the rendered document is kept as static
 * HTML (`thumbnailSnapshots`, for the editor session) under a signature of
 * what it shows (`thumbnailSignature`), so a reopened panel shows it at once and a
 * change to the tree, the components it uses, the theme or the dark
 * preview renders it again.
 */
const props = defineProps<{ kind: ThumbnailKind, id: string }>()
const editor = useEditor()
const TILE = { width: 104, height: 60 }
const LIVE_HEIGHT = 800

const root = useTemplateRef<HTMLDivElement>('root')
const liveFrame = useTemplateRef<HTMLIFrameElement>('liveFrame')
const seen = ref(false)
const failed = ref(false)

const source = computed(() => (editor.project ? thumbnailSource(editor.project, props.kind, props.id) : null))
const signature = computed(() => (source.value && editor.theme ? thumbnailSignature(source.value, editor.theme, editor.previewDark) : null))
/** Bumped when this tile stores a snapshot (the cache itself is not reactive). */
const stored = ref(0)
const snapshot = computed(() => {
  void stored.value
  return signature.value ? thumbnailSnapshots.get(signature.value) ?? null : null
})
const fit = computed(() => (snapshot.value ? thumbnailFit(snapshot.value.box, TILE) : null))
/** Renders live only while visible, without a snapshot for what it shows now, and with a free slot. */
const rendering = ref<string | null>(null)
let release: (() => void) | null = null
let alive = true

function post(message: EditorToCanvas) {
  liveFrame.value?.contentWindow?.postMessage(JSON.parse(JSON.stringify(message)), window.location.origin)
}

let settle: ReturnType<typeof setTimeout> | undefined
let giveUp: ReturnType<typeof setTimeout> | undefined
const MEASURE_ID = 1

function finish() {
  clearTimeout(settle)
  clearTimeout(giveUp)
  rendering.value = null
  release?.()
  release = null
}

function onMessage(event: MessageEvent) {
  const frame = liveFrame.value
  if (!frame || event.source !== frame.contentWindow || !isCanvasMessage<CanvasToEditor>(event.data)) return
  const message = event.data
  const shown = source.value
  if (!shown || !editor.project || !editor.theme) return
  if (message.type === 'bildr:ready') {
    post({ type: 'bildr:render', page: shown.page, base: `/p/${editor.project.slug}`, theme: editor.theme, view: 'page', lists: {}, env: editor.publicEnv, components: shown.components, layouts: [] })
    post({ type: 'bildr:dark', dark: editor.previewDark })
    post({ type: 'bildr:select', nodeId: null, nodeIds: [] })
  } else if (message.type === 'bildr:size') {
    // Measures once the render has settled (images and fonts may still grow it).
    clearTimeout(settle)
    settle = setTimeout(() => post({ type: 'bildr:measure', requestId: MEASURE_ID, nodeIds: [shown.measureId] }), 150)
  } else if (message.type === 'bildr:rects' && message.requestId === MEASURE_ID) {
    const box = message.rects[0]
    const doc = frame.contentDocument
    const key = rendering.value
    if (box && doc && key) {
      thumbnailSnapshots.set(key, { html: snapshotHtml(doc), box, width: shown.width })
      stored.value++
    } else {
      failed.value = true
    }
    finish()
  }
}

async function renderLive(key: string) {
  if (rendering.value === key) return
  finish()
  const done = await thumbnailRenderSlot()
  // Still wanted: visible, and nothing rendered it meanwhile.
  if (!alive || signature.value !== key || snapshot.value) return done()
  release = done
  failed.value = false
  rendering.value = key
  giveUp = setTimeout(() => {
    failed.value = true
    finish()
  }, 15000)
}

watch([seen, signature, snapshot], ([visible, key, shot]) => {
  if (visible && key && !shot) void renderLive(key)
}, { immediate: true })

let observer: IntersectionObserver | null = null
onMounted(() => {
  window.addEventListener('message', onMessage)
  observer = new IntersectionObserver(([entry]) => {
    if (entry?.isIntersecting) seen.value = true
  })
  if (root.value) observer.observe(root.value)
})
onBeforeUnmount(() => {
  alive = false
  window.removeEventListener('message', onMessage)
  observer?.disconnect()
  finish()
})
</script>

<template>
  <div
    ref="root"
    class="relative overflow-hidden rounded-md bg-white"
    :style="{ width: `${TILE.width}px`, height: `${TILE.height}px` }"
    :data-insert-thumb="snapshot ? 'ready' : failed ? 'failed' : 'loading'"
    aria-hidden="true"
  >
    <iframe
      v-if="snapshot && fit"
      :srcdoc="snapshot.html"
      :width="snapshot.width"
      :height="Math.ceil(snapshot.box.y + snapshot.box.height)"
      tabindex="-1"
      scrolling="no"
      title=""
      class="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
      :style="{ transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})` }"
    />
    <template v-else>
      <iframe
        v-if="rendering && source"
        ref="liveFrame"
        :key="rendering"
        src="/canvas"
        :width="source.width"
        :height="LIVE_HEIGHT"
        tabindex="-1"
        title=""
        class="pointer-events-none absolute top-0 left-0 border-0 opacity-0"
      />
      <div class="absolute inset-0 flex items-center justify-center bg-elevated">
        <UIcon
          :name="kind === 'layout' ? 'i-lucide-layout-template' : 'i-lucide-component'"
          class="size-5 text-(--editor-component)"
          :class="{ 'animate-pulse': !failed }"
        />
      </div>
    </template>
  </div>
</template>
