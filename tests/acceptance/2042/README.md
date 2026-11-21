# Acceptance tests for #2042: a hook payload deep-hook can't read meets the block entries it could match

Written first, blind, from issue #2042 (its report, Scope, the 5 checkbox criteria and Proof; no comments), the design
sections it links ([Hook protocol (deep-hook and the hub)], [Before each command], [Threats, and what stops each one])
and Dogfooding, `AGENTS.md`, and base commit `ee05e7257` (origin/main), by a job that never saw an implementation;
none existed, and no other branch, worktree, pull request or session's notes were read. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

| AC | ID | File (tests) |
|---|---|---|
| AC1 hub stopped, first-party entries: the `git push origin main` `PreToolUse` with a `tool_input` member nested inside 300 arrays is denied, naming the payload and the depth | `#2042.4ee175d8` | `payload-unreadable.test.ts` (1) |
| AC1, scope coverage (Scope bullet 1), hub stopped: `not json {`, the push payload with bytes that aren't UTF-8, the 2 MiB push payload cut short: each denied naming the payload (the cut one also as cut short); the 2 MiB push payload read whole is decided as the plain push is, never as unreadable | `#2042.4ee175d8` | `payload-unreadable.test.ts` (4); the last one's wrong program in `twins.json` |
| AC2 hub stopped: that payload cut after its first 40 bytes, and an empty stdin, each denied naming the payload as cut short or empty | `#2042.822bacc4` | `payload-unreadable.test.ts` (2) |
| AC3 hub running: each of those three payloads denied in the same words as with the hub stopped | `#2042.5b3849c3` | `payload-unreadable.test.ts` (3) |
| AC3, scope coverage, hub running: `not json {`, the non-UTF-8 push payload, the 2 MiB push payload cut short, each denied in the same words as with the hub stopped | `#2042.5b3849c3` | `payload-unreadable.test.ts` (3) |
| AC4 hub running: `git push origin main` whose `tool_input` holds a string with the lone escape `\ud800` is denied by the push entry, naming it; the same payload for `ls` runs | `#2042.aa23ca0b` | `payload-unreadable.test.ts` (1) |
| AC5 no `fail_closed` entry: each unreadable `PreToolUse` payload exits 0; first-party entries: each unreadable `PostToolUse` payload exits 0; each with the hub stopped and running | `#2042.c82ae59d` | `payload-unreadable.test.ts` (4); wrong program in `twins.json` |

IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's text in the live issue body. Each test's name
starts with its ID. Every criterion is decided by a vitest `expect` in the test file; setup and controls throw plain
`BLOCKED` or `INCONCLUSIVE` errors, so a broken setup or a loaded machine is never read as proof.

## What was read

