# Migrating a bildr project

`.bildr/bildr.json` records which generator wrote the app (`generatorVersion`). If a newer bildr's generator writes different code, bildr leaves the app as it is. It edits the model as usual but does not regenerate the app until you upgrade the project. Health and the `nuxt dev` log say why.

To upgrade a project:

1. Commit your work, so the upgrade shows up as one diff.
2. Read the section below for each version you are moving past.
3. Run `project_update { upgradeGenerator: true }`, from the editor's agent or the MCP tools. You can also set `generatorVersion` in `.bildr/bildr.json` yourself. bildr then regenerates the app.
4. Open Health. A generated file you edited is *detached*: bildr kept your copy, and you compare it with the new one. Then run `pnpm typecheck` and `pnpm test`.

Files bildr manages and that you never edited are simply rewritten. These notes are about **your** code: the root `app/` and `server/`, detached files, and anything that imports generated code.

## To 0.2.0

This version is a clean-architecture layout per module (`layers/<module>/`) on Nuxt 4, with one convention for the data layer.

### Data sources and errors

- **One HTTP client.** Every remote call goes through `createHttpClient` (`#core/http/client`). Core's `server/utils/remote.ts` (`useRemote`) is gone, so call a REST source through its module's composition root instead.
- **Failures are values.** REST repositories and API sources answer a `Result` (`ok(value)` / `err(error)`, from `#core/kernel/result`) and never throw an expected failure. Code that did `try { await repo.list() } catch` reads `result.ok` instead.
- **Why a call failed.** A failed call has a `type` with a `status`:
  - `not_found`
  - `unauthorized`
  - `rate_limited`
  - `timeout`
  - `unavailable`
  - `remote_failed`
  - `invalid_answer`, when the answer did not match the model
  - `not_configured`, when a secret is missing

  `remote_failed` replaces the old catch-all. Code that matched on error types must handle these.
- **Gateway statuses.** A route answers what a gateway would:
  - 404 stays 404.
  - 401 and 403 become 502. The source refusing the app's key is the server's problem, not the user's session.
  - 429 becomes 503, with the same `Retry-After`.
  - A timeout becomes 504.
  - 5xx, or an unreachable source, becomes 503.
  - Anything else becomes 502.
- **`unwrapOrThrow(result, statuses, event?)`** (`layers/core/server/utils/http-error.ts`) takes the request event as a third argument. It needs the event to send `Retry-After` and to answer 499 when the browser went away. Pass `event` from your own routes.
- **Composition roots take a signal.** `useX(signal?: AbortSignal)`. Read routes pass `event.req.signal`, so a read stops when the browser goes away. Write routes pass nothing, so a write is never cut halfway.
- **Retries.** On the server, a GET is tried again twice when the source was down. A write is never retried. In the page, the query retries instead.
- **New, optional model settings:**
  - `timeout` (seconds, 1–60, default 10) on REST and API sources.
  - `cache: { ttl }` on REST and server API sources. The server keeps their reads in memory for that long, and a write through the source clears them.

### Contracts, domain and composables

- **One HTTP contract per route** in `layers/<module>/shared/contracts/<route>.ts`. API sources use `layers/apis/shared/contracts/<source>/`. Each contract holds the method, the path and the schema of what the route reads. The route and its client both import it, so a client you wrote should too, instead of spelling the path out.
- **No `<Entity>PatchSchema` or `<Entity>Patch`.** Nothing generated used them. Code that imported one can derive it: `New<Entity>Schema.omit({ id: true }).partial()`.
- **Domain rules** live in `layers/<module>/shared/domain/<entity>.rules.ts`. The use-case and the optimistic update share them.
- **Composables** answer `{ data, status, error, refresh }`. Actions answer `{ run, pending, error }`, and `run` answers a `Result`. `error` is the source's typed error or `{ type: 'unexpected' }`.
- **API sources** follow the same rings as a module, in `layers/apis/`: application, infrastructure, contracts, a server root in `server/utils/<source>.ts`, and a page root in `app/data/<source>.ts`.

### UI

- **A Form is a `UForm`.** It validates with its action contract's schema (`formSchema`) as the user types and on submit, and shows the messages under each field. The submit handler is bound with `@submit`, not `@submit.prevent`. A select with no default starts empty.
- **New reserved page name:** `formSchema`, next to `form`, `route`, `props`, `site`, `layout`, `toast` and `set`. A page use named one of them has to be renamed.
- **Hover and pressed** are states, not variants: a component no longer takes them as a `variant` value.
- **A guarded page** whose record doesn't exist answers 404 (`showError`).
- Generated classes follow Tailwind's order. No-op classes are dropped.
