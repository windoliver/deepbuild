# Acceptance tests for #1999: one plain sentence on every change, verdict and open item, from a template

Written first and blind, at base commit `a04378eb2`, from issue #1999 (Scope, one acceptance criterion, Proof), the
design and the base, before any implementation existed. The implementing agent does not edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- Issue #1999: "Every change, verdict and open item shows one plain sentence, filled from a template with no model call.
  It is the same sentence the return card leads with." Its one criterion and its Proof ("shown failing first"). Issue
  #367 (the return card), for context only: the card leads with "what changed in one plain sentence from the summary
  template", and "the agent's words never fill it".
- `docs/technical-design.md`: First-party extensions that ship on by default (the done-gate row: the agent's "still open"
  list becomes open items; the view row: "Each change is one line, led by a plain sentence", the return card's "what
  changed, in one plain sentence ... the agent's text folds behind one click"), States people see (the one word per
  state; every check code a person can see registers a sentence template; the page and the card use one list of plain
  words, `contracts/plain-words.json`, and "a lane fails a listed word on those surfaces"; "What a person reads holds no
  fixture text, tagline or internal kind name"), Open items as records, How we know version 0 works (Failing on an
  assertion; Wrong programs; Dogfooding). `docs/canvas-primitives.md`: Projections the canvas reads (`open_items`,
  `returns.summary`) and Closed enums.
