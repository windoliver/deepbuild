# Evidence for #1342: one input to one card to a running project

Runs on this Mac (18 cores, 1-minute load about 200 to 250), Node v24.22.2, on 2026-11-14, against the change in this
branch. The blind suite is `tests/acceptance/1342/`, committed first; its world's one approved change came later, in a
commit of its own.

## The blind suite as written can't reach a card

Run unchanged, `lisbon.test.ts` failed all 7 tests at `lisbon.test.ts:94`: `deep "<words>"` was still waiting after
10 minutes, and no `brief.drafted` reached the record. The research job was on the runner, held:

```
{"job":"run:…","kind":"read","agent":"claude-code","account":null,"state":"waiting",
 "blocked":{"status":"BLOCKED","cause":"first reading","owner":"you","on":[],"account":"unknown",
 "why":"waiting for unknown's first window reading"}}
```

Every job on the runner waits for its account's first plan-window reading (`packages/runner/src/runner.ts`, `window`),
and after 30 minutes with none it raises a `runner.window` ask. The suites that run a runner job give the account a
sign-in and report one reading first (`tests/acceptance/1328/helpers.ts`, "A window reading with room";
`tests/acceptance/63/world.ts`). The 1342 world does neither, so no right program can pass it. That was disputed and sent
to a blind redraft (`50697f597` on `worktree-agent-a8877d81b96755549`), which confirmed the gap but chose another contract.

## The approved fix, and the runs

On 2026-11-14 the owner chose to keep this suite with the window reading in its world
(`tests/acceptance/1342/APPROVED-WORLD-FIX.md`). `helpers.ts`'s `World.open` now writes `.claude.json` with an
`oauthAccount` into the world's home and reports one `windows.report` with room, as 1328 does; nothing else in the
suite changed. Run once each on the branch after merging main:

| File | Result | Log |
| --- | --- | --- |
| `home.test.ts` (AC2, AC4, AC5, AC6, AC11, and the plants `asks-which-home`, `creates-before-approval`, `repo-public-by-default`, `empty-list-while-researching`) | 5 of 5 pass, 204 s | `home.txt` |
| `lisbon.test.ts` (AC1, AC3, AC7, AC8, AC9, AC10, AC12) | 7 of 7 pass, 736 s | `lisbon.txt` |

Before the fix was approved, the same reading came from a setup file outside the folder. That run found one bug of
this change: the research prompt listed your projects by name, so the Lisbon workspace's name ("five-day trip to
Lisbon") put that answer's words into the birthday job's prompt, and the played agent answered it with the Lisbon
answer (AC9). The prompt now lists projects by id alone. AC12 passed rather than reading INCONCLUSIVE, so the card
came within 5 minutes of Send at a load of about 200 on 18 cores.

## Unit tests

`packages/briefs/test/brief.test.ts`, 14 tests: each no-model check holds on a right draft and fails on one that breaks
it (a claim with no source, a quote not at its source, a page's line taken as a requirement, a task serving only a
source's text or nothing, a promise with no kind or an unknown one, a task waiting on itself or on nothing, an unknown
result kind, a fitting project that isn't yours).
