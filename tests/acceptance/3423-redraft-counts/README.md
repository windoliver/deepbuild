# Blind redraft of #3423's tests for criteria #3423.a2928d51 and #3423.e825ce4d

A blind redraft of #3423's acceptance tests for two of its criteria, written from issue #3423 as it reads on
2026-11-27 (body only, no comments), the design sections it links (`docs/technical-design.md`: How we know version 0
works with Dogfooding, First-party extensions that ship on by default, Ask, An ask and your answer getting back) and
base commit `345c9ae2675bbf006a04450a1088928ddabd9548` with this job's first-draft suite (`tests/acceptance/3423/`,
commit 940479f81). No implementation existed or was looked at. The implementing agent doesn't edit these files
(AGENTS.md, Proof).

Why a redraft: on 2026-11-27 the issue amended criteria 1 and 7 from 19 / 98 to 14 / 103 ("the records' own notes for
1634, 224, 268, 968 and 2516 say the owner delegated and an agent looked"). That changed both criteria's text and so
their IDs (first draft: `#3423.63f64cd6`, `#3423.408915d5`). These files replace the first draft's
`ac1-lane-counts.test.ts` and `ac7-owner-list.test.ts` for the amended criteria; the first draft's other six files
stand.

The criteria, as the issue states them:

- `#3423.a2928d51`: "On the records main held at `ebf1e7f44` the lane counts 14 calls by a person and 103 readings by
  an agent, 4 of them signed for by a person. On the merge base it fails, naming a record whose maker is prose"
- `#3423.e825ce4d`: "The list holds all 103 with their issue, criterion and hashes, and a recorded overrule reopens
  its issue. A list that drops a record fails, naming it"

IDs: sha256 of the criterion's text, trimmed, whitespace collapsed, first 8 hex.

## Files

| File | Criterion | What it proves |
|---|---|---|
| `ac1-lane-counts.test.ts` | `#3423.a2928d51` | `lane` on the change passes and, over the 129 record files ebf1e7f44 held, counts 117 calls: 14 by a person, 103 by an agent, 4 of those named by a signed tag; the five delegated records the amendment names are among the agent's. `lane --rev <merge base>` exits non-zero with a `maker-in-prose` failure naming a record of that rev that has no `maker` and a `who`/`by`/`delegated`/`how` member, and its output names it |
| `ac7-owner-list.test.ts` | `#3423.e825ce4d` | `list` on the change holds 103 of ebf1e7f44's records, each once, the five delegated ones among them, exactly the ones the lane reads as an agent's, each under its issue with the criterion and hashes the merge base's copy holds. In a scratch repo `reopen` reopens only the overruled record's issue through `gh`, on the repo given, naming the criterion, and reports issue, criterion and file. `list --check` passes the whole list (`missing: []`) and fails one with a reading dropped, `missing` naming that record only, and stderr naming it |
| `records.ts` | both | the five record paths ebf1e7f44 holds for issues 1634, 224, 968, 2516 and 268, which the amendment says an agent looked at |
| `tsconfig.json` | | type check: `npx tsc -p tests/acceptance/3423-redraft-counts/tsconfig.json` |
| `BASE-FAILURE.txt` | both | the folder's run on the base: 5 of 5 fail at the `reply()` assertion (no `scripts/taste.mjs`) |

The tests import `../3423/helpers.ts` (the spawner, fixture repos, fake `gh`, record helpers, `READ_ON`, `mergeBase`,
`holdsMaker`); its surface and record-set rules are the first draft's README's, unchanged. No `lane.json`: nothing
here must run alone.

## What the implementer must know

- **The surface** is `node scripts/taste.mjs lane|list|reopen`, exactly as `tests/acceptance/3423/README.md` defines
  it: the record set, `maker`'s two shapes, `lane`'s `records`/`failures` JSON, `list`'s `issues[].readings[]` with
  `file`, `criterion`, `hashes`, `list --check FILE` printing `{ "missing": [...] }` and naming each on stderr, and
  `reopen --repo OWNER/NAME` calling `gh issue reopen <issue> --repo <OWNER/NAME> --comment <text>` and printing
  `{ "reopened": [{ issue, criterion, file }] }`.
- **The five delegated records** at ebf1e7f44 are `docs/evidence/1634/taste.json`, `docs/evidence/224/taste-call.json`,
  `docs/evidence/968/taste-call.json`, `tests/acceptance/2516/TASTE.json` and `tests/acceptance/268/TASTE.json`. The
  migration must give each an agent maker, from its own note; the tests check that, not just the totals.
- **The four signed.** The first draft's reading stands: the five `deep/approved/*` tags that name a record name 425,
  1174, 399, 422 and 1175; four of those are agent-made. None of the amended five is among them, so the signed count
  stays 4. `signed` counts any good signature; those keys are not on `.deepbuild/approvers`, so the four stay readings
  (AC5's rule). The lane copy needs the repository's `deep/approved/*` tags.
- **The merge base after landing.** Once the field lands, a later merge base holds `maker`; the failing read then uses
  ebf1e7f44, whose 129 records are the base's byte for byte (as in the first draft).
- **Hashes** are compared with the merge base's copy of each record (the migration changes no hash).
- **Counts move with main.** 14 / 103 / 4 are over the paths ebf1e7f44 held; a later edit there changes them.
- **Twins.** The criteria's planted programs (a list that drops a record; the merge base's prose records) are fixtures
  or real commits here, so these two criteria need no `twins.json` entry.

## Run

`npx vitest run tests/acceptance/3423-redraft-counts` from the checkout root (Node 24). Needs `git`; no network,
model or GPU. Each `lane`/`list` run on the repository has a 240 s limit, each test 300 s, the file well under 20
minutes.
