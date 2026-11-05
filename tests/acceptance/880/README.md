# Acceptance tests for #880: authority confirmation is a Secure Enclave signature over the ask

Written first, blind, from issue #880 (its text as of October 31, 2026: Scope, the 4 acceptance criteria, Proof and Depends on), the design (`docs/technical-design.md`: "Threats, and what stops each one", with "The trusted path is a device you paired" and the row "Answers from the terminal"; "An ask, and your answer getting back" with "Asks stay current"; "One canonical form before any hash"; Dogfooding) and the base commit `0f7fb686` (`main`: the hub of #16, `deep inbox` of #24, the question card of #327; `packages/hub/src/confirm.ts` counts an answer when `dist/deep-confirm` exits 0). No implementation existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the tests copy the built hub and CLI
cargo build --locked -p deep-hook        # deep setup names the built deep-hook (the tests build it when none is)
npx vitest run tests/acceptance/880      # from the checkout's root; about 12 s on the base
npx tsc -p tests/acceptance/880          # type-check the tests
```

macOS only: the issue changes macOS alone, and on Linux the polkit route keeps its own rule, so elsewhere every test fails BLOCKED. Node 24.22 or newer, `cc` and `codesign` (the Xcode command-line tools, which the hub's own build needs for `swiftc`), `git`. No network. Each test makes its own folder under `/tmp/dh880-*` (a socket path must fit in 104 bytes), runs every process with `HOME` there, so the hub's root is `<tmp>/h/.deepbuild`, and never touches your real `~/.deepbuild`, your `~/Library/LaunchAgents` or launchd. It stops only processes it started, by PID (`helpers.ts`, `cleanup`), the hub `deep setup` started included, never by name or port.

**No automated test touches the Secure Enclave or shows Touch ID.** The checkout's own `deep-confirm` is never copied into a test's hub (`copyOfTheHub` filters it out); criterion 4's test, the only one that runs it, is skipped unless a person opts in.

## The surface

The tests reach the code only through what the issue and the design name, and import no hub or CLI module:

- **`deep setup`** and **`deep inbox answer <ask> <option>`** (#24), run from the CLI built to `packages/cli/dist/main.js`, as child processes with `HOME` set;
- **the hub** run as `deep hub run` (#16), and its socket's line protocol (`events.read` on a `cli` connection with the control token, `tests/acceptance/16/README.md`);
- **the record**, seeded with the hub stopped through `@deepbuild/record` and `@deepbuild/asks` (a session whose worktree is a real git repository, and authority asks raised by the core, pinned to its HEAD), and read back through `events.read`;
- **the helper**, `packages/hub/dist/deep-confirm` beside the hub's built code, and its protocol below, which the issue makes the hub's contract with it;
- `DEEP_HUB_LAUNCHER` (#16's seam), so `deep setup` starts the hub through a launchd stand-in (`fixtures/launchd.mjs`) instead of `launchctl`.

### The copy of the hub

Criterion 1 replaces `packages/hub/dist/deep-confirm`. To do that without corrupting this checkout's build for anyone else, each test builds a copy of the checkout at `<tmp>/s` (`helpers.ts`, `copyOfTheHub`): every top-level entry is a link, except that `packages/hub` and `packages/cli` are folders of links whose `dist` is a real copy, and `node_modules/@deepbuild/*` point into the copy's `packages`, so the copy's CLI loads the copy's hub. The copy's hub then runs **its own** `dist/deep-confirm`, which the test owns: a test helper put there before `deep setup`, replaced afterwards by an exit-0 script (criterion 1) or an impostor (criterion 3). Nothing in the checkout changes, and nothing needs restoring in a `finally`.

This makes one requirement on the implementation, which is also the base's behavior: **the hub runs the helper beside its own built code, resolved from the hub module's location** (`new URL('./deep-confirm', import.meta.url)` at the base), never from a fixed path or this checkout's absolute path. A hub that ran another helper would fail these tests, and could show a real Touch ID prompt while doing so; that is the implementation's bug.

### The helper's protocol

The hub and the helper speak this; the shipped Swift helper implements it with the Secure Enclave, the test helper with a key in a file. Everything is UTF-8 JSON, one object per line.

- **`deep-confirm enroll`** (stdin empty). Creates the P-256 key and prints `{"public_key": "<base64url>"}`: the public key as its X9.63 uncompressed point, `04 || X || Y`, 65 bytes, base64url without padding (what `SecKeyCopyExternalRepresentation` returns). The shipped helper makes the key in the Secure Enclave with access control `.privateKeyUsage` and `.userPresence` (Touch ID or your password); the private key never leaves the enclave. `deep setup` runs it once (directly or through the hub), and the hub stores the public key in the record as a device of yours and records the helper's code identity (below) at that moment.
- **`deep-confirm sign`**. The hub writes the **challenge** to the helper's stdin as one line, then may close stdin:

  ```json
  {"v": 1, "ask": "ask:<ULID>", "revision": "<string>", "words": "<the prompt's words>", "nonce": "<base64url of 32 random bytes>"}
  ```

  `ask` is the ask's handle, `revision` the ask's revision (below), `words` what the prompt shows you, `nonce` 32 bytes the hub picked for this confirmation alone (43 characters, no padding). The helper shows `words` as the prompt's reason and, once you confirm, signs **the SHA-256 hash of the challenge's RFC 8785 bytes** (design: One canonical form before any hash) with ECDSA P-256: `SecKeyCreateSignature` with `.ecdsaSignatureMessageX962SHA256` over the canonical bytes, the signature X9.62 DER-encoded. It prints `{"signed": <the challenge it signed>, "signature": "<base64url of the DER signature>"}`. When you cancel it prints `{"error": "cancelled"}`, and the hub refuses with "the prompt was cancelled"; any other failure is `{"error": "<why>"}`. **The exit code counts for nothing.**
- **What the hub counts.** The answer counts only when `signature` verifies, by the public key recorded at setup, over the RFC 8785 bytes of **the challenge the hub itself sent for this confirmation**. `signed` is the helper's report; a hub that verifies over it instead is the planted wrong program `signature-covers-anything`. A nonce is used once and expires with its ask.
- **The code-signature check.** At setup the hub records the helper's code identity: its designated requirement, which for an ad-hoc signature (as `swiftc` builds `deep-confirm`, and as the test helper is signed) is its CDHash, and for a Developer ID signature its team and identifier. Before each `sign` (and before `enroll` when the key is set up again), the hub checks the file at the helper location with `SecStaticCodeCheckValidity` against that requirement. A helper that fails isn't run, and the answer is refused naming the helper's path. An ad-hoc-signed helper must pass when it is the one recorded: the tests' helper is ad-hoc signed.

### The test helper

`fixtures/launcher.c`, compiled per test with `cc` (the Node path, `fixtures/helper.mjs`, the test's config and a role as `-D` defines) and signed with `codesign --force --sign - --identifier deep-confirm`. It runs `node fixtures/helper.mjs <config> <role> <its arguments>`, so the file at the helper location is a real Mach-O binary with a code identity of its own, and its key lives in `<tmp>/k/key.pem` (a software P-256 key the test controls). Two roles, two binaries, one identifier, two CDHashes:

- **`helper`**, the one `deep setup` records. On `sign` it does what `<tmp>/k/mode.json` says, read at each call, so the test changes its behavior without changing its code identity: `sign` (sign the hub's challenge), `capture` (sign and keep a copy in `captures.jsonl`), `capture-cancel` (sign, keep the copy, and report `{"error": "cancelled"}`), `replay` (return the copy numbered `capture` verbatim, whatever the hub's challenge), `cancel`. Under the base's protocol (one argument, the reason) it exits 1.
- **`impostor`**, criterion 3's. The first thing it does when started is write `<tmp>/k/impostor-started`, the marker. Then it signs the hub's challenge honestly with the recorded key, so only the code-signature check can keep its answer from counting. Under the base's protocol it exits 0.

Every call is logged to `<tmp>/k/calls.jsonl` with the challenge read and the reply given, which is how the tests read the hub's challenges.

### Seams

**None new for the key or the helper.** The hub keeps no test path that skips the code-signature check or counts an answer without a valid signature over its own nonce by the key recorded at setup: the tests put a helper with keys they control where the hub looks for its helper, and run `deep setup` so the hub records it, as it would the shipped one. The tests never set `DEEP_HUB_TEST_CONFIRM` (the #24 stub, which bypasses the helper); `deep setup`, the hub and every `deep` command run without it.

| Variable | Set by | Meaning |
|---|---|---|
| `DEEP_HUB_LAUNCHER`, `DEEP_TEST_LAUNCHER_LOG` | the tests, on `deep setup` (#16's seam) | setup's login service started by `fixtures/launchd.mjs`, which logs the hub's PID so the test stops it |
| `DEEP_HUB_PLANT=signature-covers-anything` | `plants.test.ts`, on `deep hub run` | the wrong program below |
| `DEEP_880_TOUCH_ID=1` | a person, by hand, for criterion 4 only | runs the manual Touch ID test; never set by default or by any lane |

### Wrong programs

| Name | What it does | Criterion |
|---|---|---|
| `signature-covers-anything` (`DEEP_HUB_PLANT`, on `deep hub run`; the implementer adds it to the hub's list in `plant.ts`) | counts an answer whenever the helper's `signature` verifies by the stored key over the `signed` object the helper returned, whatever ask, revision or nonce that covers | 2 |
| the base hub (`main`) | counts the answer when the helper exits 0, and runs whatever file is at the helper location | 1, 3 (recorded in `BASE-FAILURE.txt`) |

## Readings where the issue leaves a choice

- **An ask's revision** is what the ask shows when you answer it (design, Asks stay current: "Each ask is pinned to what it shows: the commit, document revision or evidence hash. An answer given after that moved shows what changed … and is recorded as answered on that revision"). For an ask pinned to a commit, it is the commit its session's worktree is at: `pinned_to.ref` until the worktree moves on, then the HEAD the question card shows as `changed.to`. The challenge's `revision` is that, as a string; its format is the implementer's, and the tests only require it to change when the worktree moves on. The tests seed a session whose worktree is a real git repository, pin its asks to its HEAD, and make "an older revision" by committing in it.
- **"A yes with authority"** is `deep inbox answer <ask> approve` on an authority ask with a plan (the `allow` option; the CLI binds the plan's hash and mints the click token, as at the base). The tests answer every ask that way.
- **"Refused"** is #24's exit 3 (not decided) from `deep inbox answer`, the ask with no closing event and no decision saved (`expectOpen`). **"Naming"** is the handle or the path appearing in the command's stdout or stderr.
- **"A valid signature captured"** is a signature the helper with the recorded code identity and the recorded key made over a challenge the hub itself sent, for another ask or for this ask before its worktree moved on; the helper then returns that copy for a later challenge.
- **Setup and the identity.** The hub records the helper's key and code identity during `deep setup`, not at its own start: the tests stop setup's hub and replace the helper before starting the hub again. A lost or replaced key being set up again only on the trusted path (scope) has no criterion and isn't tested here.
- **Which counts after a refusal.** Each refusal test ends with a positive control: the helper setup recorded put back, or a fresh signature, and the same answer then counts once. So a hub that refuses everything fails them too.

## The contract per criterion

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`). Each test name starts with its ID.

1. **`#880.dcc31bd2` With `packages/hub/dist/deep-confirm` replaced by a script that prints nothing and exits 0, a yes with authority is refused** (`exit-code.test.ts`). `deep setup` records the test helper; one authority ask; the copy's `dist/deep-confirm` replaced by `#!/bin/sh` / `exit 0`; the hub run without `DEEP_HUB_TEST_CONFIRM`. `deep inbox answer <ask> approve`: the ask stays open with nothing counted, the command exits 3, and its output names the helper's path (`<tmp>/s/packages/hub/dist/deep-confirm`, real path). Then the recorded helper is put back and the same answer counts once. On the base the answer counts (`ask.answered` and `decision.created`), which fails the test at its first assertion.
2. **`#880.64e218e8` A replayed signature is refused, naming the ask** (`replay.test.ts`, `scenarios.ts`; `plants.test.ts`). One session, asks A1 and A2 pinned to the worktree's HEAD. (1) A1 answered with a fresh signature, kept as capture 0: it counts, and the hub's challenge is checked against the protocol (`ask` the handle, `revision` and `words` strings, a 32-byte nonce). (2) A2 signed and kept as capture 1, the prompt reported cancelled: exit 3, open; its nonce differs from A1's. (3) The helper returns capture 0 (A1's) for A2: refused, exit 3, naming A2, A2 open. (4) Scope: it returns capture 1 (A2's own, an earlier nonce, the same revision): refused naming A2. (5) A commit in the worktree moves A2 to a newer revision, and the helper returns capture 1 again: refused naming A2, and the hub's challenge for A2 now carries a different `revision` than capture 1's. (6) A fresh signature counts A2 once. **Plant:** `signature-covers-anything` counts A2 at step 3, so the scenario fails with `ask ask:… (answered with the valid signature captured for the earlier ask ask:…) counted`, which `plants.test.ts` expects.
3. **`#880.25cf9ef0` A helper whose code signature differs isn't started** (`code-signature.test.ts`). `deep setup` records the test helper; the impostor, same identifier, different CDHash (checked with `codesign --display`, else BLOCKED), put at the helper location. `deep inbox answer <ask> approve`: the marker `<tmp>/k/impostor-started` doesn't exist, the ask stays open, the command exits 3 naming the helper's path. Then the recorded helper is put back and the same answer counts once, the marker still absent. On the base the impostor is started and writes the marker, which fails the test at its first assertion.
4. **`#880.e0afc5f5` On the reference Mac, a manual run** (`touch-id.test.ts`). Skipped as INCONCLUSIVE unless `DEEP_880_TOUCH_ID=1` is set, and off a reference Mac (Mac15,7 or Mac15,12). See the manual run below.

### Criterion 4, the manual run

On a reference Mac with Touch ID enrolled, after building (`npm run build --workspaces` builds the real `deep-confirm` with `swiftc`):

1. Start a screen recording (Shift-Cmd-5, record the entire screen) showing the terminal; the Touch ID panel appears on top.
2. Run `DEEP_880_TOUCH_ID=1 npx vitest run tests/acceptance/880/touch-id.test.ts`. The test builds a copy of the hub with the **real** `deep-confirm`, runs `deep setup` (which makes a real Secure Enclave key for a test home under `/tmp/dh880-*`), seeds two authority asks and starts the hub without any confirmation stub.
3. When the terminal prints `TOUCH THE SENSOR to accept`, touch the sensor. The test requires exit 0, the ask counted once, and the command's exit within 2 s of the last moment the helper's process was seen running (the helper exits as soon as the enclave signs after your touch); it prints both times.
4. When it prints `Press CANCEL`, press Cancel on the Touch ID panel. The test requires exit 3, "the prompt was cancelled" in the output, and the ask open.
5. Stop the recording; attach it as the proof the issue names, with the test's output. In the recording, the frame where the Touch ID panel accepts the touch and the frame where the terminal prints `answered approve` are at most 2 s apart.

The test home's key stays wherever the shipped helper keeps it (the implementer documents where and how to remove it).

## Criteria, tests and wrong programs

| # | ID | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|
| 1 | `#880.dcc31bd2` | `exit-code`: one | the base: the exit code counts | FAIL: the answer counted (`ask.answered`, `decision.created`) |
| 2 | `#880.64e218e8` | `replay`: one; `plants`: one | plant `signature-covers-anything` (fails naming the ask) | FAIL: missing seam, the base hub sends no challenge (it calls the helper with the reason as its one argument); plant FAIL: the hub refuses the unknown plant name |
| 3 | `#880.25cf9ef0` | `code-signature`: one | the base: it starts any file at the helper location | FAIL: the impostor was started and wrote the marker |
| 4 | `#880.e0afc5f5` | `touch-id`: one, by hand | a prompt that counts on exit 0 alone, a slow count, a cancel that answers | skipped, INCONCLUSIVE (not opted in) |

No implementation was run: the passing side of each test, the positive controls and the plant's failure are unverified until it exists. `BASE-FAILURE.txt` holds the base run.

## Notes for the implementer and follow-ups

- The tests run in the parallel block; each starts its own hub and `deep setup` in its own home (about 11 s each on the base). No change to `scripts/lanes.mjs` is needed for them; criterion 4 skips itself there.
- `DEEP_HUB_TEST_CONFIRM` (#24) still lets any test-set file stand for the OS confirming you and is used by other suites (#19, #24, #34 and others). These tests never set it. Whether it should be kept now that confirmation is a signature is outside this issue's criteria; it is a follow-up for the suites that use it.
- The app API's answers (`device.pair`, Ed25519 devices of #34) and `deep restore` are in the issue's motivation but have no criterion here; only `deep inbox answer` is tested.

## Files

- `helpers.ts`: temp folders and processes by PID, the copy of the hub, the test helper (build, identity, install, modes, calls, captures), the session's git worktree, `deep setup` with the launchd stand-in, seeding through the record and asks core, the hub, `events.read`, `expectOpen`, `expectCountedOnce`, `expectRefusedNaming`, `expectChallenge`. It imports `Conn` and `ulid` from `tests/acceptance/24/helpers.ts`.
- `fixtures/launcher.c`, `fixtures/helper.mjs`: the test helper and impostor. `fixtures/launchd.mjs`: the launchd stand-in.
- `scenarios.ts`: criterion 2's scenario, shared with `plants.test.ts`.
- `exit-code.test.ts` (1), `replay.test.ts` (2), `plants.test.ts` (2), `code-signature.test.ts` (3), `touch-id.test.ts` (4, by hand).
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the base run.
