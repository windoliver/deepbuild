# #2204 AC3, a blind redraft

**Criterion `#2204.7c1b9c13`:** "With the hub stopped, each of those two files denies the call, as today."

Written from #2204, the design and the base `74e6e2634` by a job that saw neither the first draft
(`tests/acceptance/2204/`) nor any later work. The ID is `scripts/proof-change.mjs`'s `criterionId` over #2204's live
body.

## What was read

- #2204's body and its one comment; #1856, #2042 and #2177, which the body cites, for context.
- `docs/technical-design.md`: "Hook protocol (deep-hook and the hub)", "Before each command", "Threats, and what stops
  each one", and "Dogfooding" for the rules on blind tests.
- `AGENTS.md`.
- Code at the base: `crates/deep-hook/src/main.rs` (`rules`, `guard`, `forward`, the watchdog), the hub's `rules()`,
  start and stop in `packages/hub/src/server.ts`, its paths in `packages/hub/src/paths.ts`, `installRules` in
  `packages/hub/src/setup.ts`, `crates/deep-hook/default-rules.json`, `scripts/proof-change.mjs` and
  `scripts/proof-runs.mjs` (the criterion ID and how twins are laid), and the helpers of `tests/acceptance/304/` and
  `316/`, which `helpers.ts` adapts; after the runs, `secure` in `packages/hub/src/products.ts`. A search of
  `crates/deep-hook/tests/cli.rs` showed its test names and some fixture lines, #2204's own Rust test among them, which
  the base holds; this suite doesn't follow it.

## The surface

- **deep-hook**: the real binary, built by the suite (`cargo build --locked -q -p deep-hook`, `target/debug`), run as
  Claude Code's hook entry runs it: `deep-hook claude-code PreToolUse`, with Claude Code's PreToolUse JSON for a Bash
  call of `pkill -f node` on stdin and HOME a temp home under `/tmp` holding `~/.deepbuild/rules.json`. The call is only
  that payload: nothing runs it.
- **The hub**: the real `node packages/cli/dist/main.js hub run`, in the same home, started and then stopped by its PID.
- **What decides**: what Claude Code does with a PreToolUse hook's output. Exit 2 blocks the call and hands the agent
  stderr as the reason; exit 0 with a deny decision on stdout blocks it with that decision's reason; anything else lets
  the call run.

## The tests

One file, `ac3-hub-stopped.test.ts`, with a test for each of the two files. Before them: build deep-hook; make a temp
home; write the first-party entries (`crates/deep-hook/default-rules.json`) as its `rules.json`; start the hub; check
that something answers at its socket; stop it with SIGTERM to its PID, its own clean stop (SIGKILL only past 120 s);
check that nothing answers at its socket; and take `rules.json` as the stopped hub left it as the readable file.

Each test checks again that nothing answers at the socket, writes its file over `rules.json`, runs the hook once, and
checks that `rules.json` still holds that file afterwards:

1. **Cut short** (`#2204.7c1b9c13 ... cut to its first 40 bytes ...`): the readable file's first 40 bytes. Expected:
   `pkill -f node` is denied, and the denial names `rules.json` and says it isn't JSON.
