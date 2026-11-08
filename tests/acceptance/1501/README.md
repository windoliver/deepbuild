# Acceptance tests for #1501: a session past its facts keeps the floor

Written first, blind, from issue #1501 (its text as of November 7, 2026: the opening, Scope, the 4 checkbox
criteria, Proof, Overlaps and Depends on; it has no comments), the design sections it links ([Adapters] "Facts as
data", [Threats, and what stops each one]) and those around them ([Before each command], [Hook protocol (deep-hook
and the hub)]), and base commit `2bba2a50` (main), by a job that never saw an implementation of #1501. The
implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The issue has 4 checkbox criteria, AC1 to AC4 in the body's order. All 4 are covered here, and Scope's "the health
reading says the floor still holds" too.

## How to run

With the repo's Node (`.node-version`) and Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the tests run the built CLI, packages/cli/dist/main.js
cargo build --locked -q -p deep-hook     # warm the binary so a beforeAll doesn't time out under load
npx vitest run --root tests/acceptance/1501 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1501/tsconfig.json
```

- `--no-file-parallelism`: every file starts real hubs.
- Every test makes its own folders under `/tmp/dh1501-*` (a socket path must fit in 104 bytes on macOS), runs every
  process with `HOME` there, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`. It stops only
  processes it started, by PID (`helpers.ts`, `cleanup`). A child never inherits this process's billing keys or
  `DEEP_*`/`CLAUDE*`/`GIT_*`/`AWS_*` settings; git in the temp repo runs with `core.hooksPath=/dev/null`.
- Nothing needs the network, a model or a `claude` binary. No planted call is ever run: deep-hook only decides.

**Base run: not yet recorded.** This job wrote the files while the machine's load was far above the limit for
builds and test runs, so the suite was type-checked (no errors) but not run; no `BASE-FAILURE.txt` exists yet. Until
the base run is saved, nothing here counts as shown failing first (AGENTS.md, Proof).

## The surface under test

