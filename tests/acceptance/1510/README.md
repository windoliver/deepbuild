# Acceptance tests for #1510: an ask's text shown as data

Written first, blind, from issue #1510 (its text as of November 6, 2026, last edited 23:17 UTC: the opening, Scope, the 4 acceptance criteria, Proof and Depends on), `docs/technical-design.md` ("Threats, and what stops each one", its row "Approvals that drift": an approval binds to the exact plan you were shown; and the Dogfooding bullets on acceptance tests written by a job that never sees the work) and the base commit `c12a65bb` (`origin/main`: `deep inbox` of #24, the plans of #69, `deep status`'s last-turn calls of #668, the app's question card of #327, no #1510). The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
npm ci                                            # once, if node_modules is missing
npm run build --workspaces                        # the tests run the built CLI, packages/cli/dist/main.js, and the hub it starts
cargo build --locked -p deep-hook                 # the hub won't start without target/debug/deep-hook
npx vitest run tests/acceptance/1510/             # criteria 1, 3 and 4 through the CLI, from the checkout's root
npx tsc -p tests/acceptance/1510                  # type-check the TS tests
cargo test --locked -p deep-app --test acceptance_1510   # criteria 2 and 4 in the app's card
```

Node 24.22 or newer. No network. Each TS test file makes its own folder under `/tmp/dh24-*` (#24's `tempDir`: a socket path must fit in 104 bytes on macOS), runs every process with `HOME` there, so the hub's root is `<home>/.deepbuild`, and never touches your real `~/.deepbuild`. It stops only processes it started, by PID (#24's `cleanup`), never by name or port. Nothing is timed.

## The surfaces

The issue names `deep inbox`, `deep status`, "the other CLI commands", the record, and the app's question card "in a test of the card's text". The tests reach the code only through these:

- **`deep inbox` and `deep status`** (`packages/cli/dist/main.js`), run as child processes with `HOME` set, their **stdout kept as bytes** (`helpers.ts`, `deepBytes`), never decoded before the byte checks: the Proof is "the CLI's output read byte by byte".
- **The hub**, started as `deep hub run` (#24's `startHub`, its OS confirmation stubbed `cancelled`, which nothing here asks for), and its socket's `events.read` (#24's `events`) to read the record back.
- **The record**, seeded before the hub starts through `@deepbuild/record` and `@deepbuild/asks` (`openRecord`, `openAsks` with #69's `withPlans`, `raise` over a `core` connection; hook events appended over a `hook` connection), as #24's suite seeds it. `helpers.ts` has its own `seed` only so the hook events of a finished turn can be appended beside the asks.
- **The card's text**: `deep_app::question::Controller::present(events, ask, …)` on `ask.created` record events, then `Controller::lines()`, "every row's words, in reading order", the snapshot an assistive client reads. A Rust integration test against deep-app's public lib (`app/card.rs`), wired by the `[[test]]` entry `acceptance_1510` in `crates/deep-app/Cargo.toml`.

## Readings where the issue leaves a choice

- **"The call"**. An authority ask's question quotes the call (the issue's opening), and its plan's step runs it. The tests raise authority asks whose question is ``Run `<call>` in shop?`` and whose one-step plan's `does` is the call, so both the ask's row and its plan step's line in `deep inbox` carry it (the scope: "every line … from an ask, a plan or a call").
- **"Control byte"**: any byte 0x00–0x1F but `\n` (0x0A), DEL (0x7F), and the C1 controls U+0080–U+009F (UTF-8 `C2 80`–`C2 9F`). `\n` is the line end the criterion allows; `\t` is not a line end, so it is a control byte too.
- **"The escape as visible text"**: the scope writes it `\x1b`. The issue fixes no one spelling, so the tests take any of `\x1b`, `\u001b`, `\u{1b}`, `\e`, `\033`, `^[`, `␛` (U+241B) or `<ESC>`, case-insensitive (`helpers.ts`, `VISIBLE_ESC`). The return (`\r`) must not reach stdout raw (the control-byte check); its spelling is free.
- **"Prints both commands"**: on the ask's row, the line holding its handle, `git push --force` then `git status`, the visible escape after the first; and on its plan step's line, both commands and the visible escape. Nothing else about the row's layout is assumed beyond what #24 fixed.
- **"Newlines in a call kept to one line"**: an ask whose call is `git push --force\ngit status` has both commands on its row, and on its plan step's line. How the newline is shown is free.
- **"Fails naming the row"**: the control-byte check's message names, for each line holding one, the ask whose row it is (`the row of ask:<ULID>`) or whose row it is printed under (`a line under the row of ask:<ULID>`, a plan step), the line's number, the bytes found, and the line JSON-escaped.
- **`deep status`**. The scope names it, and at the base it prints a finished session's last turn's calls with their commands (#668, `packages/hub/src/status.ts`), collapsing whitespace but passing other control bytes through. `status.test.ts` holds it to criterion 1's byte check, both commands on the call's line and the escape visible. The other CLI commands at the base print no ask, plan or call text that a test could seed without inventing a surface, so none is tested.
- **The card's marks**. The scope: "invisible and direction-changing Unicode in a call as visible marks". Criterion 2 names U+202E; `app/card.rs` holds the same to the other bidi controls (U+202A–U+202D, U+2066–U+2069, U+200E, U+200F, U+061C) and the zero-width characters that join or break nothing visible (U+200B, U+2060, U+FEFF). For each, no line of the card holds it raw, and the question's line is the text before it, then a mark holding at least one character that is neither white space nor one of these, then the text after it: the mark is "at that place". Its spelling is the implementation's.
- **Emoji**. Criterion 4's emoji question holds a skin-tone modifier, a heart with its emoji presentation selector (U+FE0F) and a family joined by zero-width joiners (U+200D), as people type them; it must print unchanged in `deep inbox` and show unchanged in the card. So U+200D and U+FE0F are not among the characters the card must mark, and an implementation that marks every zero-width joiner fails criterion 4.
- **"The record keeps the bytes"**: the ask's `ask.created` question and its `plan.proposed` step's `does`, read back through the hub's `events.read` after the hub started and `deep inbox` ran, equal the strings raised, byte for byte; so do the U+202E, plain, Chinese and emoji questions.

## The contract per criterion

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`). Each test name starts with its ID.