2. **A newer entry** (`#2204.7c1b9c13 ... gains one entry whose match is effect:not-a-class ...`): the readable file
   with one more entry, `newer-<8 random hex>`, a whole guard@1 entry (scope `all_repos`, mode `block`, `fail_closed`
   true, and a reason and next step that don't name it) whose `match` is `effect:not-a-class`. Expected:
   `pkill -f node` is denied, and the denial names `rules.json` and the entry by its name.

The denial is a hard `expect`; the two naming checks are soft, so a run shows each one that misses.

## Readings

- **"The hub stopped"**: a real hub ran in this home with the readable file and was stopped, and nothing answers at its
  socket. The file is changed only after the stop, so no hub can write it back (a running hub writes a file it can't
  read again before it answers a hook, per #2204's Scope). The criterion doesn't say whether a hub had ever run; the
  issue's comment table runs "Hub: none". A home where no hub ever ran takes the same path in deep-hook (its connect to
  the socket fails), so it isn't run apart.
- **"Those two files"**: AC1's, `rules.json` cut to its first 40 bytes, and AC2's, a readable `rules.json` that gains one
  entry whose `match` is `effect:not-a-class`. Neither criterion names the readable file. This suite writes the
  first-party entries as they ship, which `deep setup` installs, and takes the file as the stopped hub left it, with
  whatever the hub installed while it ran, as on a real machine. The issue's comment ran the one-entry file
  `crates/deep-hook/tests/cli.rs` uses, whose entry is named `no-kill-by-name`; this file holds the first-party entry of
  that name among the rest.
- **"The call"**: AC1's, a PreToolUse for `pkill -f node`.
- **"Denies"**: exit 2, or exit 0 with a deny decision, as Claude Code reads a PreToolUse hook.
- **"As today"**: read as today's denial with the hub away, which #2204's body describes ("With the hub away it then
  denies the call, naming the file") and its Scope repeats ("as it does with it away, naming the file and why"). So
  the call is denied, and the denial names `rules.json` and why: that it isn't JSON for the cut file (AC1's words), and
  the entry for the other (AC2's words). For the second file that is the whole file refused, as today. The Scope leaves
  to the owner whether an older deep-hook should read the entries it knows instead (#2177); under that choice the call
  would still be denied, by `no-kill-by-name`, but the denial would name that entry, so the naming checks of the second
  test would need this test's redraft. "As today" also means the tests pass on the base, and they do.
- **Wording**: "isn't JSON" may also read "is not JSON", "not valid JSON", "invalid JSON" or "malformed JSON". The entry
  is named when its name is in the denial.
- **BLOCKED**: deep-hook doesn't build; the hub doesn't start, doesn't answer once ready, or still answers once stopped;
  the stopped hub's `rules.json` holds no entries; the cut is JSON; or `rules.json` changed while the call ran.
- **INCONCLUSIVE**: deep-hook was killed at the suite's 120 s timeout or by SIGKILL, or couldn't be started; or the
  call was denied but the denial lacks the file or why in a run of 500 ms or more. From 500 ms after its start
  deep-hook's watchdog decides a call by the clock, in words of its own ("within 500 ms"), so the words of such a run
  prove nothing. An allowed call is never INCONCLUSIVE: the watchdog lets a call through only once it has been matched
  with no `fail_closed` entry holding it, or when none is installed, which is the program's reading, not the clock's.

## Open questions

1. Whether "the hub stopped" should also be run in a home where no hub ever ran. Not run apart, as above.
2. Whether "as today" includes the denial's words. Read here as yes; the bare denial is its own first assertion.
3. #2177's question, which #2204 leaves to the owner, decides whether the second file's denial keeps naming the file
   and the entry.
4. On the base, `npm run build --workspaces` exits 2: `packages/hub/src/footprint-doctor.ts(68,35): error TS2322`, as
   `'footprint_unknown'` isn't one of the doctor's codes (from #1431's `dc0c5fd6d`). tsc still emits, so the hub runs,
   but deep-confirm (`packages/hub/native/build.mjs`) isn't built after it; nothing here uses it. Not this suite's to
   fix.

## How to run

```
export PATH=/opt/homebrew/opt/rustup/bin:$HOME/.local/bin:$PATH   # cargo, where this Mac keeps it
npm ci && npm run build --workspaces
npx vitest run --root tests/acceptance/2204-redraft-ac3 --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2204-redraft-ac3/tsconfig.json
```

Each twin: `twins/README.md`.

## Results

Each run once, on Nov 19 at a load average of 80 to 195 on 18 cores, with no BLOCKED or INCONCLUSIVE outcome.

- **Base `74e6e2634`**: 2 of 2 passed (`BASE-RUN.txt`). Vitest saw an agent session and used its minimal reporter,
  which prints only the totals for passing tests, so that run shows no denial text. In the base's code, the denial
  deep-hook prints with the hub away reads "DeepBuild blocked this: ~/.deepbuild/rules.json {why}, so deep-hook can't
  check its guards while the hub doesn't answer. Fix that file, then retry.", where why is "isn't JSON" or "has an
  entry <name> that isn't a guard@1 entry".
- **`away-denial-dropped`**: 2 of 2 failed (`TWIN-RUN-away-denial-dropped.txt`). deep-hook exits 0 and prints nothing
  for both files (in 20.6 ms and 12.5 ms), so the call would run. Each test fails at "must be denied".
- **`away-denial-unnamed`**: 2 of 2 failed, on 4 assertions (`TWIN-RUN-away-denial-unnamed.txt`). deep-hook exits 2
  with "DeepBuild blocked this: deep-hook can't check its guards while the hub doesn't answer. Retry it." (in 11.5 ms
  and 11.7 ms). Each test fails at "names rules.json" and at "isn't JSON" or the entry's name.
- In both twin runs the hub started, answered, and stopped cleanly. The stopped hub left `rules.json` with 39 entries in
  35,581 bytes, one entry more than the shipped file's 38 in 34,313 bytes. By the hub's code, that entry is the guard
  that keeps its product store read-only, which it installs when it starts (`secure` in
  `packages/hub/src/products.ts`); the run doesn't print the file.
- `tsc -p tests/acceptance/2204-redraft-ac3/tsconfig.json`: no errors.
