import type { Ref } from 'vue'
import type { BreakpointBase } from '#shared/design/tokens'
import { hideFrame, parseFrames, serializeFrames, showFrame } from '#shared/editor/frames'
import type { DeviceId } from '#shared/editor/styleFields'

/** The localStorage key of a project's visible frames. */
export function framesStorageKey(projectId: string): string {
  return `bildr:frames:${projectId}`
}

/**
 * A project's visible device frames, an editor preference kept in
 * localStorage per project (not in the document). The Primary of the
 * project's breakpoint `base` is never hidden; without a stored preference
 * (or with bad data) a project shows its Primary only: Desktop
 * desktop-first, Mobile mobile-first.
 */
export function useEditorFrames(projectId: string, base: Ref<BreakpointBase>) {
  const key = framesStorageKey(projectId)
  const stored = ref<string | null>(import.meta.client ? localStorage.getItem(key) : null)
  const shown = computed<DeviceId[]>(() => parseFrames(stored.value, base.value))

  function save(next: DeviceId[]): void {
    const raw = serializeFrames(next)
    stored.value = raw
    try {
      localStorage.setItem(key, raw)
    } catch {
      // Storage full or blocked: the frames still change for this session.
    }
  }

  return {
    shown,
    show: (id: DeviceId) => save(showFrame(shown.value, id, base.value)),
    hide: (id: DeviceId) => save(hideFrame(shown.value, id, base.value))
  }
}
