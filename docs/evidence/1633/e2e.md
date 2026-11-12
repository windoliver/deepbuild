# Manual e2e for #1633

The run, on d48117c9 (this PR's head), 2026-11-11:

- Node 24.22.0, Linux aarch64 (Spark).
- The real hub runs as a process, with the real deep-hook (an `env-plants` debug build) for every Claude Code hook.
- The real `deep` CLI does the inbox steps (`deep inbox`, `deep inbox answer`).
- Each scenario runs in a temp world with HOME set to it (#322's world, reused).
- GitHub's answers are recorded (DEEP_HUB_TEST_GITHUB, #323's `prAnswers`): PR 21 with one review thread T (PRRT_kwDOAcmeE2E01) by maya, and the session's own account `you-gh`. The answers change between stops.

The driver is `e2e.test.ts.txt` beside this file. It's saved as text so no suite picks it up. Copy it as `e2e.test.ts` to a folder three levels under the repo root, then run:

    E2E_OUT=e2e-reviewer.txt E2E_OWN_OUT=e2e-own-account.txt vitest run --root <that folder> e2e.test.ts --testTimeout=900000

Both scenarios passed (2 of 2). Their transcripts are `e2e-reviewer.txt` and `e2e-own-account.txt`, with home paths redacted.

## Screenshots

`render.mjs.txt` renders each step of a transcript as a terminal page and screenshots it with headless Chrome. A step is a claim, or one `$` command. The pages show the captured output unchanged. The driver itself shortens each item's `text` with "…".

**`screens/reviewer-01.png` to `reviewer-14.png`: a reviewer resolves T, then T is unresolved (AC1, rules 1–3).**

| Screen | Step | What it shows |
|---|---|---|
| 01 | setup | The PR is opened. |
| 02 | claim 1 | T unresolved: the item opens, and one `ask.created`. |
| 03 | inbox | The ask. |
| 04 | Closes | REFUSED, naming T. |
| 05 | claim 2 | Maya resolved T: the item closes. |
| 06 | inbox | The same ask (known main behaviour). |
| 07 | claim 3 | T unresolved: the item opens again, same ID, as `open_item.opened@4` with `replaces` = the claim-2 closing's event ID. Still one `ask.created`. |
| 08 | inbox | The same ask. |
| 09 | Closes | REFUSED, naming T. |
| 10 | answer | `deep inbox answer … accept` closes the item with "your answer: accepted". |
| 11 | Closes | ALLOWED. |
| 12 | inbox | Nothing needs you. |
| 13 | claim 4 | T still unresolved: the item stays closed, no new ask. |
| 14 | inbox | Nothing needs you. |

**`screens/own-01.png` to `own-11.png`: the session's own account resolves T (rule 4).**

| Screen | Step | What it shows |
|---|---|---|
| 01 | setup | The PR is opened. |
| 02 | claim 1 | `you-gh` resolved T: the item stays open with `resolved_by: you-gh`, and 0 asks. |
| 03 | inbox | Nothing needs you. |
| 04 | Closes | REFUSED, naming T. |
| 05 | claim 2 | T unresolved: the item is revised once without `resolved_by`, and one `ask.created`. |
| 06 | inbox | The ask. |
| 07 | claim 3 | Still one ask. |
| 08 | inbox | The same ask. |
| 09 | answer | The answer closes the item. |
| 10 | Closes | ALLOWED. |
| 11 | inbox | Nothing needs you. |

Every claim's verdict is BLOCKED for one reason only: `review: inherited: also fails on the merge base`. That's the test world's own `review` check, and it's why the stop replies say "review still unmet". T is never among the verdict's reasons.

## Validation by separate agents

Each round, two fresh agents each checked one scenario's screenshots. They saw only the images and the issue's expected behaviour, never my reading of them.

**Round 1.** Every expectation passed. The agents found these defects in the screenshots:
- The driver cut the stop reply short.
- `replaces` couldn't be traced to the closing, because no event IDs were shown.
- Claim 4 still said BLOCKED, with nothing to explain why.
- Nothing showed the inbox after the answer.

The fix: the driver now prints the full reply, each event's ID, the verdict's outcome and reasons, and the inbox after the answer.

**Round 2.** Every expectation passed, but one was NOT SHOWN. Only the inbox showed that no second ask was raised, and nothing on screen tied the item hash to T. The fix: the driver now lists each claim's `ask.created` events by ID, and the start of each item's text.

**Round 3.** Both agents passed every expectation, with nothing NOT SHOWN or contradicted. The defects left are outside this change:
- The CLI's inbox column layout.
- The refusal's `”.` punctuation.
- "next: you" in the stop reply, which comes from the inherited `review` check.
- The driver's deliberate "…" shortening of each item's text.
