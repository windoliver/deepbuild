# Acceptance tests for #2563: every option ID an ask can carry answers it when typed back as `deep inbox` printed it

Written first and blind, at base commit `8bfb6a633`, from issue #2563, the design and the base, before any
implementation. The drafting job saw nothing of the work: no other checkout, branch, pull request diff or commit past
the base. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding). There is no taste criterion, so no `TASTE.json`.

## What was read

- **Issue #2563**, its live body read with `gh api repos/windoliver/deepbuild/issues/2563` on 2026-11-20: the revision
  with `updated_at` 2026-11-20T10:02:57Z, no comments. The criterion IDs in `criteria.json` are computed from that body
  (`scripts/proof-change.mjs`, `criterionId`).
- `docs/technical-design.md`: How we know version 0 works (Dogfooding, Tests written first, Wrong programs).
- At the base: `packages/hub/src/inbox.ts` (the `answer with` line and the argument check), `packages/hub/src/visible.ts`
  (#1510's escapes), `packages/hub/src/human-answers.ts` (the wrong-option refusal), `packages/asks/src/index.ts`
  (`raise`, and the fold "this session keeps asking"), `packages/hub/src/core.ts` (deep_ask raises through the asks
  core), and the suites `2199` (README, helpers, inbox, judges: this suite's shape), `1463`, `16` and `26` (the
  helpers imported).

## How to run

Node 24.22 or newer, `git` and `/bin/sh` on the machine, `node_modules` installed (`npm ci --ignore-scripts`), the
workspaces built (`npm run build --workspaces`) and `deep-hook` built (`cargo build --locked -p deep-hook`): the tests
run the built CLI (`packages/cli/dist/main.js`) and are BLOCKED, by a thrown error, without either. From the checkout's
root:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2563 --no-file-parallelism --reporter=verbose
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2563 judges     # the judges alone, no hub
node node_modules/typescript/bin/tsc -p tests/acceptance/2563/tsconfig.json --noEmit
```

- **What it starts and stops.** `inbox.test.ts` makes one world (#1463's `makeWorld`): a temp home and a repo under a
  short `/tmp` folder, a real hub (`deep hub run`) and one `sleep` stand-in per session. Every process runs with `HOME`
  there, so nothing touches the real `~/.deepbuild` or `~/.claude`. Before it, a probe opens a record and the asks core
  in a second temp home with no hub (#26's `seed`). It stops only the processes it started, by PID (#16's and #26's
  `cleanup`), and removes its folders. No network, no model.
- **Linux and macOS.** Nothing here is Mac-only; the base run was on macOS (Darwin 27.2, arm64). `/bin/sh` is the
  machine's: bash 3.2 in POSIX mode on macOS, dash on Debian. `deep inbox answer` needs the OS to confirm you: the hub
  runs with `DEEP_HUB_TEST_CONFIRM` naming a file that says `confirmed`, #24's stand-in, as #1463's world sets it.
- **Time.** About 20 s on a machine at load 140.
- **Cache.** Run with `--root tests/acceptance/2563`, vitest leaves `tests/acceptance/2563/node_modules/.vite/`;
  delete it before committing.

## The surface

The tests reach the code only through surfaces the issue names: **`deep inbox`**, run as the built CLI;
**`deep inbox answer <handle> <option>`**, typed into `/bin/sh -c` as a person types it into a shell; **the hub's
record**, read through `events.read` on a `cli` connection, for "the ask is answered with that option"; and **raising
an ask**, through the real asks core (`packages/asks`, `raise`, source `deep_ask.choice`), which is the call an agent's
`deep_ask` reaches (`packages/hub/src/core.ts`) and the one #1463's world raises its asks through. `deep inbox --json`
is read only to check the Given (the ask is open with the option). No hub or CLI module is imported; the asks core and
record are opened by #26's `seed` with the hub stopped, as #1463 does. Imported from other suites: `../1463/helpers.ts`
(`makeWorld`, `deep`, `allEventsOf`, `jsonRows`, `shown`, `cleanup`), `../16/helpers.ts` (`run`, `childEnv`, `NODE`,
`CLI`), `../26/helpers.ts` (`seed`, `makeHome`), `../2199/helpers.ts` (`blockOf`: what `deep inbox` prints with one ask).

**The fixture** (`helpers.ts`, `CASES`): one `choice` ask per kind of ID the issue names, each in a session of its own
(open asks piling up in one session fold under the asks core's "this session keeps asking", which this suite keeps out
of the way). Each ask's other option is a plain ID and its default, so the default sentence prints the plain option's
label. No question holds its hard ID.

| Kind (the issue's cases) | Hard option (ID, label) | Plain option, the default |
| --- | --- | --- |
| starts with `-` | `-fast` "Fast build" | `normal` "Normal build" |
| holds a control character | `esc\u001bkey` (ESC) "Escape key" | `enter` "Enter" |
| holds an invisible character | `zero​width` (zero-width space) "No visible gap" | `plain` "Plain space" |
| holds a space | `title case` "Title Case" | `lower` "Lower case" |
| holds a comma | `red, green` "Red and green" | `blue` "Blue only" |
| shaped like `x (y)` | `wide (padded)` "Wide with padding" | `narrow` "Narrow" |

A probe raises each of these through the asks core first, in a home of its own, with a control ask (`serif`/`sans`)
that must raise, or the probe proves nothing. The world then holds an open ask for each case the core let be raised.

## Criteria to tests

| # | ID | Test (in `inbox.test.ts`) | On the base |
| --- | --- | --- | --- |
| 1 | `#2563.644f8f08` | an option ID that starts with -, typed back into a shell as deep inbox printed it, answers its ask with that option | FAIL: the one printed form, `-fast`, typed back is a usage error (exit 2) and the ask stays open |
| 1 | `#2563.644f8f08` | … that holds a control character (ESC) … | FAIL: the line prints `esc\x1bkey`, which no shell reads as the ID; no printed form |
| 1 | `#2563.644f8f08` | … that holds an invisible character (zero-width space) … | FAIL: the line prints `zero\u{200b}width`; no printed form |
| 1 | `#2563.644f8f08` | … that holds a space … | FAIL: `title case` unquoted is two arguments; no printed form |
| 1 | `#2563.644f8f08` | … that holds a comma … | FAIL: `red, green` unquoted is two arguments; no printed form |
| 1 | `#2563.644f8f08` | … that is shaped like x (y) … | FAIL: `wide (padded)` unquoted is a shell syntax error; no printed form |
| 2 | `#2563.1937a1ef` | an option ID an ask may not carry is refused when the ask is raised, naming the ID and why | PASS: the base narrows nothing, all six raise, so no refusal is judged (below) |

`judges.test.ts` holds the shell model, `printedForms` and the refusal judge to right and wrong sample texts, and the
shell model to `/bin/sh` itself; it carries no criterion tag and passes at the base. `BASE-FAILURE.txt` is the base
run, whole, with the home folder written `/Users/<you>`.

## How "as `deep inbox` printed it" is found and typed back

The issue leaves the format open (quoting, escapes, a different separator, or narrowing the IDs). So the test doesn't
look for any format. For each case:

1. `deep inbox` runs; its output is text. The ask's block is #2199's `blockOf`: the line holding its question and the
   lines under it, up to the next fixture ask's question, a `decided for you` line or the count sentence.
2. **A printed form** of the option is any run of characters on one line of that block, with no blank at either end,
   that a POSIX shell reads as the option: the one argument equal to the ID, or `--` and then it (POSIX's utility
   syntax guideline 10, the conventional end of options). What a shell reads is `shellWords`, a model of POSIX.1-2024
   quoting: blanks split, `\` escapes, `'…'`, `"…"` (with its four escapes) and `$'…'` (with `\a \b \e \f \n \r \t \v
   \\ \' \"`, `\cX`, `\xHH` and `\ooo`, which give bytes read as UTF-8). Anything the shell would do more with than
   quote (an operator, `$` expansion, a backquote, a glob, a brace, a leading `#` or `~`, an unclosed quote, an escape
   POSIX doesn't define such as `$'​'`) reads as nothing, so it never counts as a form. Runs longer than 8 bytes
   per byte of the ID, plus 6, aren't looked at.
3. Each form found is first given to `/bin/sh -c 'printf "%s\0" <form>'`; if the real shell doesn't read the same
   argument as the model, the test throws BLOCKED (the model is wrong, not the program). Then it is typed back:
   `/bin/sh -c 'exec "$0" "$1" inbox answer <handle> <form>' node packages/cli/dist/main.js`, with the form pasted
   verbatim into the command line, so a form that needs quoting must carry its own.
4. The forms are tried in printed order until one answers. A form refused leaves the ask open, so the next is tried. The
   test passes when the hub's record holds exactly one `ask.answered` on the ask's handle whose `answer` is the ID,
   `deep inbox answer` exited 0, and the ask has left `deep inbox`. It fails when the block holds no form (naming the
   block), or when every form was refused (naming each typed command and its output), or when the ask was answered
   with anything else.

Why this is sound either way: a fix that prints a form any POSIX shell reads as the ID, and makes `deep inbox answer`
take that argument, passes, whatever the format; a fix that prints a form no shell reads as the ID, or prints one the
command then refuses, fails. Labels, the question and the default sentence can't pass for a form unless they really
type back to the ID, and the record, not the output, says what was answered. What it does not accept: a form split
across lines, a form in a shell other than POSIX sh (a zsh- or bash-4-only escape such as `$'​'`), and words
between the handle and the option other than `--`.

## Criterion 2, and its condition

The issue leaves open whether IDs are narrowed. Both tests hold either way:

- **An ID the asks core refuses when the ask is raised** is out of criterion 1 ("every ID an ask can carry"): that
  case's criterion-1 test then passes only if the refusal names the ID and why, criterion 2's judge.
- **Criterion 2's test** holds every refusal the probe met to `refusalFailures`: the refusal holds the ID, as itself or
  with each control or invisible character written as `\x1b`, `\e`, `\u001b`, `\u{1b}`, `U+001B` or `<U+200B>` (letters
  keep their case), and, with the ID taken out, a reason of at least three words. An ID the core lets be raised is one
  an ask may carry, so criterion 1 holds it to answering. On the base nothing is narrowed: the test passes, as the
  issue's "if the IDs are narrowed" allows, and prints each case as raised. It still requires the control ask to raise
  and every case to have been tried.
- "Refused when the ask is raised" is read at the asks core's `raise`, which deep_ask and every core-raised ask go
  through. A narrowing made only in a narrower surface (deep_ask's tool schema alone, say) leaves the core raising the
  ID, and then criterion 1 requires it to answer.

## The plant

None is required. Criterion 1's wrong program is the merge base, which fails all six tests for the reason the issue
gives. Criterion 2 has no wrong program to run at the base, since nothing is refused there; its judge is held to
refusals that lack the ID, lack a reason or name the label instead (`judges.test.ts`, "refusalFailures"). **What was
not run to a pass here:** a criterion-1 test passing on a real fix, since none exists at the base. What was run: the
whole answering path with a plain ID (the dash ask's `normal`, found by `printedForms` and typed back as `'normal'`
through `/bin/sh -c`) answered the ask in the record, in a throwaway test deleted after one run; and the judges find
forms a fix might print in two different formats.

## Pinned here, where the issue is silent

1. **"As `deep inbox` printed it"** is any printed form as above, in the ask's block; a person may pick it out of the
   line but not change a character of it.
2. **"Runs with the ask's handle and that option"** is a POSIX shell command line, `deep inbox answer <handle> <form>`,
   as a person types it; the handle is the fixture's (`ask:` and letters, safe unquoted).
3. **"The ask is answered with that option"** is the record's one `ask.answered` with `answer` equal to the ID, byte
   for byte, exit 0, and the ask gone from `deep inbox`.
4. **The hub's refusal after a wrong option** ("its options are thin, thick"), named in the issue's cases, has no
   criterion and no test here.
5. **The kinds** are the issue's four; the comma kind's `x (y)` shape gets a case of its own.
