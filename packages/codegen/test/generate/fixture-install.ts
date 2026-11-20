/**
 * The compile tests (typecheck, lint and run the generated code of a copy of the golden blog) need `pnpm --dir fixtures/codegen/blog
 * install`. Without it they skip. In CI they run (a missing install fails them); elsewhere the skip is announced with one console
 * warning, so a green run that checked nothing doesn't pass for a real one.
 */
export const FIXTURE_INSTALL = 'pnpm --dir fixtures/codegen/blog install'

export const fixtureGate = (warn: (message: string) => void = message => console.warn(message)) => {
  let warned = false
  /** The suffix of the suite's title when it skips (empty when it runs). */
  return ({ installed, ci }: { installed: boolean, ci: boolean }): string => {
    if (installed || ci) return ''
    if (!warned) {
      warned = true
      warn(`[codegen tests] SKIPPING the compile tests of the generated code: the golden fixture has no node_modules. Run \`${FIXTURE_INSTALL}\` first.`)
    }
    return ` (skipped: run \`${FIXTURE_INSTALL}\` first)`
  }
}

/** One gate for the whole test run: its warning is printed once per worker that loads it. */
export const fixtureSkip = fixtureGate()
