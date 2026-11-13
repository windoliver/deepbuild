# Registered childEnv wrong-program proof

The independent job saw only live issue #1123, the design and immutable base `092754bb1`. Its output is adopted byte-for-byte in `a197042c1`: `tests/acceptance/1123/twins.json` registers `child-env-delete-after-merge` for `#1123.cd6b3dd8`, and the twin is the complete base `scripts/proof-runs.mjs` plus one deletion **after** merging `extra`. Full-module overlays are the existing runner format; the roughly 887 copied lines are mechanically retained code, not 887 handwritten lines. No existing test or implementation changed in this addition.

## Actual verification

1. The identical original `environment.test.mjs` ran in disposable clean/twin copies under one real test grant. **Clean: 3 passed. Twin: 2 passed / 1 expected failure**, exactly `#1123.cd6b3dd8 childEnv preserves the explicit per-side binary directory`. The failure names `per-side DEEP_BIN_DIR survives`, actual `undefined`, expected `/fixture/change/bin`. Full imports/setup succeeded; no skip or timeout was counted.
2. A disposable minimal repository retained those same tests, real scripts, independently generated registry/twin and the exact unedited live issue body. Its own Git history uses the actual base `childEnv` and current implementation. TypeScript 5.9.3 was installed offline with the receiving lock's integrity. The **real repository proof entry**, run with cwd at that fixture, reports:

   ```text
   PASS before: ... childEnv discards a shell binary directory: failed on the merge base at its assertion
   PASS before: ... childEnv preserves the explicit per-side binary directory: failed on child-env-delete-after-merge at its assertion
   PASS trace: Part of #1123; open: #1123.4ed9aa75, #1123.07de86fd, #1123.273f1f14
   ```

   This demonstrates the existing runner's registered-twin discovery and assertion attribution; it is **not a full-branch trace or closure verdict**. AC2 is open in this minimal fixture because only environment tests are present, not because earlier AC2 evidence was erased. The first fixture attempt incorrectly invoked its copied proof script, which queued for a real bay. It was cancelled by verified PID/start before bay admission or test execution; the documented real-runner fixture entry then completed in 23.9 s.
3. Original test SHA-256 on both sides: `852b10bf80b2199e76833fb0f5e7e77de49abc5dab8c04e1fbf707cd7bc4a05d`. Twin source SHA-256: `be2aff56f2b0538274ebba077c8523a01ba1f24bb82e4e26d58efc09226d143c`. These agree with the independent draft.
4. Syntax and diff checks pass. `affected.mjs --list` selects the existing #1123 mechanism/capture/environment tests and the separate uncommitted benchmark candidate. No WIDE or INCONCLUSIVE-prefixed selector lines. Affected execution for this addition is not yet completed; the prior supervisor affected result remains FAIL with 10 no-grant jobs, not waived.

The registered twin does not fix AC1/AC4's separate evidence gaps. The blind supplemental migration job returned BLOCKED rather than inventing a generic proof of eligibility/chronology. Full same-workload Mac timings remain absent, and protected-change signatures remain owner-only.

The original draft, raw red/green outputs, actual reporter rows and fixture `before` output are retained beside this report. No test assertion, tag, tolerance, baseline, guard or measurement requirement was changed.
