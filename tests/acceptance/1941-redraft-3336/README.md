# #1941.afbf01b2, blind redraft for #3336

This folder redrafts the one test of `tests/acceptance/1941/taste.test.ts`, for criterion `#1941.afbf01b2` (the
screenshots of each planted-fault scene before and after its named fix, and the one taste call on them). The job that
wrote it saw only the issues (#1941, #3336), the design, `AGENTS.md` and #1941's first draft suite.

## Why

The first draft writes its screenshots into the checkout, `docs/evidence/1941/`, where those files are tracked. Every
run that draws other bytes than the committed ones leaves the tree changed (#3336). #3336's criterion
`#3336.7d4ab4ab` asks that whatever the run writes goes to a temp or run folder, that #1941's screenshots are written
outside the checkout, and that the run names where.

## What changes, and what doesn't

The criterion is judged the same way, scene for scene, by the first draft's own helpers
(`../1941/helpers.ts`, imported, not copied): for each planted-fault scene the check names its fix, render-back draws
the judged revision, the fix is sent as alpha's patch and must apply, and render-back draws the patched revision. Each
picture is render-back's own snapshot, read from the evidence store by the hash its reply names and checked to be a PNG
of the size it names. The call is read from the same place and judged by the same rules.

The only change is where the pictures go:

- The run makes a folder outside the checkout, `mkdtempSync(join(tmpdir(), 'deep-1941-taste-'))`, and refuses one that
  resolves inside the checkout.
- It prints that folder before drawing, then each screenshot's name and SHA-256 (also when a scene fails to draw).
- It keeps the folder after the run, so the owner can look at the pictures. The evidence stores and the built binary
  are temp folders the first draft's helpers delete after the test.
- It never writes under the checkout.

## What it reads

- `tests/acceptance/1941/TASTE.json`, the recorded call, in the format of the first draft's README ("The taste call").
  No call, or one recorded on other hashes than this run's, is INCONCLUSIVE. `looks_wrong` fails. `looks_right` on
  exactly these hashes passes. The owner records it from the hashes this run prints.

## Runs on

macOS with Metal. On any other platform it reads INCONCLUSIVE (`requireMetal`), as the first draft does.

## Base

`BASE-FAILURE.txt` holds the run on base `3c564bbdd`.
