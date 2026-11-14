import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { BreakpointBase } from '@bildr/codegen/design'
import { hideFrame, parseFrames, serializeFrames, showFrame } from '@bildr/editor-core/frames'
import type { DeviceId } from '@bildr/editor-core/styleFields'

/** The localStorage key of the visible frames (one project per editor, so no project id in it). */
export const FRAMES_KEY = 'bildr:frames'

/**
 * The visible device frames, an editor preference kept in localStorage (not in
 * the model; the hosted `useEditorFrames`). The Primary of the project's
 * breakpoint `base` is never hidden; without a stored preference a project
 * shows its Primary only.
 */
export const createFrames = (base: Ref<BreakpointBase> | ComputedRef<BreakpointBase>) => {
  const stored = ref<string | null>(typeof localStorage === 'undefined' ? null : localStorage.getItem(FRAMES_KEY))
  const shown = computed<DeviceId[]>(() => parseFrames(stored.value, base.value))
  const save = (next: DeviceId[]) => {
    const raw = serializeFrames(next)
    stored.value = raw
    try {
      localStorage.setItem(FRAMES_KEY, raw)
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
