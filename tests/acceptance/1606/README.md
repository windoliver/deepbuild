# Acceptance tests for #1606: channel tokens and the app's device key out of plain files

Written first, blind, at base commit `1c4d1f0e2` (main), by a job that never saw an implementation of #1606; none
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

## Sources read

- Issue #1606 (Scope, its nine criteria, Proof), as of November 12, 2026; epic #6 for context; #364 for how a secret is
  named by handle and kept in the OS secret store.
- `docs/technical-design.md`: Threats, and what stops each one (Injected answers, Secrets, Signatures used again, What
  a command's children do); Before each command; the bullet "The trusted path is a device you paired"; the Channel row
  of the hub slots; the inbox paragraph (`deep inbox answer` counts once the OS confirms you); Dogfooding. `AGENTS.md`.
- At the base: `packages/hub/src/{channels,reach,trusted,trusted-actions,agents,keychain,plant,client,wire,children,
  session-state,paths}.ts`, `crates/deep-hook/default-rules.json` and `main.rs`'s hook and check modes,
  `crates/deep-app/src/{device,answer,card,single,hub}.rs` and its Cargo features, `packages/channels/chat`,
  `packages/extension-host/src/sources.ts` (#364's handles and store keys).
- The suites `65` (channels, its provider stand-in), `364` (secrets by handle, the scrub's forms), `1579` (signatures,
  the `credential` refusal), `34` and `1454` (the real app against a real hub), `1503` and `304` (deep-hook's default
  entries, hub up and down), `667` and `26` (an agent session's stand-in), `16` (the hub as a process).

## Run

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"   # Node 24.22 (.node-version)
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"          # cargo, if no rustup proxy is on PATH
npm ci && npm run build --workspaces          # the tests run packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/1606 --testTimeout=1800000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1606/tsconfig.json
```

- **Each file starts its own hubs, and some start the real app**, so run them with `--no-file-parallelism`, and
  `scripts/lanes.mjs` needs `tests/acceptance/1606/` in its `alone` list (the implementer makes that edit).
- **`device.test.ts` needs Accessibility and Screen Recording** for the process running it (#1454's probe presses the
  card from outside the app), in a logged-in, unlocked macOS session; without them its tests read `BLOCKED`, never pass.
  `stolen.test.ts` starts the real app too, but needs no permission: it reaches the app through `deep open`.
- **The platform sandbox.** `deep install` of the chat channel loads it in the platform sandbox; Homebrew's Node breaks
  it (#1454's README), so use an official Node build.
- **Builds.** deep-hook from this checkout; deep-hook from the pinned merge base, offline, under
  `target/base-1606/1c4d1f0e2aaa/`; `deep-app` with features, each copied to `$TMPDIR/da1606-bin-<uid>/`, the plain build
  last so `target/debug/deep-app` is never a plant.
- **Safety.** Every hub and app runs with `HOME` a temp folder under `/tmp`, and nothing touches the real `~/.deepbuild`,
  `~/.claude`, `~/Library/LaunchAgents` or your login Keychain: every hub gets `DEEP_HUB_TEST_SECRETS`, and the app is
  only ever started from a build with its store's stand-in, or, where the checkout's `crates/deep-app` is the merge
  base's own, from the base's `test-confirm` build, which keeps its key in a file (`helpers.ts`, `appWith`). Processes
  are stopped by the PID they were started with, never by name or port. No network beyond 127.0.0.1, no model.

## Criteria to tests

IDs are `criterionId` in `scripts/proof-change.mjs`: `#1606.` and the first 8 hex of SHA-256 of the checkbox text.

| AC | ID | File | Test | Wrong program it fails on |
|---|---|---|---|---|
| AC1 | `#1606.0f8635c4` | `hook.test.ts` | a planted `channels.json` holding a token, the hub stopped: `cat ~/.deepbuild/channels.json` and a Read of it are each denied, naming the guard | the merge base's deep-hook with its own default entries: a test of its own, which asserts both calls are allowed and the judge fails naming both |
| AC2 | `#1606.692cab52` | `channels.test.ts` | the hub started on that file: within a minute the file names the token by handle and holds no form of it, the store holds the value, and a provider call after the move carries it | none named |
| AC3 | `#1606.8cb3635c` | `channels.test.ts` | `channels.json` at 0640, then at 0604: the hub's log names the file and its mode, and no call carrying the token reaches the provider | none named |
| AC4 | `#1606.701685ed` | `channels.test.ts` | after a card reaches chat: the record, the logs and an agent's environment hold no form of the token | `DEEP_HUB_PLANT=logs-channel-header`: a test of its own, which expects the failure to name the hub's log |
| AC5 | `#1606.1b905924` | `device.test.ts` | the real app pairs and its card's answer counts; then no file under `~/.deepbuild` holds a paired device's private key | Cargo feature `plant-key-in-file`: a test of its own, which expects the failure to name `~/.deepbuild/app/device.json` |
| AC6 | `#1606.632a863e` | `stolen.test.ts` | an older app's key in `device.json`, the real app started; this process reads every file under `~/.deepbuild` and signs an Allow with each key pair found and a key of its own, as each device named: each refused with `credential`, the ask open | the merge base: in `BASE-FAILURE.txt` (its app leaves the key in the file and the Allow counts, naming the ask) |
| AC7 | `#1606.fca4f55a` | `hook.test.ts` | the hub stopped: a Read and a `cat` of `~/.deepbuild/app/device.json` are each denied, naming the guard | none named (the base allows both: `BASE-FAILURE.txt`) |
| AC8 | `#1606.bf38dab5` | `session.test.ts` | a deep command in an agent session's shell sends a signed approval: refused, naming the session; the ask open | the merge base: in `BASE-FAILURE.txt` (it counts the answer, naming the ask) |
| AC9 | `#1606.21a4b991` | `device.test.ts` | an older app's key moved at the app's start; an answer on the card counts once, with no device paired after the move | none named |

The merge base's deep-hook is built in the suite, since it is small and offline. The merge base's hub and app for AC6
and AC8 are not: building a second hub and app from another commit inside a test is far heavier than the rest of the
suite together, so, as #1579's suite does for its merge-base claims, their failure is the base run in `BASE-FAILURE.txt`.

## The surface (pinned here; the implementation builds to it)

The issue fixes the behaviour; it leaves these shapes open, so these are this suite's choices, each the smallest that
fits the base's conventions.

### Channel tokens by handle

- **`~/.deepbuild/channels.json` after the move.** The channel's entry keeps every field it had but `token`, which is
  gone, and gains `"secret": "secret:channels/<name>"`, its handle, as #364's sources name a secret (`secret:<name>`):
  `{ "channels": { "chat": { "api": "http://127.0.0.1:<port>", "secret": "secret:channels/chat" } }, "routes": [...], "quiet": null }`.
  The file holds no form of the token (raw, URL-encoded or base64 at any offset, #364's forms).
- **The store key** is `deepbuild/channels/<name>` (here `deepbuild/channels/chat`), as #364's are
  `deepbuild/<owner>/<name>`. The hub adds the value as `authorization: Bearer <value>`, as at the base.
- **`slack.json` after the move** (no criterion tests it): `{ "secret": "secret:slack/token", "you": "...", "api"?: "..." }`,
  store key `deepbuild/slack/token`.
- **The store in a test home is `DEEP_HUB_TEST_SECRETS`**, the base's stand-in in `packages/hub/src/agents.ts`: a JSON
  object of key to value in the file it names. Whenever it is set, the hub keeps and reads channel tokens there and
  never in the Keychain. The tests put it beside the home (`<tmp>/hub-secrets.json`), outside `~/.deepbuild`.
- **When the move happens:** when the hub starts on the file, within a minute of its ready line.
- **A file readable by group or others (AC3)** is refused while the hub still starts: no channel call carries a token
  from it, and the hub writes one line to its standard error (what the login service keeps in
  `~/.deepbuild/logs/hub.log`) holding the file's full path and its mode in octal, `0640` or `640`. The tests try 0640
  and 0604, so a check of the others' bits alone fails.
- **The plant `logs-channel-header`**, selected with `DEEP_HUB_PLANT` and added to `packages/hub/src/plant.ts`'s list:
  the hub writes each channel provider call's request headers, the token's included, to its standard error.

### The guard (AC1, AC7)

A denial names its guard as deep-hook's hub-away denials do, `(guard <name>, …)`, where `<name>` is an entry of the
shipped `crates/deep-hook/default-rules.json` that is `block`, `fail_closed` and has a `read:` match. The Scope reads as
the existing `no-control-token-read` entry with the two files and `~/.deepbuild/app/` added; any such read entry passes.
The calls are `cat ~/.deepbuild/<file>` (Bash) and `Read` with the file's absolute path, through
`deep-hook claude-code PreToolUse` on a home whose hub was started and stopped by its PID, the shipped defaults as its
`rules.json`.

### The app's device key

- **`test-secrets`, a Cargo feature of `deep-app`, in no shipped build.** Built with it, the app keeps its device's key
  in the file `DEEP_APP_TEST_SECRETS` names, in place of the Keychain, and signs with the key it holds there. Its
  format is the implementer's; no test reads it. The tests put it beside the home, outside `~/.deepbuild`. As with
  `test-confirm`, the shipped app should hold no such word. Every app a test starts is built with `test-confirm` and
  `test-secrets`.
- **The move.** At its start, the app moves a key an older app kept in `~/.deepbuild/app/device.json`
  (`{"device": "device:<id>", "seed": "<32 bytes, base64url, no padding>"}`, the base's format) into its store, deletes
  the file, and from then on signs as that device: no new `device.pair`. AC6 waits 30 s after the app first answers
  `deep open` for the file to go; AC9 waits two minutes from its launch.
- **The plant `plant-key-in-file`**, a Cargo feature built on top of the two stand-ins: the app keeps its key as the
  merge base does, in `~/.deepbuild/app/device.json` as `{device, seed}`, and never moves one.
- **"Holds the device's private key" (AC5)**: a file under `~/.deepbuild` whose text holds the Ed25519 seed of a device
  the hub lists as paired in `~/.deepbuild/devices.json` (the base's file), as 32 bytes, as 64 bytes of seed and public
  key, or as PKCS #8, in base64, base64url or hex. Raw binary bytes aren't searched.

### Refusals

- **AC6:** each signed Allow is refused with `error.code` `credential`, and the ask stays open: no `ask.answered` for
  it, and its `inbox.read` row `unanswered` and not closed. The Allow is #1579's: `ask.answer` with the allow option,
  the plan's hash and a click token, signed in the design's format, sent on a cli connection with the control token.
- **AC8:** the reply is an `error` (any code) whose text names the agent session's ID (the `session_id` its hooks
  carry), and the ask stays open as above.

## Readings where the issue leaves a choice

- **"The hub stopped" (AC1, AC7)** is a hub started on the home and stopped by its PID, so deep-hook gets no answer and
  applies the `fail_closed` entries, as #1503's suite has it. The planted file is written after the hub stopped, so it
  still holds its token when the calls are decided.
- **"A provider call carries it in its header" (AC2)** is a call the chat provider answered 200 after the file was
  seen rewritten: #65's stand-in answers 401 to any call without `authorization: Bearer <token>`.
- **"The record, the logs and an agent's environment" (AC4).** The record is every event `events.read` gives, and the
  ledger's files. The logs are the hub's standard error and, as #364's suite reads a log, every file under the home,
  `~/.deepbuild` included, read as UTF-8 and UTF-16LE. An agent's environment is what DeepBuild can set for one in this
  home: `env` printed by a shell started with the home's environment and what `~/.claude/settings.json` puts in `env`,
  as Claude Code applies it; every agent's config file under the home is scanned as a file too. The store's stand-in is
  outside the home and isn't scanned. "A channel send" is the routed ask's card accepted by the chat provider.
- **"Naming where" (AC4's plant)** is the failure line naming the hub's log, `deep hub run`'s standard error.
- **"A `deep` command inside an agent session's process tree" (AC8)** is `fixtures/deep-answer.mjs`, run by #667's
  agent stand-in through its shell as its Bash tool runs a command. It speaks the socket as every deep command does
  (`packages/hub/src/client.ts`'s `call` with the peer): the cli role, the control token and its own PID and start
  time. No `deep` command signs at the base, so a command that does stands in for one. The signer is a device the test
  paired, with the OS stand-in saying yes. The hubs run in the test process's own time zone, since the peer check
  compares a start time as `ps` prints it in each process's zone.
- **"A test process running as you, outside the app" (AC6)** is the test itself. It finds the control token, every
  32-byte value in base64, base64url or hex text, the key pairs among them (a seed whose public key a file holds too)
  and every `device:<id>` any file names; it signs as each device with each key pair and with a key of its own, so at
  least one signed Allow is always sent. The app's device is an older app's key, paired and written in the base's
  format, which the app moves at its start: no press is needed, so this runs without Accessibility.
- **"After the app has paired and answered once" (AC5)** is asserted: the card's answer counted once and reached the
  session (#1454's judge), and the hub lists a paired device; otherwise the test fails rather than finding nothing.
- **"Still counts once" (AC9)** is #1454's judge (one `ask.answered`, from the card, with the option pressed, and the
  session got it) after `device.json` is gone, plus no device paired after the move, so the answer was signed with the
  key that moved.

## What no test here covers

No criterion names these: `slack.json`, the one line saying the token moved, a file not owned by you, spellings beyond
`cat` and Read, a token on a card, the Keychain's access rule that only the signed app meets (no test can be the signed
app), and the shipped app holding no `DEEP_APP_TEST_SECRETS`.

## How far these tests were checked

Type-checked with this tsconfig. Run on the base (`BASE-FAILURE.txt`): every criterion test fails or reads BLOCKED, and
AC1's merge-base test passes. Against throwaway patches in this checkout, since reverted: the default entry's read
match widened to the two files and `~/.deepbuild/app/`, and AC1 and AC7 passed; the hub refusing a signed answer from a
cli connection whose peer check finds a session, and AC8 passed; the hub moving channel tokens into the stand-in store,
refusing a group- or others-readable file and planting `logs-channel-header`, and AC2, AC3, AC4 and AC4's plant test
passed, while two mutants failed (the handle sent in the header, AC2; only the others' bits checked, AC3). AC6's judge
passed once the key file was gone. The app's move, the `test-secrets` and `plant-key-in-file` features don't exist, and
no window could be read here, so AC5 and AC9 never ran past their first step, and AC6 never ran against an app that
moves its key.

## Files

- `helpers.ts`: the hub world, the channel world, the scans and key search, the attacker, the app's builds and launch,
  the hook calls and the merge base's deep-hook, the agent stand-in.
- `hook.test.ts` (AC1, AC7), `channels.test.ts` (AC2, AC3, AC4), `device.test.ts` (AC5, AC9), `stolen.test.ts` (AC6),
  `session.test.ts` (AC8); `fixtures/deep-answer.mjs`.
- `tsconfig.json`, `BASE-FAILURE.txt`.
