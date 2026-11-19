import { pascal } from '../generate/text.ts'

/**
 * Names that the generated code (or the toolchain it runs on) already takes, so a query, an action, a state or a page's use can't
 * be called them (D10a for queries and actions, B1 for states and the names a page's script declares). Each list is in one place,
 * said to be what it is: add to them when the generator or the toolchain gains a name.
 *
 * - The identifiers the generated files declare at their top (`DECLARED_IN_TESTS`, `COMPOSABLES_THE_GENERATOR_IMPORTS`):
 *   read from generate/actions.ts (the use-case test) and generate/client.ts (the composables). The drift guard in
 *   test/edit/d10a-verify-names.test.ts generates a project and fails when a file declares one that isn't listed.
 * - The composables the app already has (`AUTO_IMPORTED`): a query, an action or a state generates a `use…` composable, and
 *   Nuxt auto-imports a composable by its name, so one name given twice is silently dropped from .nuxt/imports.d.ts.
 *   The ones of Nuxt, Vue and Nuxt UI win, so the generated one is never the one a page gets.
 * - The functions Vue and Nuxt auto-import into every page's script (`AUTO_IMPORTED_FUNCTIONS`): a state or a use named like one
 *   would shadow it (`autoImportedNameProblem`).
 */

/**
 * What the generated use-case test of an action declares in its own scope (generate/actions.ts, useCaseTestFile): the
 * three it imports from vitest, and the `input` and `result` it declares. The use-case is imported under the action's
 * name, so an action can't be named like any of them. (The memory adapters, seeds and repositories it also names are
 * derived from the model: see generated-names.ts.)
 */
const DECLARED_IN_TESTS = ['describe', 'expect', 'it', 'input', 'result']

/**
 * The composables a generated composable file imports from a package (generate/client.ts and generate/actions.ts):
 * the query's `useLiveQuery` from @tanstack/vue-db. A query or an action named `liveQuery` would declare it too.
 */
const COMPOSABLES_THE_GENERATOR_IMPORTS = ['useLiveQuery']

/**
 * THE AUTO-IMPORT SET: the composables Nuxt, Vue, Nuxt UI and the modules the generated app enables auto-import, so
 * `use<Name>` can't be one of them. Taken from a generated project's .nuxt/imports.d.ts (fixtures/codegen/blog).
 * Keyed by who provides them, for the message.
 */
const AUTO_IMPORTED: Record<string, string[]> = {
  'Nuxt': [
    'useAnnouncer', 'useAppConfig', 'useAsyncData', 'useCookie', 'useError', 'useFetch', 'useHead', 'useHeadSafe', 'useHydration', 'useLayout',
    'useLazyAsyncData', 'useLazyFetch', 'useLoadingIndicator', 'useNuxtApp', 'useNuxtData', 'useNuxtDevTools', 'usePreviewMode', 'useRequestEvent', 'useRequestFetch',
    'useRequestHeader', 'useRequestHeaders', 'useRequestURL', 'useResponseHeader', 'useRoute', 'useRouteAnnouncer', 'useRouter', 'useRuntimeConfig',
    'useRuntimeHook', 'useSeoMeta', 'useServerHead', 'useServerHeadSafe', 'useServerSeoMeta', 'useState'
  ],
  'Vue': ['useAttrs', 'useCssModule', 'useCssVars', 'useId', 'useModel', 'useShadowRoot', 'useSlots', 'useTemplateRef', 'useTransitionState'],
  'vue-router': ['useLink'],
  'Nuxt UI': [
    'useContentSearch', 'useFileUpload', 'useFormField', 'useKbd', 'useOverlay', 'useResizable', 'useScrollShadow', 'useScrollspy', 'useTheme', 'useToast', 'useTour'
  ],
  '@nuxtjs/color-mode': ['useColorMode'],
  // Every useScript<Service> too: see AUTO_IMPORTED_PREFIXES.
  'Nuxt Scripts': ['useScript'],
  // The project's core layer (layers/core/app/composables).
  'the core layer': ['useVariantState']
}

/** Families of composables that share a prefix: Nuxt Scripts has one per service (useScriptGoogleAnalytics, …). */
const AUTO_IMPORTED_PREFIXES: Record<string, string> = { useScript: 'Nuxt Scripts' }

