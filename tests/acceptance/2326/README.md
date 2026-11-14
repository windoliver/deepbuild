# Acceptance tests for #2326

These were drafted blind from the issue, `docs/technical-design.md` and base commit `1c4d1f0e2`. Do not edit them. A dispute goes to a blind redraft (design: Dogfooding).

Run them with:

```
node --test tests/acceptance/2326/lock.test.mjs
```

## Automated checks → criteria

| Check in `lock.test.mjs` | Criterion |
|---|---|
| `Cargo.lock holds <crate> at <fixed> or later, a final release, …` (8 tests: `rustls-webpki` ≥ 0.103.16, `tokio` ≥ 1.54.1, `zstd` ≥ 0.13.4, `zstd-safe` ≥ 7.4.0, `crypto-bigint` ≥ 0.7.6, `ctutils` ≥ 0.4.4, `rustix` ≥ 1.1.6 (the 1.x line; 0.38.x isn't named), `rsa` ≥ 0.10.0) | 1: the lock holds each of the eight at its first fixed version or later. Versions are compared by semver precedence. A prerelease never passes, so `0.10.0-rc.N` doesn't count as `0.10.0`. |
| `the change against the base touches Cargo.lock and no Cargo manifest` | 1: the diff touches `Cargo.lock` and no manifest. It reads `git diff` against `1c4d1f0e2` plus untracked files. If main gets merged into the branch, main's own manifest edits would show here too, so read it on the change before any merge. |

On the base, all 9 fail for the reason the issue gives. The 8 version tests fail because each crate is still locked at its affected version. The diff test fails because `Cargo.lock` is unchanged.

**Held-back crates.** The issue allows the PR to name the dependent that holds a crate back instead of moving it. That test still fails. It is never skipped or excused. A person must check the PR's named dependent against the failing output.

## Criteria that still need run evidence (not counted as passing here)

- **2:** needs the PR's run of the existing checks, not new tests:
  - `node scripts/affected.mjs` reports no failure outside `scripts/known-failures.json`, and the PR shows its WIDE and INCONCLUSIVE lines.
  - `node scripts/repo-rules.mjs` passes.
  - The canvas lint (`scripts/canvas-lint.mjs`) passes. It already fails any crate in `lint/canvas/crates.json` whose resolved version moved without a re-audit, which covers the Scope's crates.json item.
- **3:** needs the hash comparison from the reference Mac: every golden, step hash and full-state hash the affected lanes compare must equal the merge base's, and any difference must be listed with the crate that moved it.
- **4:** needs the PR text. It must carry a row for `quick-xml` 0.38.4 and one for `rkyv` 0.7.46, each naming the advisory, the dependent that holds the version, and one sentence on whether the fault can be reached from a document, a pack or a panel.
  - The Scope also asks for ignore rows "where #2298 will read them". #2298 isn't among these inputs and the base has no advisory-ignore file, so this test doesn't assume a file or format.
  - The same limit applies to "no row for the engine" (#2324).
