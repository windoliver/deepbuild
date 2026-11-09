# Blind redraft of #34 AC2 and AC4 for the signature format of #1579

AC2 `#34.0e31665e`: "An authority answer without a paired device's signature is refused, unless it comes from the CLI
and the OS has confirmed you; a hub that counts one carrying only the control token fails this test". AC4
`#34.fbf5f587`: "An answer posted here is delivered like a CLI answer". A fresh run of the blind acceptance-test job
(AGENTS.md, Proof; design, Dogfooding) for these two criteria, at base `f1e8736e` (Merge pull request #1742). It never
saw an implementation. It edits no test outside this folder; the earlier #34 suite (`../`) is an input it imports from
and doesn't change.

## What it read

- AGENTS.md, CONTRIBUTING.md; issue #34 (Scope and its twelve criteria) and issue #1579 (Scope and its five criteria).
- docs/technical-design.md of the #1579 worktree: Socket roles and contract versions, "The trusted path is a device you
  paired" (the signature's shape: `signature: {signed: {device, method, hub, at, once, params}, sig}`), and the
  threats rows "Signatures used again" and "A hub left behind" ("Every hello names ... the hub's ID").
- The base, through `git show f1e8736e:<path>`: the hub's hello line in `packages/hub/src/server.ts` (it carries
  `hub`, the hub's ID) and the signature check in `packages/hub/src/trusted.ts`, read only to know what the base
  refuses; `packages/contracts/src/canonical.ts` (`canonicalize`, RFC 8785 bytes).
- The earlier #34 folder: README, helpers.ts, answers.test.ts, BASE-FAILURE.txt; #16's helpers it builds on
  (`openAs`, `Conn.hello`); tests/acceptance/880/redraft and tests/acceptance/327/answers-redraft for the layout.

## The dispute

The earlier `answers.test.ts` signs with `signed()` from `../helpers.ts`: it puts `device` and a string `signature`
among the params, the signature over every other param. #1579 changed the design: a paired device's signature now
names the method, the hub's ID, the time, a once-only ID and the params' hash, in the shape above. A hub that follows
the design refuses the old format, so every case that needs a signed answer to count fails there (AC2's first two and
its planted case, both AC4 cases), and the refusal cases pass for the wrong reason. This redraft keeps each test's id,
title, steps and expected values as #34 states them and changes only how the device signs, and how the planted hub
signs.

## How to run

Node 24 first on `PATH`, macOS:

```sh
npm ci && npm run build --workspaces
NO_COLOR=1 scripts/lease node node_modules/vitest/vitest.mjs run tests/acceptance/34/redraft-1579 --no-file-parallelism --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/34/redraft-1579
```

Seven tests, no model and no network, about a minute. Each starts a real `deep hub run` under a fresh `/tmp/dh16-*`
home (#16's helpers; nothing touches `~/.deepbuild`), with the earlier suite's OS stand-in, which says no unless a test
says yes, and stops only the processes it started, by PID.

## What it does

`helpers.ts` adds three things and imports the rest from `../helpers.ts` as it is:

- `hubOf(conn)`: the hub's ID from the hub's hello on that connection (`hello.hub`); BLOCKED if the hello names none.
- `signed(params, device, hub, {id?, method?})`: the call's params plus `signature: {signed, sig}`, where `signed` is
  `{device, method: 'ask.answer', hub, at: Date.now(), once: <16 random bytes, 22 base64url characters>, params:
  <lower-case hex SHA-256 of the RFC 8785 bytes of the params, signature left out>}` and `sig` is Ed25519 over the
  RFC 8785 bytes of `signed`, base64url. Every call gets a new `once`.
- `tokenOnlySigner(dir, hub socket, device)`: AC2's planted hub, the earlier suite's proxy rebuilt here (its line proxy
  isn't exported): the real hub behind a socket that holds a paired key, reads the hub's ID from the real hub's hello
  and signs every unsigned `ask.answer` in the new format.

`answers.test.ts` is the earlier file's AC2 and AC4 blocks with those calls in place of the old `signed()`:

| ID | Test | What counts as failure |
|---|---|---|
| `#34.0e31665e` | the app's answer carrying only the control token is refused, recorded nothing and leaves the ask open, even with the OS ready to confirm | the unsigned answer counts; or the same answer signed by the paired app doesn't (`allow`) |
| `#34.0e31665e` | a signature from a key never paired, or over other words than the answer sent, is refused | a stranger's key under the app's device ID, a decline's signature sent as an approve, or one ask's signature sent for another counts; or a good one doesn't |
| `#34.0e31665e` | a key paired without the OS confirming you is refused, and nothing it signs counts | pairing succeeds, or its signature counts under `''` or `device:unpaired` |
| `#34.0e31665e` | from the CLI, an unsigned authority answer counts only once the OS confirms you, asked once, its prompt naming the question and the option | unchanged from the earlier suite: no signature in it; kept so this folder covers the whole criterion |
| `#34.0e31665e` | (wrong program) a hub that counts an answer carrying only the control token fails this test, naming the ask | the judge, run against the planted signer, doesn't name the ask |
| `#34.fbf5f587` | a taste call answered on the App API is recorded and handed on as its twin answered from the CLI is | what `ask.answered` hands on differs from the CLI twin's, or `green` isn't the answer |
| `#34.fbf5f587` | an authority ask approved on the App API is recorded and handed on as its twin approved from the CLI is | as above, with `allow`, and both are `ask.answered` on the stream |

## Readings

1. **`device` lives in `signed` only.** The design's shape puts `device` inside `signed`; nothing says it stays a
   top-level param. These calls carry `{ask, option, plan_hash?, token?, signature}` and no top-level `device`.
2. **The method is `ask.answer`,** the method called, as the earlier suite names it.
3. **The hub's ID** is the hub's hello's `hub` field, the one line a client gets on connecting (the base already
   sends it). The planted signer reads it from the same line on its own connection to the real hub.
4. **`once`** is 16 random bytes in base64url (22 characters), inside the design's 16 to 128.
5. **The swapped and other-ask cases** are now refused because the params' hash no longer matches `signed.params`,
   which is the design's "over exactly the params it sends"; each has its own fresh `once`, so no refusal there can
   come from a spent `once`.
6. **Scope.** #1579's own checks (another method, another hub, 11 minutes old, a replay, a signed unpair) are #1579's
   criteria and not redrafted here.

## Verified, and not

- `npx tsc --noEmit -p tests/acceptance/34/redraft-1579`: no errors.
- The signer, checked by hand with `node:crypto`'s `verify` from the raw public key: `sig` verifies over `signed`;
  `signed.params` equals the SHA-256 of the params' canonical bytes; the same `sig` fails once `method` is changed.
- The base (BASE-FAILURE.txt): 5 failed, 2 passed. The five cases that need a signed answer to count fail at
  "<ask>'s answer counts" (the base refuses the new format, `credential` at `/params/signature`) or, for the planted
  case, at "the planted hub counts the unsigned answer, and the judge names its ask". The key-paired-without-you case
  and the CLI case pass at the base, as they should: neither needs a signature to count.
- Not run: against a hub that implements #1579. The job never sees one, so whether these pass there is unverified.
- The run was unleased: `scripts/lease` said DeepBuild isn't set up in the base export (no hub token).
