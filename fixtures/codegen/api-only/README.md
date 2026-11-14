# API-only golden model (V7)

The model files an API-only project (`create-bildr --database none`) adds to its starter kit. No database.

- One REST data source (`api`), a `Task` entity with a repository over it (list, get, create), a query, an action
  and three pages (list, detail, create).
- One memory data source (`local`, P3c), a `Note` entity with a repository over it (every operation), the queries
  `q_notes` and `q_note_by_id`, the action `act_create_note` and its fixtures (one seed row). These are exactly the
  files `datasource_create` and `entity_create` write (`packages/codegen/test/edit/data.test.ts`), plus the seed row.

- `packages/codegen/test/generate/api-only.test.ts` generates the project from them and runs its typecheck,
  lint and generated tests (with the golden blog fixture's `node_modules`).
- `e2e/generated.mjs --database none` puts them through the editor's actions and smoke-tests the built app
  against a stub REST server, and the memory source's seed and create through its API.

Only `.bildr/` files live here: the generated code is checked by those two, not kept as a golden copy.