- `AGENTS.md`.
- At the base, read only: `packages/hub/src/{server,core,rows,open-items,plant,verdict-chat}.ts` (`changes.read`, the App
  API's `changes/:id`; `test.verdict`; `deep_claim`; `deep_open_item`), `packages/verdicts/src/line.ts`,
  `packages/record/src/projections.ts` (`claims`, `verdicts`, `open_items`), `crates/deep-app/src/{plain,views}.rs`,
  `contracts/plain-words.json`.
- For conventions: `tests/acceptance/83/` (its helpers, `fixtures/claude.mjs`, `test.verdict`), `1460/`, `1998/`,
  `1014/`, `323/`, `567/`.

## How to run

macOS or Linux, Node 24.22 or newer first on `PATH`, cargo on `PATH`:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease cargo build --locked -p deep-hook   # setup's entries run it
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1999 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1999/tsconfig.json
```

- **Runs alone.** Each file starts real hubs (`deep hub run`) and runs `deep setup` against them, so the folder belongs on
  `scripts/lanes.mjs`'s one-at-a-time list (`alone`), beside #83's. The implementer adds it; this job edits nothing
  outside this folder. A world took about 5 s at the base on a loaded Mac; the suite builds four.
- **Folders and processes.** Every world is a fresh `/tmp/dh1999-*` (a socket path must fit in 104 bytes), `HOME` is
  `<tmp>/h` for every process, and nothing touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`. Processes are
  stopped by PID, and the hook entries the stand-in started by their process group; never by name or port.
- **No model, no network.** `PATH` for every child is the world's `<tmp>/bin`, Node's folder and the system folders only,
  so no real `claude` or `codex` is reachable; in `<tmp>/bin`, `claude`, `codex`, `launchctl` and `systemctl` are
  `fixtures/stub-bin.sh`, which logs each call to `<tmp>/bin/calls.log`. No child inherits a billing key, a model base
  URL, a forge token, or this process's `DEEP_*`, `CLAUDE*`, `CODEX*`, `GIT_*`, `GH_*`, `XDG_*` or `OTEL_*` variables.
  The claim has no pull request, so `changes.read` reaches no forge.
- **Vitest cache.** `--root` leaves `tests/acceptance/1999/node_modules/.vite/`; delete it before committing.

## The surfaces

Merged surfaces used as they are: `deep hub run` with `DEEP_HUB_TEST_VERDICT=1` and `DEEP_HUB_TEST_CONFIRM` (#83, #24),
`DEEP_HUB_PLANT` with the hub's closed plant list (#16), `deep setup` (#18), `deep-hook claude-code <event>` as setup's
entries run it, `deep mcp`'s `deep_claim` (#26, #28) and `deep_open_item` (#323), the hub's socket as the `cli` role with
the control token: `events.read`, `test.verdict` (#83) and `changes.read` (#34's `changes/:id`, #83's receipt: the page a
change opens to, which the app reads).

### Playing the agent

`fixtures/claude.mjs` is #83's Claude Code stand-in, copied with one provenance comment added: one process per session that runs each entry of
the user settings file as Claude Code does and starts the session's own `deep mcp`. It is Claude Code's side of the hook
contract, the boundary these tests don't own.

### The world

One world per test file run (two hub starts for `sentences.test.ts`, one per wrong program):

1. A fresh home, a hub (with the plant, for a wrong program), `deep setup` against it.
2. A Claude Code session: SessionStart, the prompt you typed, "Fix the cart total, then stop.", one Edit of `total.ts`
   in the session's folder (no git repo), `deep_claim` (attempt 1, at no commit), then `deep_open_item` with "the
   refund path has no test yet".
3. Two verdicts planted on the claim through `test.verdict`, as #83 plants them: FAIL, sent back round 1 of 3 (R1's
   check found "expected 10.80, got 10.70" at `total.ts:1`; R2 PASS), then PASS (R1 and R2 PASS).
4. The agent's own last words, "Quokka-7731 here: fixed every rounding case, trust me, all good.", in its transcript and
   its Stop's `last_assistant_message`; then its Stop. The world waits for `agent.stop` in the record.
5. `changes.read` for the claim; for `sentences.test.ts`, the hub stops, starts again on the same home with no plant, and
   `changes.read` again. Anything on the way that goes wrong (setup, a refused tool, a hub that won't start, a record
   without both planted verdicts) is `BLOCKED`, never the criterion's failure.

### Pinned here: the implementation must provide these

The issue and the design name the kinds (a change, a verdict, an open item), the template and "no model call", but no
method or field. These are this job's names, the narrowest the base's conventions allow: the change's page already
reads `changes.read`, which already lists the claim's verdicts.

1. **`change.sentence`**: `changes.read`'s `change` (for `{ id: "claim:<id>" }`) carries `sentence`, the change's one
   plain sentence.
2. **`change.verdicts[i].sentence`**: each verdict row `changes.read` already lists for the claim carries `sentence`,
   that verdict's one plain sentence; the row keeps its `id` and `outcome`.
3. **`change.open_items`**: `changes.read`'s `change` lists the open items of the claim's task (the `open_items`
   projection's rows whose `task_ref` is the claim's), at least those still open, each with `text`, the item's text as
   the record holds it, and `sentence`, its one plain sentence.
4. **Plants** (names for `DEEP_HUB_PLANT`, added to `packages/hub/src/plant.ts`):
   - `sentence-from-agent-text`: the change's sentence is the agent's last message (its Stop's
     `last_assistant_message`, or the transcript's last assistant text), as a card that summarizes what the agent said.
   - `sentence-from-model`: each sentence is written by a headless agent call, `claude -p` (or `--print`) with the
     record's fields in its prompt, as DeepBuild's own jobs run Claude Code, and its answer shown.
   - `open-item-no-sentence`: `open_items` lists the item with its `text` and leaves out its `sentence`.

### What "one plain sentence, from the template, with no model call" is read as

The design fixes no wording for any of the three sentences, so each judge checks the narrowest properties the issue and
the design make checkable (`helpers.ts`, `sentenceFailures` and the three kinds' judges):

- **One sentence.** A non-empty string on one line, with no white space at either end, ending once in `.`, `!` or `?`
  (closing quotes or brackets may follow) and holding no other sentence end, that is no `.`, `!` or `?` followed by white
  space. A dot inside a name, as in `total.ts` or `10.80`, is no end.
- **Plain.** None of the internal words of `contracts/plain-words.json` (as whole words, in any case, or plural), which
  the design says the page and the card use and a lane fails ("verdict" is "result", "claim" is "says done", "commit"
  is "saved change", "session" is "agent at work"); and no record handle such as `claim:01K…`. The words of States
  people see are not on that list and stay as they are.
- **From the template, never the agent's words.** No sentence holds the agent's last words: its marker `Quokka-7731` or
  its phrase "fixed every rounding case". The open item's text came from the agent's `deep_open_item` and is the
  record's field, so quoting it is the record's words.
- **From the record's fields.** The change's sentence names the one file the change wrote, `total.ts` (the return card's
  "what changed"; the base's `produced.files` already lists it). Each verdict's sentence names its state with its word
  from States people see: "sent back" for the FAIL verdict, "PASS" for the PASS one. The open item's sentence holds the
  item's text as the record holds it, "the refund path has no test yet", so a person reads what is open.
- **The same on replay.** Each sentence reads byte-for-byte the same after the hub restarts on the same record, as a
  sentence built from the record's fields by a template does.
- **No model call.** Every kind shows a sentence, and `<tmp>/bin/calls.log` holds no headless agent call from the hub's
  first start to the last read: no `claude` call with `-p` or `--print`, and no `codex exec` or `codex e`. A stub
  answers such a call with a plausible sentence, "Changed total.ts.", so a sentence from a model can look right and only
  the log shows where it came from. What setup runs (at the base, `claude plugin list --json` and `claude auth
  status`) and any version probe are no model call.

## Criterion to tests

ID as `criterionId` in `scripts/proof-change.mjs` computes it: the first 8 hex digits of SHA-256 of the criterion's
text, trimmed, white space collapsed. A test headed `(wrong program)` runs the plant and expects the judge to fail,
naming what it gets wrong.

| Criterion | ID | Tests | Wrong programs it fails on |
|---|---|---|---|
| AC1 Every change, verdict and open item shows its one plain sentence, from the template, with no model call | `#1999.e525e035` | `sentences.test.ts`: a change (names `total.ts`), each verdict (sent back, PASS), an open item (its text), each one plain sentence, none of the agent's words, the same after a restart; the sentences made with no headless agent call | the base (no sentence on any kind); `wrong-programs.test.ts`: `sentence-from-agent-text` (names `Quokka-7731`), `sentence-from-model` (names the `claude -p` call), `open-item-no-sentence` (names the item) |

7 tests. At the base all 7 fail: the 4 of `sentences.test.ts` at their assertions, since `changes.read` gives no
`sentence` and no `open_items`; the 3 wrong programs `BLOCKED`, since the base's hub refuses a plant its list doesn't
name and never starts (BASE-FAILURE.txt).

## Disputes and assumptions a redraft may revisit

1. **The surface.** "Shows" is read through the hub's `changes.read`, the read the change's page draws from, not
   through the app's window: the app at the base draws a claim only as "Claim <id>", the return card is #367's (R2),
   and the issue says other views and cards use the sentence once it lands. A redraft that judges a drawn page would
   need ids this job didn't pin.
2. **"The same sentence the return card leads with"** isn't exercised: no return card exists at the base.
3. **Naming the file.** "What changed" is read as the files the change wrote, as the return card's turn view shows the
   parts a turn changed. A change sentence built only from the task's title, or one that counts files without naming
   them, fails here.
4. **Plain words** are applied to the whole sentence. An open item whose own text holds a listed word would fail; this
   world's item holds none.
5. **Two verdicts on one claim**, FAIL then PASS, are planted states (`test.verdict`), as #83's tests plant them; the
   real gate would keep a claim with an open item from PASS. Nothing here reads which verdict is current.
6. **Other agents' words.** Only Claude Code is played; a Codex session's last message is read by the same template.

## Files

`helpers.ts` (homes, the hub, its socket, the session through the stand-in, the world, the judges),
`sentences.test.ts` (AC1, the shipped hub), `wrong-programs.test.ts` (AC1's three wrong programs),
`fixtures/claude.mjs` (#83's Claude Code stand-in), `fixtures/stub-bin.sh` (adapted from #83's),
`tsconfig.json`, `BASE-FAILURE.txt`.
