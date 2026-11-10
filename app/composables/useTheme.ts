import type { Theme } from '#shared/design/theme'
import { resolveThemeColors, themeCss, themeFontHref } from '#shared/design/theme'
import type { EnvValues } from '#shared/env/variables'

/** Finds or creates the head element with `id`; there is only ever one. */
function headElement<K extends 'style' | 'link'>(tag: K, id: string): HTMLElementTagNameMap[K] {
  const existing = document.getElementById(id) as HTMLElementTagNameMap[K] | null
  if (existing) return existing
  const el = document.createElement(tag)
  el.id = id
  document.head.appendChild(el)
  return el
}

/**
 * Applies a project theme to the current document: a `<style id="bildr-theme">`
 * with its CSS variables and the font stylesheet. Written to the DOM before
 * the component renders (not through useHead, which flushes later), so themed
 * nodes never paint, or transition, from the default colours. Colours set to
 * `{{ env.NAME }}` resolve from the public variables `env` (the default
 * colour when missing or not a hex).
 */
export function useTheme(theme: MaybeRefOrGetter<Theme | null | undefined>, env: MaybeRefOrGetter<EnvValues | null | undefined> = {}) {
  if (!import.meta.client) return
  const remove = () => {
    document.getElementById('bildr-theme')?.remove()
    document.getElementById('bildr-theme-font')?.remove()
  }

  watch(() => [toValue(theme), toValue(env)] as const, ([value, vars]) => {
    if (!value) return remove()
    const css = themeCss(resolveThemeColors(value, vars ?? {}))
    const style = headElement('style', 'bildr-theme')
    if (style.textContent !== css) style.textContent = css
    const href = themeFontHref(value)
    if (!href) {
      document.getElementById('bildr-theme-font')?.remove()
      return
    }
    const link = headElement('link', 'bildr-theme-font')
    link.rel = 'stylesheet'
    if (link.getAttribute('href') !== href) link.href = href
  }, { immediate: true, deep: true, flush: 'pre' })

  onScopeDispose(remove)
}