/** Who auto-imports `composable`, when anyone does. */
const providerOf = (composable: string): string | undefined => {
  for (const [provider, names] of Object.entries(AUTO_IMPORTED)) if (names.includes(composable)) return provider
  for (const [prefix, provider] of Object.entries(AUTO_IMPORTED_PREFIXES)) if (composable.startsWith(prefix) && /^[A-Z]/.test(composable.slice(prefix.length))) return provider
  return undefined
}

/**
 * The functions (not composables) Vue and Nuxt auto-import into every page and component script, so the generated script uses them
 * by name (`computed`, `ref`, `reactive`, `navigateTo`, `definePageMeta`…). A name of a state or a page's use that is one of them
 * would shadow it in the script, or in the composable. The composables are in `AUTO_IMPORTED`.
 */
const AUTO_IMPORTED_FUNCTIONS: Record<string, string[]> = {
  Vue: [
    'computed', 'customRef', 'defineAsyncComponent', 'defineComponent', 'defineEmits', 'defineExpose', 'defineModel', 'defineProps', 'defineSlots', 'effectScope', 'getCurrentInstance',
    'getCurrentScope', 'h', 'inject', 'isProxy', 'isReactive', 'isReadonly', 'isRef', 'markRaw', 'nextTick', 'onActivated', 'onBeforeMount', 'onBeforeUnmount', 'onBeforeUpdate',
    'onDeactivated', 'onErrorCaptured', 'onMounted', 'onScopeDispose', 'onServerPrefetch', 'onUnmounted', 'onUpdated', 'provide', 'reactive', 'readonly', 'ref', 'resolveComponent',
    'shallowReactive', 'shallowReadonly', 'shallowRef', 'toRaw', 'toRef', 'toRefs', 'toValue', 'triggerRef', 'unref', 'watch', 'watchEffect', 'watchPostEffect', 'watchSyncEffect', 'withDefaults'
  ],
  Nuxt: [
    'abortNavigation', 'addRouteMiddleware', 'callOnce', 'clearError', 'clearNuxtData', 'clearNuxtState', 'createError', 'defineNuxtComponent', 'defineNuxtPlugin', 'defineNuxtRouteMiddleware',
    'definePageMeta', 'defineRouteRules', 'isNuxtError', 'isPrerendered', 'loadPayload', 'navigateTo', 'onBeforeRouteLeave', 'onBeforeRouteUpdate', 'onNuxtReady', 'prefetchComponents',
    'preloadComponents', 'preloadRouteComponents', 'refreshCookie', 'refreshNuxtData', 'reloadNuxtApp', 'setPageLayout', 'setResponseStatus', 'showError', 'updateAppConfig'
  ]
}

/** Every function Vue and Nuxt auto-import into a page's script, by name: what the editor leaves out when it offers a name. */
export const AUTO_IMPORTED_FUNCTION_NAMES: readonly string[] = Object.values(AUTO_IMPORTED_FUNCTIONS).flat()

/** Why a state or a page use can't be called `name` (it is an auto-imported function or composable the generated code uses), or undefined. */
export const autoImportedNameProblem = (name: string): string | undefined => {
  const provider = providerOf(name) ?? Object.entries(AUTO_IMPORTED_FUNCTIONS).find(([, names]) => names.includes(name))?.[0]
  return provider ? `"${name}" is something ${provider} provides to every page (the generated code uses it): pick another name` : undefined
}

/**
 * Why `composable`, the one that `name` (what the user typed) would generate, can't be generated, or undefined when it can. A query or
 * an action generates `use<Name>` (`composableNameProblem`); a state generates `use<Module><Name>`.
 */
export const composableProblem = (composable: string, name: string): string | undefined => {
  const provider = providerOf(composable)
  if (provider) return `\`${name}\` would generate ${composable}, which ${provider} already provides: pick another name`
  if (COMPOSABLES_THE_GENERATOR_IMPORTS.includes(composable)) return `\`${name}\` would generate ${composable}, which the generated query composables already import from @tanstack/vue-db: pick another name`
  return undefined
}

/** Why the composable `use<Name>` of a query or an action called `name` can't be generated, or undefined when it can. */
export const composableNameProblem = (name: string): string | undefined => composableProblem(`use${pascal(name)}`, name)

/** Why an action called `name` can't be generated (its use-case is imported under that name into the generated test), or undefined. */
export const declaredNameProblem = (name: string): string | undefined =>
  DECLARED_IN_TESTS.includes(name) ? `"${name}" is declared by the generated test of every action, which imports the use-case under its name: pick another name` : undefined
