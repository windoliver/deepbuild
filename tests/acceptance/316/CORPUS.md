# AC9 corpus test for #316: `corpus.test.ts`

Written first, blind, from issue #316 (its text as of October 24, 2026: Scope, the 9 criteria, Proof), the design
sections it links ([Hook protocol (deep-hook and the hub)], [Before each command]) and base commit `0b41a19`, by a
job that never saw an implementation of #316. This file covers **AC9 only** (`#316.39bdfe08`), the seeded corpus;
AC1–AC8 are a separate blind job's files (`README.md`). It imports only from `./helpers.ts`.

## What the test reads from the issue

AC9: "A seeded corpus of at least 1,000 spellings per default entry, generated in the test with no library,
respells each planted call through quoting (`p''kill`, `\pkill`), a full path, `env`, `command`, `exec`, `nohup`,
`timeout`, `sudo`, `xargs`, `sh -c` and `bash -lc` nested up to three deep, sequencing and subshells. Every
spelling is denied with the hub stopped and with it up, the two runs agree call for call, and the same words as an
argument, a quoted string, a comment or a heredoc written to a file are allowed. A matcher that knows only this
issue's spellings fails, naming the first spelling it let through."

The design's [Before each command] paragraph says the same: "The matcher is held to a corpus generated from each
default entry's planted call, respelled through quoting, full paths, wrappers (`env`, `command`, `exec`, `nohup`,
`timeout`, `sudo`, `xargs`), shells nested up to three deep, sequencing and subshells; each spelling must be
denied, while the same words as an argument, a string, a comment or a heredoc written to a file must be allowed."
It also fixes the two runs: with the hub down deep-hook applies the `fail_closed` entries; with the hub up it sends
the matched entries and the hub decides, and a `fail_closed` default "holds with the hub down, and with the hub up
and no extension loaded". So the two runs must agree.

### The default entries and their planted calls

The five default `fail_closed` entries ship in `crates/deep-hook/default-rules.json` (the surface AC1–AC8's
`helpers.ts` installs as the first `rules.json`). The test is blind to the entry names and their `match`
spellings; it reads only each entry's **planted call**, which the criterion names:

| Entry (by behaviour) | Planted call used as the corpus base |
|---|---|
| kill by name/port | `pkill -f node` |
| bare `git stash` | `git stash` (from a real worktree session) |
| workflow dispatch | `gh workflow run deploy.yml --ref main` |
| git at another checkout | `git -C <the main checkout> status` (from a worktree session) |
| agent-config write | `sed -i s/a/b/ <~/.claude/settings.json>` |

Each is denied in every respelling and allowed in every mention. The test asserts behaviour (deny/allow and, for a
hub-stopped denial, that it carries a shipped entry's `reason` and `next_step` verbatim via
`carriesReasonNextStep`), never a `match` spelling.

## The spelling grammar (one paragraph)

A seeded mulberry32 PRNG (`rng`, written in the test, no library) drives every choice, so each run reproduces from
its seed (`0x3160001`…`0x3160005`, one per entry). For a respelling, the **program word** is emitted plain, split
by an inserted `''` (`pk''ill`), backslash-escaped (`\pkill`), double- or single-quoted (`"pkill"`, `'pkill'`) or
replaced by a full path (`/usr/bin/pkill`). The call is then built either as `program args` with 0–2 stacked
wrappers chosen from `env`, `command`, `exec`, `nohup`, `sudo` and `timeout <n>`, or as the `xargs` form with the
call's words on stdin (`echo -f node | xargs pkill`). That is optionally wrapped in a subshell `( … )`, optionally
sequenced before or after a harmless command (`true`, `echo ok`, `:`) with `;`, `&&`, `||` or a newline, and
optionally nested 0–3 levels deep in `sh -c '…'` or `bash -lc '…'`, with correct POSIX single-quote escaping
(`'\''`) re-applied at each level. Choices combine randomly, so the set is far wider than the issue's own
examples; the test generates until it holds **1,000 distinct** respellings per entry. The **allowed** set, from the
same seed, always includes the four named shapes — the words as an argument (`echo pkill -f node`), as a quoted
string (`rg 'pkill -f node' .`), after a `#` comment (`true  # pkill -f node`) and as a heredoc written to a file
(`cat > notes.txt <<'EOF' … EOF`) — plus more of the same shapes from the PRNG. Nothing is executed: each spelling
is a Claude Code `PreToolUse` Bash payload fed to the deep-hook binary on stdin, which decides allow or deny
(`helpers.ts`, `hook`/`decision`). Every spelling runs **twice**, once with no hub at the address and once with a
real `deep hub run` (`startHub`/`stopHub`), at bounded concurrency (`CONC = 12`); the test asserts every respelling
is denied in both, every mention is allowed in both, and the two decision arrays agree element for element.
A wrongly decided spelling throws naming it, its seed and index, and the run; a disagreement throws naming the
first differing spelling.