| # | ID | Criterion | Tests | On the base |
|---|---|---|---|---|
| 1 | `#1510.54eb0445` | An ask whose call holds `git push --force\x1b[2K\rgit status` prints both commands with the escape as visible text, and `deep inbox`'s output holds no control byte but its line ends; on the merge base the raw bytes reach stdout, and the test fails naming the row | `inbox.test.ts`: no control byte in stdout; the ask's row shows both commands and the visible escape; its plan step's line does too; a call with a newline stays on the row and on the step's line. `status.test.ts`: `deep status`'s call line, the same | FAIL, all five: the raw `0x1b` and `0x0d` reach stdout on the ask's row and its plan step's line, and the message names `ask:<ULID>`; the newline splits the row; `deep status` passes `0x1b` raw |
| 2 | `#1510.6263c922` | A question with U+202E in the app's card shows a visible mark at that place, in a test of the card's text | `app/card.rs`: `ac2_*`, a taste question and an authority call with U+202E, and each of the 15 characters above | FAIL, all three: the card's question line holds U+202E (and each of the 15) raw, as the record holds it. deep-app builds on Linux arm64 and this test runs there (it opens no window), so it isn't INCONCLUSIVE off the Mac |
| 3 | `#1510.f4b3f47a` | The ask in the record holds the original bytes | `inbox.test.ts`: the record read back through `events.read` | PASS: the base keeps them; regression protection for an implementation that cleans text on the way in |
| 4 | `#1510.5fbd0a55` | Plain text, Chinese and emoji questions print unchanged | `inbox.test.ts`: each question's UTF-8 bytes on its ask's row; `app/card.rs`: `ac4_*`, each question a line of the card's text | PASS on the base (it changes nothing); it fails an implementation that escapes non-ASCII or marks emoji joiners |

No implementation was run: the passing side of each test is unverified until the implementation exists. `BASE-FAILURE.txt` holds the base run.

## Files

- `helpers.ts`: `deep` with its stdout as bytes, the seeding (asks quoting a call with its plan, questions, a finished turn), the control-byte check that names the row, `rowOf` and `VISIBLE_ESC`. Reuses `../24/helpers.ts` (temp homes, cleanup by PID, the hub, `events.read`).
- `inbox.test.ts` (criteria 1, 3, 4), `status.test.ts` (criterion 1 in `deep status`).
- `app/card.rs` (criteria 2, 4), wired as `acceptance_1510` in `crates/deep-app/Cargo.toml`.
- `tsconfig.json`: type-checks the suite as `../24`'s does.
- `BASE-FAILURE.txt`: the base run.
