/**
 * Live preview vs commit (Stacki's live write vs commit split): while a
 * gesture runs, the editor sends the canvas a style patch per node, which the
 * canvas renders over the document without saving it. The commit is one
 * action; its preview stays until the committed render shows the same value,
 * so the canvas never flashes back to the old one.
 *
 * The format-independent part: patches, the preview state, throttling and
 * menu option previews. Applying previews to a document tree is the
 * document's (the hosted `shared/editor/preview.ts`: `previewTree`,
 * `settlePreviews`).
 */

/** Ms between preview messages while a gesture moves (Stacki's scrub writes). */
export const PREVIEW_INTERVAL = 50

/** A style patch with breakpoint-prefixed keys; null removes a key. */
export type StylePatch = Record<string, string | null>

/** `style` with `patch` applied: values override, nulls remove. */
export function applyStylePreview(style: Record<string, string>, patch: StylePatch | null | undefined): Record<string, string> {
  if (!patch) return style
  const merged = Object.entries({ ...style, ...patch }).filter((entry): entry is [string, string] => entry[1] !== null)
  return Object.fromEntries(merged)
}

/** True when `style` already shows every value of `patch`. */
export function showsPatch(style: Record<string, string>, patch: StylePatch): boolean {
  return Object.entries(patch).every(([key, value]) => (value === null ? style[key] === undefined : style[key] === value))
}

/** The preview the editor shows on a canvas node, or on every selected node (`nodeIds`, when several). */
export interface PreviewState {
  nodeId: string
  nodeIds?: string[]
  style: StylePatch
}

function previewState(target: string | string[], style: StylePatch): PreviewState {
  if (typeof target === 'string' || target.length === 1) return { nodeId: typeof target === 'string' ? target : target[0]!, style }
  return { nodeId: target[0]!, nodeIds: target, style }
}

/**
 * The editor's side of preview vs commit. Controls preview while a gesture
 * runs and clear when it ends; a commit shows its own value until its action
 * has run and reloaded, ignoring the clears controls send around a commit
 * (before it on release, after it when a menu closes on its pick).
 */
export function createStylePreview(onChange: (state: PreviewState | null) => void) {
  let commits = 0
  return {
    preview(target: string | string[], style: StylePatch | null): void {
      if (style) onChange(previewState(target, style))
      else if (!commits) onChange(null)
    },
    async commit<T>(target: string | string[], style: StylePatch, run: () => Promise<T>): Promise<T> {
      commits++
      onChange(previewState(target, style))
      try {
        return await run()
      } finally {
        if (--commits === 0) onChange(null)
      }
    }
  }
}

export interface Throttle<T> {
  /** Sends at once when idle; otherwise the latest value goes at the end of the interval. */
  push: (value: T) => void
  /** Sends at once and drops any pending value. */
  flush: (value: T) => void
}

/** At most one `send` per `ms`, always ending with the latest value. */
export function createThrottle<T>(send: (value: T) => void, ms: number): Throttle<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: { value: T } | undefined
  const tick = () => {
    timer = undefined
    if (!pending) return
    const { value } = pending
    pending = undefined
    send(value)
    timer = setTimeout(tick, ms)
  }
  return {
    push(value) {
      if (timer !== undefined) {
        pending = { value }
        return
      }
      send(value)
      timer = setTimeout(tick, ms)
    },
    flush(value) {
      clearTimeout(timer)
      timer = undefined
      pending = undefined
      send(value)
    }
  }
}

/**
 * The option value a focus or pointer event in a menu is on, from the
 * `data-option-value` its item label carries (browser only). Menus focus the
 * item under the pointer and the one the arrow keys reach, so a `focusin` on
 * the menu content tracks both; null when focus is on no option.
 */
export function optionValueAt(target: EventTarget | null): string | null {
  const option = (target as Element | null)?.closest?.('[role="option"], [role="menuitem"], [role="menuitemcheckbox"]')
  return option?.querySelector('[data-option-value]')?.getAttribute('data-option-value') ?? null
}

/**
 * Listeners for a Nuxt UI menu's `content` that preview the focused option.
 * They fall through to the content element, which the `content` prop types
 * do not list, hence the plain `object`.
 */
export function previewFocusedOption(preview: (value: string | null) => void): object {
  return { onFocusin: (event: FocusEvent) => preview(optionValueAt(event.target)) }
}