- The issue (`gh issue view 2042 --comments`).
- `docs/technical-design.md`: the three linked sections, "Dogfooding" and "Wrong programs".
- At the base: `crates/deep-hook/src/main.rs` (`rules`, `guard`, `denials`, `forward`, `watchdog`, `unanswered`),
  `crates/deep-hook/default-rules.json` (`no-unreadable-push`, `authority-push`, `push-needs-ask`),
  `crates/deep-hook/tests/cli.rs`, `crates/deep-hook/Cargo.toml` (the `plant-*` features),
  `crates/deep-contracts/src/lib.rs` (`parse`: 256 levels, lone surrogates, non-finite numbers),
  `packages/hub/src/holds.ts` (`namedDefaults`, `gate`: how the hub words a push's denial),
  `packages/hub/src/server.ts` (`MAX_LINE`, the parsers), `scripts/proof-change.mjs` (`criterionId`),
  `scripts/proof-runs.mjs` (`atAssertion`, `twinsOf`).
- Suite `2204/` for the house format and helpers (adapted into `helpers.ts`), `1294/helpers.ts` for the ask settings.

## The surface

The real `deep-hook` (`target/debug/deep-hook`, built by the suite with `cargo build --locked -q -p deep-hook`) run as
Claude Code's hook entry runs it, `deep-hook claude-code PreToolUse|PostToolUse`, with each payload's bytes on stdin;
the real hub, `node packages/cli/dist/main.js hub run`; `~/.deepbuild/rules.json` in a temp `HOME` under
`/tmp/dh2042-*`; and the record, read through the hub's socket as the cli role (`events.read`). Nothing is imported
from the packages, nothing stands in for the hook or the hub, and no call is ever executed: each is a hook payload.

## Readings where the issue leaves a choice

- **"The first-party `fail_closed` push entry installed".** Every home's `rules.json` is
  `crates/deep-hook/default-rules.json` verbatim, as setup's `installRules` writes it first, with a
  `setup-finished.json` as setup writes it. Its one `fail_closed` entry about pushes is `no-unreadable-push`
  (`unread:push`, #1097's), the hole the report names one layer up. The file holds other `fail_closed` entries too, so
  Scope's "at least one `fail_closed` entry installed" holds.
- **Ask settings.** Each home also has a `config.json` holding `asks` as setup drafts them (the shape suites 1294 and
  1507 write). Without them the running hub holds a push with "no ask could be raised", naming no entry; with them it
  denies it as `DeepBuild denied this (guard push-needs-ask): ...`, which is how AC4's denial can name the entry.
- **"Denied".** What Claude Code reads as a denial of a `PreToolUse`: exit 2, or a `deny`/`block` decision on stdout.
  "Runs" is exit 0 with neither. Everything printed, stdout and stderr, is searched.
- **"Naming the payload and why".** Matched loosely, since the issue states the facts, not the words: `/payload/i`,
  and for the reason `/depth|nest|256|300|\blevels?\b|too deep/i` (nested), `/cut (short|off)|truncat|ends? (early|
  before|too soon)|incomplete|unfinished|unterminated/i` (cut short), `/empty|no bytes|nothing (on|in|came)/i` (empty).
  The scope payloads (`not json {`, not UTF-8) are held only to `/payload/i`: the Scope's four reasons don't say which
  one each is.
- **The payloads.** Claude Code's `PreToolUse` shape for a Bash call (`session_id`, `transcript_path`, `cwd`,
  `hook_event_name`, `permission_mode`, `tool_name`, `tool_input`, `tool_use_id`), `tool_input` being
  `{"command":"git push origin main", "nested": [[[…[1]…]]]}` with 300 arrays. "Cut off after its first 40 bytes" is
  that payload's first 40 bytes. The non-UTF-8 one has bytes `FF FE` inside a `tool_input` string; the 2 MiB one a
  `padding` member of 2 MiB of `x`, and its cut form is its first 1 MiB. AC4's has `"note":"half a pair: \ud800"`
  written as that escape. A `PostToolUse` adds Claude Code's `tool_response`.
- **"With the hub stopped".** A hub that ran in that home, answered a control (`ls` allowed, on a try it answered in
  time) and was stopped by its PID.
- **"With the hub running".** The hub must answer, not merely be up: a hub the machine gives no time misses the
  hook's 50 ms and deep-hook then decides as with it away, which isn't this reading. The hub can't name an unreadable
  call in its record, so a try of an unreadable payload counts only when the hub answered a readable `ls` in time
  (its `tool.before` found by `tool_use_id`, not marked `late`, tool.before@4) just before and just after it; else it
  is made again, 10 times, then `INCONCLUSIVE`. A readable call (AC4) counts when allowed, or when denied on a try the
  hub answered in time (2204's reading).
- **"In the same words" (AC3).** After the hub-running try, the hub is stopped and the same payload sent again in the
  same home. The lines naming the payload (`/payload/i`) must be the same, in order, both times; other lines (the
  hub's own, if any) are free.
- **AC4, "denied by the push entry, naming that entry".** With the hub stopped no shipped `fail_closed` entry holds a
  readable plain push (`authority-push` and `push-needs-ask` aren't `fail_closed`; `no-unreadable-push` holds only
  pushes the shell reader can't read), so a readable push runs, and this can only be read with the hub running. A
  control first: the same push written plainly must be denied naming a shipped push entry (`effect:push` or
  `unread:push`); the `\ud800` push must then be denied naming the same ones, and the `\ud800` `ls` must run.
- **AC5, "no `fail_closed` entry installed".** The shipped file with every entry's `fail_closed` set to `false`,
  set again once the hub has started: a starting hub installs a `fail_closed` entry of its own
  (`no-product-store-write`, `packages/hub/src/products.ts` `secure` through `guards.ts` `addGuards`), in the hub-stopped
  home too, since its hub ran first. A control reads `rules.json` just before each payload is fed and throws `BLOCKED`
  if it holds any `fail_closed` entry (redrafted on a dispute; the first draft fed these payloads with that entry
  installed).
  "Each unreadable payload" is all six used here: nested, cut to 40 bytes, empty, `not json {`, not UTF-8, 2 MiB cut
  short. Each is sent with the hub stopped and with it running; the `PostToolUse` ones with the shipped file. A
  failure lists each payload that didn't exit 0 with its event.

## Scope coverage asked by the session that started this job

Beside the criteria, Scope bullet 1 ("a payload deep-hook can't read is denied") is covered for a payload that isn't
JSON, one whose bytes aren't UTF-8, and an oversized one, hub stopped (tagged AC1) and hub running (tagged AC3). The
readable 2 MiB `git push origin main` was asked to "still be denied by the push entry"; with the hub stopped no shipped
entry denies a readable push (above), and with it running this machine's hub missed the hook's 50 ms for a payload of
about 1 MiB and up on every try (a probe at 0, 100, 500, 900, 1100 and 2048 KiB), so deep-hook decided as with the hub
away and the push ran, on the base, whatever the fix. So it is held only with the hub stopped, as "decided as the plain
push is, and not called unreadable": it passes on the base, and its wrong program, a reader that reads at most 1 MiB,
is a twin (`twins/README.md`).

## Open questions (not guessed, not tested)

- **AC4 with the hub stopped**: holding it would need a `fail_closed` entry that matches a readable push, which the
  shipped file doesn't have. If the owner meant a home with one, that is a redraft.
- **"A number with no value"** (`1e999`) is in Scope's list but in no criterion; not tested.
- **That an unreadable payload still reaches the hub or the spool** (Scope bullet 3) is in no criterion; not tested.
- **A 2 MiB readable push with the hub running**: the hub misses the 50 ms here (above), which is the hub's speed, not
  this issue.

## Run them

```sh
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$HOME/.cargo/bin:$PATH   # when node, npm and cargo aren't on PATH
npm ci && npm run build --workspaces                  # once: the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook                  # warm; the suite runs it again, a no-op when fresh
npx vitest run tests/acceptance/2042 --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/2042/tsconfig.json   # type-check
```

One file, so its tests run in order. Each makes its own home, starts its own hub and stops it by PID; temp folders
are removed after each test. A loaded machine can make a test `INCONCLUSIVE` (above); rerun it alone.

## Base results

`BASE-FAILURE.txt` is the one whole run at the base (18 tests: 13 fail, 5 pass, none blocked or inconclusive; 57 s,
at load average 113 to 94 on this shared Mac), then each twin's criterion laid over the base.

- **AC1 fails** (1), as it must, for the issue's reason: with the hub stopped the nested push payload exits 0 with
  nothing printed; the failure names the call. Its three scope tests (`not json {`, not UTF-8, 2 MiB cut short) fail
  the same way. The 2 MiB read-whole scope test passes, as it should ("still"); on `twins/reads-1-mib-at-most` it fails
  at its assertion (the readable push is denied as over 1 MiB).
- **AC2 fails** (2): the 40-byte cut payload and the empty stdin each exit 0, hub stopped.
- **AC3 fails** (3, and 3 scope): with the hub running and answering the controls around each try, every payload
  exits 0; the first assertion (denied) fails, before the same-words one.
- **AC4 fails**: the control passes (the plain `git push origin main` is denied `(guard push-needs-ask)` by the running
  hub), then the `\ud800` push exits 0 with nothing printed: deep-hook couldn't read it, matched nothing, and the hub
  refused it.
- **AC5 passes** (4), as "as today" says. Its two no-`fail_closed` tests were redrafted on a dispute (Readings);
  `BASE-FAILURE.txt` section 4 has their rerun: both pass on the base with the control passing, and both fail on
  the twin at their assertion. On `twins/denies-every-unread-payload` each of its four tests fails at its
  assertion, listing every payload by event (`PreToolUse` or `PostToolUse`) that exited 2.

The twins were run in copies of the clone (`cp -c`) with the twin's `main.rs` laid over, `-t <criterion ID>`. The
`reads-1-mib-at-most` run used the test file before AC5's failure message was made to list each payload; AC1's tests
were the same.
