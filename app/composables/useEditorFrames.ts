import { DEFAULT_FRAMES, hideFrame, parseFrames, serializeFrames, showFrame } from '#shared/editor/frames'
import type { DeviceId } from '#shared/editor/styleFields'

/** The localStorage key of a project's visible frames. */
export function framesStorageKey(projectId: string): string {
  return `bildr:frames:${projectId}`
}

/**
 * A project's visible device frames, an editor preference kept in
 * localStorage per project (not in the document). The Primary is never
 * hidden; bad stored data falls back to the defaults.
 */
export function useEditorFrames(projectId: string) {
  const key = framesStorageKey(projectId)
  const shown = ref<DeviceId[]>(import.meta.client ? parseFrames(localStorage.getItem(key)) : [...DEFAULT_FRAMES])

  function save(next: DeviceId[]): void {
    shown.value = next
    try {
      localStorage.setItem(key, serializeFrames(next))
    } catch {
      // Storage full or blocked: the frames still change for this session.
    }
  }

  return {
    shown: readonly(shown),
    show: (id: DeviceId) => save(showFrame(shown.value, id)),
    hide: (id: DeviceId) => save(hideFrame(shown.value, id))
  }
}
