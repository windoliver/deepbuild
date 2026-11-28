# Acceptance tests for #3423: who made a taste call is a field of its own, and an agent's call is a reading

Written first, blind, from issue #3423 as it reads today (November 26, 2026: its body, Scope, eight acceptance
criteria and Proof line; no comments), the design sections it links (`docs/technical-design.md`: How we know version 0
works with Dogfooding, First-party extensions that ship on by default, Ask, An ask and your answer getting back) and
the base commit `345c9ae2675bbf006a04450a1088928ddabd9548` ("Merge pull request #3642"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

Also read, at the base, for surfaces only: `AGENTS.md`; `scripts/proof-approvals.mjs` (`readApprovals`, `signersIn`,
the approval tag shape of #1326 and #3166); `.deepbuild/approvers`; `tests/acceptance/1040/taste.test.ts` and
`tests/acceptance/166/taste.test.ts` (how suites read a record today); `tests/acceptance/3166/authenticator.mjs` (the
security key's stand-in, ported into `helpers.ts`); and the 129 record files and the `deep/approved/*` tags as
`ebf1e7f44` holds them.

## What the base holds

At `ebf1e7f44` (and unchanged at the base): 129 files named `TASTE.json` (111), `taste-call.json` (14) or `taste.json`
(4). 117 hold a call in `verdict`, `call` or `said`; 12 hold none. Who made each is prose in `who`, `by`, `delegated`
or `how`; none has a field the lane could read. Five tags under `refs/tags/deep/approved/` hold an `Approves:` line
naming a record (`425-taste`, `47602363a479`, `763c6ea5b865` twice, `887401a86a8f`, `a4b78ff2ef01`), naming
`tests/acceptance/{425,1174,399,422,1175}/TASTE.json`. Each carries a good SSH signature (`ssh-keygen -Y
check-novalidate`), but all five predate `.deepbuild/approvers` (#1326, November 9) and were signed by plain
`ssh-ed25519` keys that list does not hold. There is no `scripts/taste.mjs`, so every test below fails at its first
assertion on the base: the reply holds no JSON (AC1 to AC5, AC7, AC8), or the records hold no `maker` (AC6).
`BASE-FAILURE.txt` has the run.

## Files

| File | Criterion | What it proves |
|---|---|---|
| `ac1-lane-counts.test.ts` | AC1 `#3423.63f64cd6` | `lane` on the change: of the 129 records ebf1e7f44 held, 117 calls, 19 by a person, 98 by an agent, 4 of those signed; the lane passes. `lane --rev <merge base>` fails, naming a record with `maker-in-prose` |
| `ac2-reading-inconclusive.test.ts` | AC2 `#3423.88a9d39c` | `verdict`: an agent's right is INCONCLUSIVE with `recommended: right` before its deadline and `reads_as: default` after; a person's is PASS. `lane`: the agent's is a reading, never a call |
| `ac3-wrong-sends-back.test.ts` | AC3 `#3423.16f305aa` | `verdict`: an agent's wrong is FAIL, `sent_back: {by: reading}`, and the run prints "sent back by a reading" |
| `ac4-blind-job.test.ts` | AC4 `#3423.a83451d1` | `accept`: the session that made a commit the check ran on is refused, naming it; a job given only criterion and files is accepted; a job also given the diff is refused, naming `diff` |
| `ac5-by-you.test.ts` | AC5 `#3423.fca57d94` | `lane`: agent-made + `by: "you"` fails naming the field `by`; under a tag signed by an approvers-list key it is that person's call; under a tag by another key it stays a reading |
| `ac6-migration-diff.test.ts` | AC6 `#3423.997b049e` | every merge-base record against the change: only `maker` is added, every other member's value the same to the byte |
| `ac7-owner-list.test.ts` | AC7 `#3423.408915d5` | `list` holds exactly the 98 with issue, criterion and hashes; `list --check` fails a list missing one, naming it; `reopen` reopens an overruled record's issue through `gh`, naming the criterion |
| `ac8-week-counts.test.ts` | AC8 `#3423.4573dacd` | `week`: the three counts for a fixture's two weeks equal the hand count written in the file |
| `helpers.ts` | all | spawns the script, reads its JSON, makes scratch git repos and records, signs fixture tags, fakes `gh` |
| `BASE-FAILURE.txt` | all | the suite's run on the base: 16 of 16 fail at an assertion |
| `tsconfig.json` | | type check: `npx tsc -p tests/acceptance/3423/tsconfig.json` |

No `lane.json`: no file needs to run alone (no binary, timing or port). Fixture repositories live in the OS temp folder
and are removed at each file's end; nothing in this folder is named like a record, so the lane on the change never
reads a fixture.

## The surface: `node scripts/taste.mjs <command>`

One script, five commands and one option on `list`. Each prints one JSON object on stdout (nothing else on stdout) and
human lines on stderr. `--root DIR` is the repository (default: the working folder). Paths in and out are relative to
the root, with `/`.

### Records

- **The record set:** every file git tracks in the root (or, with `--rev REV`, in that commit's tree) named
  `TASTE.json`, `taste.json` or `taste-call.json`, except under a `twins/` folder anywhere below
  `tests/acceptance/<folder>/` (twins are planted programs, not records). At `ebf1e7f44` that is 129 files.
- **The call:** the record's first of `verdict`, `call`, `said` that is a string. It says wrong if it matches `/wrong/i`,
  otherwise right. No such member: the record holds no call yet.
- **Hashes:** every 64-hex string value, and every 64-hex key, anywhere in the record.
- **Issue:** the record's `issue` number, else the first number of its folder (`docs/evidence/<n>/`,
  `tests/acceptance/<n>…/`). **Criterion:** its `criterion`, else null. **Time:** `when`, else `at`.
- **The new member `maker`**, exactly one of:
  - `{"person": "<name>"}` — a person by name;
  - `{"agent": {"model": <string|null>, "session": <string|null>, "inputs": [<string>…]}}` — an agent with its model and
    the session it ran in (null only where a migrated record's own words don't say). `inputs` names everything the
    reading's job was given; a job's record has it, a migrated record may lack it.
- Optional on a reading: `deadline` (ISO 8601), the taste ask's deadline. `overrule`: `{"by": {"person": "<name>"},
  "when": "<ISO>"}`, an overrule recorded on the record.
- **Signed:** a tag under `refs/tags/deep/approved/` with a line `Approves: <record path>` and an SSH signature that
  verifies (`ssh-keygen -Y check-novalidate -n git`). It is an **approver's** when its key is on `.deepbuild/approvers`
  and counts by `readApprovals`' rules (a key type that needs a touch or a biometric, and the presence flag set in the
  signature). The list is read from git, never the working tree: at `--rev` when given, else at the merge base with
  `origin/main`, else at `HEAD` (a scratch repo has no remote).

### `lane [--root DIR] [--rev REV]`

```
{ "ok": bool,
  "records": [{ "file", "issue", "criterion", "call": "right"|"wrong"|null, "maker": "person"|"agent"|null,
                "reads_as": "call"|"reading"|"none", "whose": <name>|null,
                "signed": [{ "tag", "principal": <name>|null, "approver": bool }] }],
  "failures": [{ "file", "reason": "no-maker"|"maker-in-prose"|"agent-marked-yours", "field"?: <member> }] }
```

- `reads_as`: `none` with no call; `call` when the maker is a person (`whose` = that name), or an agent and an
  approver's signed tag names the record (`whose` = the signer's principal); otherwise `reading` (`whose` null).
- Failures, one per cause, each naming the file (also on stderr): a call with no `maker` and no prose maker is
  `no-maker`; a call whose maker is only prose (no `maker`, but `who`, `by`, `delegated` or `how`), or whose `maker` is
  not one of the two shapes, is `maker-in-prose`; an agent's call with `by: "you"` and no approver's tag naming it is
  `agent-marked-yours` with `field: "by"`.
- It finishes on this repository (about 135 records, 640 approval tags) well within the tests' 240 s limit per run: a
  throwaway stand-in this job used to check its fixtures took 150 s by verifying every tag one process at a time, so
  read only tags whose `Approves:` lines name a record.
- Exit 0 when `failures` is empty, else 1. AC1 counts from `records`: `maker` per call, and `signed` non-empty among
  the agent's (any good signature: the four on main are not an approver's, so they stay readings).

### `verdict --record FILE --now ISO [--root DIR]`

```
{ "file", "verdict": "PASS"|"FAIL"|"INCONCLUSIVE", "reads_as": "call"|"reading"|"default"|"none",
  "recommended": "right"|"wrong"|null, "sent_back": null | { "by": "reading"|"call", "file" } }
```

What a suite's taste test runs for its criterion. A call (`reads_as` as in `lane`) that says right is PASS, wrong is
FAIL with `sent_back.by: "call"`. A reading that says wrong is FAIL with `sent_back: {by: "reading", file}`, and stderr
carries the line `sent back by a reading: <file>`. A reading that says right is INCONCLUSIVE with `recommended:
"right"`, `reads_as: "reading"` while `--now` is before its `deadline` (or it has none), and `reads_as: "default"` at or
after it (a default you can overrule; the tests don't fix its verdict).

### `accept --record FILE --ran-on SHA --commits FILE [--root DIR]`

Whether a reading may stand. `--ran-on` is the commit the pictures' check ran on; `--commits` is the record's commits
table as JSON, `[{"sha": "<40 hex>", "session": "<id>"}]`, saying which session made each commit (recorded from the
hooks, never from a commit's text). Refused, each named: `{"reason": "session", "session"}` when the reading's
`maker.agent.session` made any commit reachable from `--ran-on`; `{"reason": "input", "input"}` for each of
`maker.agent.inputs` other than `criterion` and `files`. Prints `{ "accepted": bool, "refused": [...] }`; exit 0 when
accepted, else 1.

### `list [--root DIR] [--rev REV] [--check FILE]`

The readings put to the owner: every record with a call whose `maker` is an agent, grouped by issue.

```
{ "issues": [{ "issue": <n>, "readings": [{ "file", "criterion", "hashes": [<sha256>…] }] }] }
```

With `--check FILE` (a list in that shape) it prints `{ "missing": [<file>…] }`, the readings `list` holds that FILE
lacks, naming each on stderr, and exits 1 when any is missing, else 0.

### `reopen --repo OWNER/NAME [--root DIR]`

For each record holding an `overrule`, runs `gh issue reopen <issue> --repo <OWNER/NAME> --comment <text>` (the `gh`
on PATH, first three arguments in that order) with a comment naming the criterion and the record; prints `{
"reopened": [{ "issue", "criterion", "file" }] }`.

### `week --now ISO [--root DIR]`

```
{ "weeks": { "<YYYY>-W<ww>": { "person": n, "waiting": n, "defaults": n } } }
```

Each record with a call counts in the ISO 8601 week (UTC) of its time: `person` when it `reads_as` a call (whichever
way it says); among readings that say right, `defaults` when its `deadline` is at or before `--now`, else `waiting`.
A week with no call has no key.

## The migration (AC6)

The change gives each record with a call a `maker`, from that record's own words, and changes nothing else: every other
member keeps its value byte for byte (the test compares parsed values, strings exactly, so formatting and member order
are free). One more edit belongs to the same field: an agent-made record's `by: "you"` (11 on main) is the prose that
marks an agent's call as yours, which the lane refuses, so the migration drops it; the test allows exactly that and
nothing else. Records with no call stay byte for byte. The change is one approved change (Scope); its signed tag is the
guard's business, not a test here.

## Readings of the issue this job made

- **The merge base after landing.** Once the change lands, the merge base of a later branch holds `maker`, so AC1's
  failing read uses `ebf1e7f44` when the merge base already holds the field (its 129 records are the base's byte for
  byte), and AC6 then asks that the change leave migrated records as they are.
- **The four signatures.** The issue counts four agent-made records "signed for by a person". Those tags verify but
  their keys are not on `.deepbuild/approvers`, so under AC5's rule they stay readings. The contract therefore keeps
  `signed` (a good signature names it) apart from an approver's signature (it becomes that person's call).
- **Counts on main move with main.** 19/98/4 and the list's 98 are read from the records at the paths ebf1e7f44 held.
  A later edit there (an owed call made, a new approver's tag) changes them; that is the issue's own number to revisit.
- **Tags in the lane copy.** AC1's four signed records need the repository's `deep/approved/*` tags where the lane runs.

## Twins the implementer adds

The criteria's planted programs that are inputs are fixtures in the tests (AC4's job given the diff, AC7's list
missing a record). One needs implementation source this job can't know, so `twins.json` is left for the implementer to
add as a pure addition:

- `agent-read-as-person`, for `#3423.88a9d39c`: `twins/agent-read-as-person/scripts/taste.mjs`, the real script with one
  change: an agent-made call that says right reads as a person's call (`reads_as: "call"`, a `whose`, and PASS from
  `verdict`). Both AC2 tests must fail on it, the lane test naming `docs/evidence/9301/taste-call.json`.

## Run

`npx vitest run tests/acceptance/3423` from the checkout root (Node 24). Fixtures need `git` and `ssh-keygen`; no
network, model or GPU.
