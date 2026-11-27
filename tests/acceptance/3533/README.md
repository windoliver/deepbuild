# Acceptance tests for #3533: the public text lane checks the names of the packs main ships

Written first, blind, from issue #3533 (its report, Scope, three acceptance criteria and Proof; it has no comments), the
design section it links (Built to be hard to get wrong) and base commit `d303e2b64` ("Merge pull request #3643 …"), by
a job that never saw an implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding). Node's test runner and built-ins only.

No file here, and no line a test prints, holds a word the studied-names list holds. The pack folders and words a test
needs are read at run time: AC1's folders from the base's `packs/` and list, AC2's word is invented (`zorvanthique`)
and listed only in a scratch copy by its salted hash. Every line a test prints passes through `withhold`, which writes
each word the base's or the checkout's list reads as listed as `<withheld>`.

| AC | ID | Tests |
|---|---|---|
| AC1 | `#3533.4fe1349f` | `ac1-shipped-packs.test.mjs` (four: two before the decision, two after) |
| AC2 | `#3533.d97bed63` | `ac2-planted-pack.test.mjs` |
| AC3 | `#3533.cc941d25` | `ac3-spike-3445.test.mjs` (fetches PR #3505's branch from origin) |

IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's line after `- [ ] `, read from the live issue.
Each test's name starts with its ID and its AC number.

Run, from the repo's root:

```
node --test --test-concurrency=1 'tests/acceptance/3533/*.test.mjs'
```

AC3 needs the network to fetch the spike's branch. Each test copies the checkout's working tree, so a run takes minutes
(14 at the base under load 70 to 80; `BASE-FAILURE.txt`).

## What was read

`AGENTS.md`; the issue; `docs/technical-design.md#built-to-be-hard-to-get-wrong`; at the base `scripts/public-text.mjs`
(the lane: dependency and adapter names first, then the change, then the open issues), `scripts/studied-names.mjs` (the
word rule, copied into `helpers.mjs`), `scripts/studied-names.json` (`{ salt, hashes }`), `scripts/open-issues.mjs`
(`DEEP_OPEN_ISSUES`), `scripts/lanes.mjs` (the `public text` entry, `changedPaths`), `packs/` (folder names and
`pack.json`), and suite `tests/acceptance/2405/` for the house shape.

## The surfaces (my choice where the issue leaves it open)

- **The lane.** The `public text` entry of the copy's own `scripts/lanes.mjs`: its commands, run in order in the copy's
  root until one fails. Not through `runLanes`, so no throttle grant is waited on; the lane's verdict is its exit code
  and the verdict words its lines start with (`FAIL`, `INCONCLUSIVE`, `BLOCKED`, `INVALID`).
- **A scratch copy.** The checkout's working tree (tracked files and untracked ones git doesn't ignore, never `.git`)
  in a temp folder, with a fresh `git init`, the checkout's origin URL as origin, and `origin/main` pointed at the
  commit a test calls main, so later commits are the change. Git runs with every `GIT_*` variable dropped, no global
  or system config, a fixture identity and no signing. HOME, TMPDIR and the XDG folders are the sandbox's.
- **Open issues.** Three fixture issues that name no product, fed through `DEEP_OPEN_ISSUES` (open-issues.mjs's cache
  file) and a fake `gh` alike. Real open issues are out of scope: the issue leaves "text that names such a product
  outside a pack's own name" out of this task.
- **"The list as it is on main" and "main".** Before the decision: the copy with its `packs/` and
  `scripts/studied-names.json` replaced by the base's (`git archive d303e2b64`), so either decision is undone in the
  copy. After the decision: the copy as the checkout has it.
- **"The three pack folders whose name reads as listed".** The base's folders under `packs/` that the base's list reads
  as listed, by the lane's own word rule (a part of a joined name is read). The test first checks they are three packs
  (a pack's versions are one pack), then that the lane's output names each folder whole, as `packs/<folder>` or
  `<folder>`, not inside a longer name.
- **"Before it reads the change".** The lane still fails, naming each folder, when the change can't be worked out (no
  `origin/main`): a lane that reads the packs after the change ends `INCONCLUSIVE` there without naming them. And with
  a change that names no product, the lane fails on the folders alone.
- **"After the decision it passes on main".** No folder the checkout's `packs/` holds reads as listed in the checkout's
  list, and the lane passes on the checkout committed as main with a change that names no product.
- **AC2's plant.** A folder `packs/zorvanthique-<version>/` holding the checkout's smallest `pack.json` renamed
  `zorvanthique`, with the word's salted hash added to the copy's list (sorted, two-space JSON, as the file is kept),
  both in the copy's main, so no line of the change names the folder. The test first checks the checkout's list
  doesn't already hold the word. It holds under either decision, since it doesn't rest on which words the list keeps.
- **AC3's folder.** `docs/spikes/3445/` from the checkout when main already holds it, else fetched with depth 1 from
  origin's `spike/3445-sandbox-uncounted-costs`, then `pull/3505/head`, into the copy's own git (the checkout's is
  never written). The copy's main is the checkout without that folder; the change adds it whole, so every line is read.
  A folder that can't be had fails the test with `INCONCLUSIVE:`, never a pass. Under the rename decision the test
  passes only once the spike's branch names the renamed packs.

## Untested

The lane's wording, how it counts, a pack named in a `pack.json` but not in its folder name, folders under `packs/`
that hold no `pack.json` (they are read as pack folders here, as the base's `packs/` holds them), and the lane run on
the real open issues.
