import { computed, inject, provide } from 'vue'
import type { InjectionKey, Ref } from 'vue'

/**
 * A form that is saving disables the kit's controls inside it: the form provides its flag (`provideDisabled`), and a kit button,
 * field or select that reads it (`useDisabled`) is disabled while the flag is set, besides when its own `disabled` is. It is
 * the component tree that decides, not the DOM, so the controls whose menus are teleported are disabled with the rest.
 */
const KEY: InjectionKey<Readonly<Ref<boolean>>> = Symbol('bildr-form-disabled')

export const provideDisabled = (flag: Readonly<Ref<boolean>>) => provide(KEY, flag)

/** Whether a control is disabled: by its own prop, or by the form it is in. */
export function useDisabled(own: () => boolean | undefined) {
  const inherited = inject(KEY, undefined)
  return computed(() => own() === true || inherited?.value === true)
}
