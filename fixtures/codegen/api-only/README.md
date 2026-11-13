# API-only golden model (V7)

The model files an API-only project (`create-bildr --database none`) adds to its starter kit: one REST data
source (`api`), a `Task` entity with a repository over it (list, get, create), a query, an action and three
pages (list, detail, create). No database.

- `packages/codegen/test/generate/api-only.test.ts` generates the project from them and runs its typecheck,
  lint and generated tests (with the golden blog fixture's `node_modules`).
- `e2e/generated.mjs --database none` puts them through the editor's actions and smoke-tests the built app
  against a stub REST server.

Only `.bildr/` files live here: the generated code is checked by those two, not kept as a golden copy.