## The wrong program

A cargo feature `plant-issue-spellings` on `deep-hook`, built by `buildDeepHook({ features: ['plant-issue-spellings'] })`
into its own target folder (`target/plant-issue-spellings/debug/deep-hook`). **Its described behaviour:** the plant
denies only the exact spellings the issue text itself lists for each entry — the bare planted call and the literal
examples the issue names (`p''kill`, `\pkill`, `/usr/bin/pkill`, a single `env`/`command`/`exec`/`nohup`/`timeout`/
`sudo`/`xargs` wrapper, one `sh -c`/`bash -lc` level, one `;`/`&&`/`||` sequence, one `( … )` subshell) — and
allows every other respelling. Because the seeded corpus combines those transforms randomly and far beyond the
issue's handful of examples, the plant lets respellings through. The `(wrong program)` test runs the same corpus
judgement on the plant (the respellings only) and expects it to **fail**, with the message naming the first
spelling let through (`/was allow, expected deny/`). The plant is code the implementer writes: when the feature is
absent (the base), `buildDeepHook` throws, `PLANT` holds the build error, and the wrong-program test fails with
"the plant plant-issue-spellings did not build" — it does not pass.

## How to run

With the repo's Node (24.22.0, e.g. via `fnm`) and Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # builds packages/cli, needed only for the hub-up run
npx vitest run --root tests/acceptance/316 corpus.test.ts --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/316/tsconfig.json   # type-check
```

- The test builds `deep-hook` itself in `beforeAll` (plain, and the plant). No network: the hub is a real local
  `deep hub run`, every call is a stdin payload, nothing is executed.
- Each entry uses its own temp `HOME` under `/tmp/dh316-*`; the real `~/.deepbuild`, `~/.claude` and `~/.codex` are
  never touched. Processes it starts are stopped by PID (`helpers.ts`, `cleanup`), never by name or port.
- Long per-test timeout (40 minutes): the machine is shared and heavily loaded. Progress prints every 500 calls.

## Base result (commit `0b41a19`)

Run on the base, all six tests **fail at an assertion**, as required:

- The five entry tests (`kill-by-name`, `stash`, `dispatch`, `other-checkout`, `agent-config`) fail in `makeWorld`
  → `installDefaults` → `defaultRules`: **`crates/deep-hook/default-rules.json` is missing**. The base ships no
  default `guard@1` entries as a file, so there is nothing for the matcher to install as the first `rules.json`,
  and no spelling is ever run.
- The `(wrong program)` test fails because the cargo feature does not exist on the base:
  `error: the package 'deep-hook' does not contain this feature: plant-issue-spellings` → `PLANT` holds the build
  error → the test throws "the plant plant-issue-spellings did not build".

```
 ❯ corpus.test.ts (6 tests | 6 failed)
   × AC9 kill-by-name (pkill -f node): …
   × AC9 stash (git stash): …
   × AC9 dispatch (gh workflow run deploy.yml --ref main): …
   × AC9 other-checkout (git -C <main> status): …
   × AC9 agent-config (sed -i ~/.claude/settings.json): …
   × AC9 (wrong program) …
```

Type-check passes on the base (`tsc -p tests/acceptance/316/tsconfig.json`, exit 0). The generator was verified
independently to produce exactly 1,000 distinct, well-formed respellings per entry from each seed.

[Hook protocol (deep-hook and the hub)]: ../../../docs/technical-design.md
[Before each command]: ../../../docs/technical-design.md
