# Proposed change to tests/preflight.test.mjs (needs maintainer approval; not applied)

Base lines 186-188 read every entry of `tests/acceptance/` as a folder; `plans.ts` is a file, so `readdirSync` throws ENOTDIR.

```diff
-  const gated = readdirSync(new URL('tests/acceptance/', root))
-    .flatMap((issue) => readdirSync(new URL(`tests/acceptance/${issue}/`, root)).map((file) => `tests/acceptance/${issue}/${file}`))
+  const gated = readdirSync(new URL('tests/acceptance/', root), { withFileTypes: true })
+    .filter((entry) => entry.isDirectory())
+    .flatMap(({ name: issue }) => readdirSync(new URL(`tests/acceptance/${issue}/`, root)).map((file) => `tests/acceptance/${issue}/${file}`))
     .filter((file) => file.endsWith('.test.ts') && readFileSync(new URL(file, root), 'utf8').includes('environmentProblem()'));
```

Every assertion (the `14/budgets.test.ts` guard, the parallel-first check, the exclude and alone coverage loop) is
unchanged. The full proposed file is `preflight-folders-only.proposed.mjs`, whose other lines are the base's verbatim.
