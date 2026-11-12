# Acceptance tests for #2072 (placeholder; see held-action.test.ts)

Run (after `npm ci` and `npm run build --workspaces`, as #363's README says):

    node node_modules/vitest/vitest.mjs run --root tests/acceptance/2072 --no-file-parallelism
