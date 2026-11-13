# #2173 acceptance

Base source archive: `1c4d1f0e2aaad8c6a6573848823566d04ff73d17` (supplied by the task).
Drafted blind from that tree, `AGENTS.md`, the design's Dogfooding/proof rules,
and `../issue.json`. This archive has an index but no `HEAD` or `origin/main`;
no other checkout or implementation was read.

## Criterion → test

- **AC1 — `node scripts/repo-rules.mjs` exits 0 on main:**
  `repo-rules.test.mjs` runs that exact public command in the real tree and
  requires normal completion and exit 0. The expected status comes from the
  issue, not a captured output. The old #246 live-tree test additionally
  requires exactly five output lines, predating cards/physics-build/vendor
  notes, so it is not suitable for this criterion. Only the shared process
  helper is reused. No output snapshot or alternate exit status is accepted.
- **AC2 — an undocumented dependency still fails, naming manifest and dependency:**
  reuse `../246/redraft/deps.test.mjs`, test **“a Rust dependency fails in each
  section that declares it, and passes once listed with spec ^1”** unchanged.
  It runs the public command in disposable Git repositories, requires exit 1
  and a `FAIL deps` line naming `crates/fx/Cargo.toml` and `serde`, and rejects
  `PASS deps`. It covers ordinary, dev and target dependencies, with listed
  positive twins. It never changes the live manifests or rules. No duplicate
  negative-control test is added.

The issue's one-entry scope and accessibility rationale remain implementation
review obligations; the command does not judge the meaning of the reason text.
No production files, existing tests, check programs or configuration were edited.

## Run once on the base

From the repository root (Node, Git and Cargo; no new dependencies):

```sh
node --test --test-reporter=tap \
  --test-name-pattern='AC1:|a Rust dependency fails in each section' \
  tests/acceptance/2173/repo-rules.test.mjs \
  tests/acceptance/246/redraft/deps.test.mjs
```

Full captured output, with local paths redacted, is in `BASE-FAILURE.txt`.
Observed: **exit 1; 0 passed, 2 failed**.

- **AC1 FAIL:** the command exits 1, including the issue's exact missing
  `accesskit_macos` declaration for `crates/deep-app/Cargo.toml`.
- **Unrelated base failures:** 21 other undocumented dependency declarations,
  one existing evidence file's home-path finding, and two cards findings.
  Thus adding only the scoped entry cannot make this archive exit 0.
  Workflows, agent-hooks and physics-build report PASS; size is not measured
  without `origin/main` (not PASS).
- **AC2 reused check BLOCKED overall:** its first ordinary-dependency negative
  control reaches and passes the assertions requiring the manifest, `serde`,
  exit 1 and no `PASS deps`. The test then fails at its listed positive twin
  (`deps` itself reports PASS) because the old fixture helper copies only
  `repo-rules.mjs`, not the now-required `scripts/physics-build.mjs`.
  This unrelated missing-module failure is not an acceptance PASS. The later
  dev/target cases are **unrun**, not PASS. The existing test/helper is left
  unchanged; the test is neither weakened nor retried.

Required affected verification was also attempted once:

```sh
node scripts/affected.mjs tests/acceptance/2173/repo-rules.test.mjs
```

**BLOCKED**, exit 1 before selection: installed `typescript` is missing.
No WIDE or INCONCLUSIVE lines were emitted; no affected checks ran. No install,
full preflight, implementation fix or after-fix run was attempted. Changes are
left uncommitted.
