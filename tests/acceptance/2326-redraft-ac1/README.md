# #2326 acceptance: criterion 1 (blind redraft)

Written from the issue, `docs/technical-design.md` and base `1c4d1f0e2` only, by a job that saw no implementation. Run:

```
node --test tests/acceptance/2326/ac1.test.mjs
```

No Rust build and no network. The change is read as `scripts/affected.mjs` reads it: `changedPaths` from `scripts/lanes.mjs`, every path that differs between `git merge-base HEAD origin/main` and the working tree, plus untracked files.

## Criterion 1 (`#2326.3ec6f925`)

> After the change `Cargo.lock` holds `rustls-webpki` at 0.103.16 or later, `tokio` at 1.54.1 or later, `zstd` at 0.13.4 or later, `zstd-safe` at 7.4.0 or later, `crypto-bigint` at 0.7.6 or later, `ctutils` at 0.4.4 or later, `rustix` at 1.1.6 or later and `rsa` at 0.10.0 or later, or the PR names the dependent that holds one back. The diff touches `Cargo.lock` and no manifest

| Part of the criterion | Test in `ac1.test.mjs` | On the base |
|---|---|---|
| The root `Cargo.lock` holds each of the eight at the named version or later | `Cargo.lock holds each of the eight…` | fails, all eight behind |
| The diff touches `Cargo.lock` | `the change touches Cargo.lock and no manifest` | with `origin/main` at the base, fails: no `Cargo.lock` in the change |
| …and no manifest | same test | in the redraft's own run, `origin/main` was 350 commits behind the base, so the "change" held those commits and the test failed on their manifests. A stale `origin/main` misreads the change the same way for `scripts/affected.mjs`; fetch it before running |
| The checks refuse wrong programs | `wrong program: the base's lock…`, `boundaries…`, `wrong programs: a crate dropped…`, `wrong programs: a change that edits a manifest…` | pass (they run the checks on planted inputs) |

How "holds X at V or later" is read: no locked copy of X on V's Cargo compatibility line (`0.103.x`, `1.x`, `0.10.x`…) is below V, and at least one locked copy is at V or later. SemVer precedence applies, so `rsa 0.10.0-rc.19` is below `0.10.0`. A copy on another line is a different requirement the issue doesn't name: the base also locks `rustix 0.38.44`, which no lock-only update can move to 1.1.6, so it is not counted. A crate absent from the lock is not "held at V or later" and fails.

"Manifest" is read as any `Cargo.toml` or `package.json` at any depth; `Cargo.lock` and `package-lock.json` are locks, not manifests. Other files (such as the ignore rows of criterion 4, or these tests) may change.

## What a person still decides

- **"…or the PR names the dependent that holds one back."** The PR's text is not a surface in the repository, so this branch can't be decided here. A held-back crate fails the first test, which names the crate, its locked versions and its dependents in the lock. A person reads the PR for the dependent whose requirement holds it and decides whether the test's failure is that disclosed exception. Nothing here passes it.
- The test does not check that the lock moved *only* what a `cargo update` of the eight would move; the issue's criterion 3 (hashes) and the canvas list rule in its Scope cover what else moved.

## Other criteria

Not redrafted here. Their evidence is external or comes from existing checks, and none of it has been run:

- Criterion 2: the output of `node scripts/affected.mjs` on the change, with its WIDE and INCONCLUSIVE lines, plus `node scripts/repo-rules.mjs` and the canvas lint, as the issue names them.
- Criterion 3: the affected lanes' golden, step-hash and full-state-hash comparison with the merge base, read on the reference Mac.
- Criterion 4: the two rows in the PR (`quick-xml` 0.38.4 and `rkyv` 0.7.46). Whether each row's sentence about reachability is correct is a person's call.
