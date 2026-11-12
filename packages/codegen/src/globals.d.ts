// The web-platform globals that exist in every runtime the package targets
// (browser, Node, workers). Declared here instead of the DOM lib so `window`,
// `document` and the rest stay out of reach (S4: pure core).

declare global {
  interface URL {
    readonly hostname: string
    readonly pathname: string
    readonly search: string
  }
  var URL: { new (url: string, base?: string): URL }

  interface TextEncoder {
    encode(input?: string): Uint8Array
  }
  var TextEncoder: { new (): TextEncoder }

  function structuredClone<T>(value: T): T
}

export {}