- **deep-hook** (`target/debug/deep-hook`) run as a hook entry runs it: `deep-hook claude-code <event>`, the hook
  JSON on stdin, `HOME` the test's. A PreToolUse is denied by exit 2 or a `deny`/`block` decision, allowed by exit 0
  with neither (as #316's and #317's suites read it).
- **`deep hub run`** with `HOME` the test's, its ready line, and its record read with `events.read` on a `cli`
  connection (each event's `kind`, `session`, `data`), as #16's and #18's suites read it.
- **`<home>/.deepbuild/rules.json`**: the shipped `crates/deep-hook/default-rules.json` entries, plus three of this
  suite's own (none fail_closed): a watch, a warn and a block entry, each `shell:echo <word>-<mode>*`.
- **`<home>/.deepbuild/config.json`'s `hub.address`** (#16), pointed at a forwarder (below).
- **The session's version**, as #18's suite defines it: the `version` every entry of its transcript carries, at
  `<home>/.claude/projects/<cwd, each non-alphanumeric character as ->/<session>.jsonl`. The fixture transcript holds
  one earlier turn, every entry stamped with the session's version: `9.9.9` for the session past its facts (the
  test checks the shipped facts don't list it), the newest of the facts' `versions` for a listed one.
- **`DEEP_HUB_TEST_FACTS`** (#18's seam) for one wrong program (AC2).

## Readings where the issue leaves a choice

- **"Naming the guard"**: the denial says `guard <entry name>` and carries that entry's `reason` (Scope: "in its own
  words"). Both the hub's words and deep-hook's own say `(guard <name>…)` at the base. AC1 accepts any fail_closed
  entry so named; AC4 requires the very entry under test.
- **"With the hub up" means the hub decided.** deep-hook counts a hub that hasn't acknowledged within 20 ms as away
  and then applies the fail_closed entries itself (#315), which would deny AC1's calls on the base under load and
  pass this suite for the wrong reason. So deep-hook reaches the hub through a forwarder at the address setting that
  keeps each connection's lines, and a hub-up decision counts only when what deep-hook printed is the reply the hub
  wrote on that connection (`helpers.ts`, `hubDecides`). A call deep-hook decided alone is tried again with a fresh
  `tool_use_id`, up to 10 times, then the test fails `INCONCLUSIVE`, never passes. The one exception is the kill:hub
  entry's `kill -9 <hub PID>`: deep-hook reads the hub's PID off the peer of the address, which through a forwarder
  is the test process, so that call goes to the hub's own socket and counts once deep-hook's output isn't its own
  hub-away denial (its words at the base, "while the hub doesn't answer").
- **"Recorded"**: the call's `tool.before` in the hub's record names the entry in `data.matched` (#304's suite).
- **"A warn entry adds nothing"**: allowed, no `additionalContext`, and the entry's reason nowhere in the output.
- **"A Stop isn't held" / "holds the stop"**: read off the hub's acknowledgement of the Stop, as #19's suite reads
  it: `hold_until_ms: null` is not held, a number is held. The Stop follows a turn whose PostToolUse the hub
  acknowledged, so a gated session's stop would be held for its line (#83); AC3 shows it held on a listed version.
- **"A hub that ends watch-only altogether"** (AC2's wrong program): the same hub given facts that list `9.9.9`
  (`DEEP_HUB_TEST_FACTS`: Claude Code's shipped facts with `9.9.9` added, its payload schema the newest listed
  version's, beside a verbatim copy of every other `adapters/*.facts.json`, since the hub builds its whole adapter
  registry from that folder), so it gates the session as any listed one. It holds the stop, and the test expects AC2's check to fail there. Built as
  data, so the implementer writes no plant.
- **"Behaves as it does on the merge base"** (AC3), read as the base's behaviors this change could leak into, on the
  newest listed version with the hub up: AC1's Edit, Write and `deep off` denied naming their guard; this suite's
  block entry denied naming it; its warn entry's reason added; its watch entry's call run and recorded; the stop of
  a turn that did work held; and `rm -rf "$X"/*` held for the gate to stage or ask (#347), not answered at once. The
  test reads the delete's hold off the acknowledgement and doesn't wait for the gate.
- **"Hub stopped"** (AC4): the hub stopped by its PID and the forwarder closed, so nothing answers at the address.
  The comparison runs in the same home and session as the hub-up half. The token file the hub wrote at launch is
  kept (a stand-in is written if the hub removed it), as #317's suite reads "left from the hub's last launch".
- **"The same calls … a test fails naming the entry"** (AC4): one representative call per shipped fail_closed entry
  (`helpers.ts`, `representatives`; AC1's four calls are among them), chosen by reading the base's matcher and the
  suites that prove each entry (#316, #317, #1156). A shipped fail_closed entry with no representative fails the
  test `INCONCLUSIVE`, naming it. An entry its call doesn't make deep-hook deny with the hub stopped fails, naming
  the entry ("must be denied … as it is today"); the base run must confirm each representative holds there. The
  kill:hub entry has no hub-stopped half (there is no hub process to aim at); its hub-up half is checked alone.

## Criteria to tests

Each `describe` names its criterion's ID, `#1501.<first 8 hex of SHA-256 of the criterion's text>` (trimmed,
whitespace collapsed, `- [ ] ` dropped). Each test's name starts with its criterion's number.

| ID | Criterion (short) | Test | Fails on the base because |
|---|---|---|---|
| AC1 `#1501.840c5fe8` | hub up, session on 9.9.9: the four calls denied, naming the guard | `floor.test.ts` AC1 | the hub treats the session as watch-only and returns an empty reply: each call is recorded and runs, and the failure names each call |
| (Scope) | the health reading says the floor still holds | `floor.test.ts` AC1 (scope) | the base's reading says "its holds and blocks are watch-only", naming no floor or fail_closed entries |
| AC2 `#1501.e184c432` | watch recorded and runs, warn adds nothing, Stop not held; a hub ending watch-only fails | `watch.test.ts` AC2, AC2 (wrong program) | passes on the base by design (the base is all watch-only); it guards the fix against ending watch-only altogether, which the wrong program shows failing at the stop |
| AC3 `#1501.37078b1d` | a listed version behaves as on the base | `listed.test.ts` AC3 | passes on the base by design; it fails a fix that lets the watch-only floor reach gated sessions (the staged delete denied outright, the stop not held, a warn or block lost) |
| AC4 `#1501.043ea69b` | hub stopped denies as today, so hub up and down agree; fails naming the entry | `agree.test.ts` AC4 | with the hub up the base lets every fail_closed entry's call run in the 9.9.9 session, so each entry is named as disagreeing |

## Files

- `helpers.ts`: temp homes, rules, the repo and its second worktree, sessions with version-stamped transcripts,
  deep-hook as a hook entry, the hub as a process, the forwarder and `hubDecides`, the hub's record, the AC1 calls
  and the per-entry representatives. Adapted from tests/acceptance/317/helpers.ts, 18/session/helpers.ts and
  19/authority/helpers.ts (same repo, same license); this suite keeps its own copy.
- `floor.test.ts` (AC1, the health reading), `watch.test.ts` (AC2), `listed.test.ts` (AC3), `agree.test.ts` (AC4).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.

[Adapters]: ../../../docs/technical-design.md
[Threats, and what stops each one]: ../../../docs/technical-design.md
[Before each command]: ../../../docs/technical-design.md
[Hook protocol (deep-hook and the hub)]: ../../../docs/technical-design.md
