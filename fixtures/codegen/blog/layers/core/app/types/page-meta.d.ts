// The values a page sets for its layout's variables (`definePageMeta({ layoutValues })`),
// keyed by variable name; the generated layout reads them from `useRoute().meta`.
declare module '#app' {
  interface PageMeta {
    layoutValues?: Record<string, string | number | boolean>
  }
}

export {}
