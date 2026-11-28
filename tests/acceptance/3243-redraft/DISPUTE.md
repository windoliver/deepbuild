# Dispute (#3243): the first draft of #3243.48cf467d wants the provisional ask in Needs you at once

This file is the work's, not the blind job's. The job wrote the other files of this folder from issue #3243,
`docs/technical-design.md` and main `b48a47db7`. It got one fact about the first draft (below) and nothing else of
this change.

## What fails

`tests/acceptance/3243/provisional.test.ts` (`#3243.48cf467d`) passed at its base `118ec119f`. On main `b48a47db7`
with #3384 it fails, alone, at its last assertion. What the criterion asks still holds: `deep_ask` returns
`provisional` with the recommended option, the record holds the ask raised provisional, and nothing closes it. The
failing check is extra: the ask's `inbox.read` row must read `entry: 'needs_you', waits_on: 'you'` at once. On main
the only row for it is in the asks list,
`{"status":"queued","outcome":"unanswered","closed_at":null,"owner":"you",...}`, with no `entry` or `waits_on`, and
no Needs-you row.

`queued` is the inbox's view of an open ask that hasn't shown yet. With your drafted batch (`asks.batch`, every 8 h,
`packages/asks/src/settings.ts`), an ask shows at your next batch time, or at once only when its deadline (2 days for a
choice) would pass first (`packages/asks/src/showing.ts`, `show`). The design says asks come in batches, a few visits
a day, and it doesn't make a provisional ask skip the batch. Work goes on with the recommended option meanwhile, so
nothing waits. The work did not bisect which change since `118ec119f` stopped the first draft's ask from showing at
once. Asks v2 (#2097, `feae1e290`) is the main change to asks in that range.

## What this change does

- Leaves `tests/acceptance/3243/provisional.test.ts` unedited and runs it by hand (`scripts/lanes.mjs`, `byHand`).
- Runs this blind redraft in its place. It checks what the criterion says: provisional with the recommended option,
  answered within 20 s, the record holding it raised provisional, and the ask still open (`closed_at: null`, no
  closing event). It doesn't ask for a Needs-you row. Its twin `never-provisional` plants
  `const provisional = false` in `packages/hub/src/mcp-operations.ts`.

## What is yours

Moving the file to by hand and listing this folder in the lanes is a `scripts/lanes.mjs` edit, in a commit of its
own. It needs your signed approval tag.
