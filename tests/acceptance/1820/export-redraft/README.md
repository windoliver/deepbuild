# #1820 blind redraft: re-export and offline BLOCKED through `deep export`

Written blind from issue #1820, the design (`Pack: assets fetched on first use`, Dogfooding), AGENTS.md and base 903a1c07,
with only the base's public surfaces (`deep export --document --still --out`, `deep install`, `deep_kinds`, asks) and the
base helpers (`../../1731/helpers.ts`, `../scope/world.ts`, `../pack.ts`) reused read-only.

| Criterion | Test |
|---|---|
| Scope 4: a document names `pack@version`, a re-export uses the same bytes | pinned v1 exports red, v2 blue; v1 after v2, upstream changed, network gone: byte-identical twice, no request, no ask; an uninstalled version is refused, no PNG, no stand-in |
| AC4 (`#1820.09114f60`): offline, unfetched asset BLOCKED, one unblock ask, never PASS | two exports: non-zero, BLOCKED in output, no PNG, exactly one unblock ask, zero authority asks, no request, not fetched |

Surface assumptions (named in `export.test.ts`): `packs: ["owner/name@version"]` in the document, `image@1` `params.asset`
by sha256, `deep install <folder>` and `deep_kinds {op: "fetch", pack, asset}` as in `../README.md`.
Typecheck: `node node_modules/typescript/bin/tsc -p tests/acceptance/1820/export-redraft/tsconfig.json`.
