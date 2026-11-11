# Blind redraft of #65's signed-answer criteria, in #1579's signature format

AC1 `#65.82812f3b`, AC3 `#65.19700b29` (the stand-in phone's signed case), AC5 `#65.bd21c26c` (the forged-signature
case), AC10 `#65.05709fd8`, AC15 `#65.fdfea15b` and AC16 `#65.84e09e8f`, and the Proof, which is tagged AC1, AC2 and
AC3. A fresh run of the blind acceptance-test job (AGENTS.md, Proof; design, Dogfooding) for these criteria, at base
`f1e8736e` ("Merge pull request #1742 …"). It never saw an implementation. It edits no test outside this folder; the
earlier #65 suite (`../`) is an input it imports from and doesn't change.

## What it read

- AGENTS.md, CONTRIBUTING.md; issue #65 (its Scope and sixteen criteria) and issue #1579 (its Scope and five
  criteria).
- docs/technical-design.md of this worktree: the paragraph "The trusted path is a device you paired" (the signature's
  shape, `signature: {signed: {device, method, hub, at, once, params}, sig}`, and how a channel's answer carries its
  params), the Threats rows "Signatures used again" and "A hub left behind" (every hello names the hub's ID).
- The base's packages/hub/src/server.ts, for the hello line's field names only (`{hello: 'deep-hub', …, hub}`), and
  packages/hub/src/trusted.ts, for how a device's ID is made at pairing.
- The earlier #65 suite: README, helpers.ts, fixtures/providers.ts, answers.test.ts, proofs.test.ts, proof.test.ts;
  #34's helpers.ts (`signed`, `newDevice`); the redraft READMEs of #880 and #327, for layout.

## The dispute

#1579 changed what a paired device signs. A signature now covers the method, the hub's ID from its hello, the time, a
once-only ID and the hash of the call's params, one format for the app, phones and channels. The earlier suite signs
the old way in two places:

- The stand-in phone (`../fixtures/providers.ts`) signs `{device, ask, revision, card_hash, hub, at, answer}`, with no
  method, once or params, its `hub` taken from the card.
- `appAnswer` (`../helpers.ts`) uses #34's `signed()`, which puts `device` and `signature` among the params and signs
  every other param.

On a hub that follows the design, each phone answer is refused (a field left out), and the app's C in AC10 is refused
for its signature rather than for B. So the cases above fail there for the format, not for what they test. This
redraft keeps each case's world, steps, ids and expected values, and signs as the design says.

## How to run

Node 24 first on `PATH`, macOS, the Rust toolchain:

```sh
npm ci && npm run build --workspaces      # the tests run the built CLI: deep hub run, deep install, deep mcp
scripts/lease cargo build --locked -q -p deep-hook   # the hub won't start without target/debug/deep-hook
NO_COLOR=1 scripts/lease node node_modules/vitest/vitest.mjs run tests/acceptance/65/redraft-1579 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/65/redraft-1579/tsconfig.json
```

The worlds are the earlier suite's (`../README.md`, The worlds): a real hub under a `/tmp/dh16-*` home, the four
channel plug-ins installed with `deep install`, providers as stand-ins on 127.0.0.1, the OS confirmation stubbed
(#34's `Confirmer`), every process stopped by PID. No network beyond 127.0.0.1, no model, no real phone.
`DEEP_HUB_PLANT=<name>` reaches every hub, as there.

## What changed from the earlier cases

- **The phone** (`fixtures/phone.ts`, a copy of the earlier `Phone` with its signer replaced). It takes the key and
  device ID of the phone the earlier `world()` paired, plus the hub's ID read from the hub's hello (`helpers.ts`,
  `hubOf`). An answer's signature is:

  ```
  { signed: { device, method: 'channel.answer', hub, at, once, params: sha256hex(JCS({ask, revision, card_hash, answer})) },
    sig: base64url(Ed25519(JCS(signed))),
    params: { ask, revision, card_hash, answer } }
  ```

  Here `ask` is the thread key, `revision` the card's revision, `card_hash` the earlier fixture's `cardHash` of the
  card as the phone showed it, and `once` 24 fresh base64url characters per answer. `forged` signs the same `signed`
  with another key; `at` signs another time.
- **The app** (`helpers.ts`, `appAnswer`). `ask.answer {ask, option, signature}` on an app connection, where
  `signature = {signed: {device, method: 'ask.answer', hub, at, once, params: sha256hex(JCS({ask, option}))}, sig}`.
  `device` is no longer a param.
- **AC10's control.** Before B, the app answers a second open choice ask, and that answer must count. This proves the
  app's signature counts on this hub, so C's refusal is for B, and a last-writer-wins hub would take C. The earlier
  case had no such step; the format change makes it needed.
- **Messages.** Waits that fail now also print the hub's `channel.refused` events for the thread, so a format refusal
  shows its field.

Nothing else changed: the asks, the options, the 10 s bound and `inTime`'s INCONCLUSIVE under load, the expected
fields (`signature`, `device`, `hub`, `at`, `card_hash`), and the refusal's naming of B and `paseo`.

## Readings

1. **`hub`** is the hello's `hub` field, read on a fresh socket connection, never the card's `hub`. The design says
   "the ID the hub's hello names". A real phone would learn it when it pairs.
2. **The channel's `params`** sit beside `signed` and `sig` in `signature`: "which its signature carries beside
   `signed` as `params`". The answer's own `thread_key` and `answer` stay as the provider protocol has them.
3. **AC5's field** stays `signature`, the earlier suite's reading of "naming the device key", with the reason naming
   the device's ID. In the design's shape the bytes are `sig`. Like the earlier suite, this redraft takes `signature`
   as the name of the check that failed.
4. **AC16's replay.** The second hub has never paired the phone, and the replayed thread isn't one of its asks; the
   expected field is `hub`, as the earlier suite has it. Pairing the phone on the second hub wouldn't help, because a
   device's ID is made at pairing, so it would differ there. A hub that checks the device or the ask before `hub`
   names another field and fails this case. The design doesn't order the checks.
5. **The Proof** is redrafted too. It is tagged AC1 and AC3 and its "I did it" comes from the stand-in phone, so on a
   hub that follows the design it fails for the same reason.
6. **Left in `../`**, because they don't sign: AC3's unsigned case and its BLOCKED real-phone case, AC5's
   account-link case, and AC5's planted kit fill in `kit.test.ts`. The twins (`../twins`, `twins.json`) are unchanged.

## Criterion → test → wrong programs

| ID | Test | Wrong program it fails on |
|----|------|---------------------------|
| `#65.82812f3b` AC1 | `answers.test.ts`: "a choice answered on the paired phone is closed on chat, email and text, and in Needs you, within 10 s"; `proof.test.ts` | none named |
| `#65.19700b29` AC3 | `../redraft-1580/answers.test.ts`: "the phone's signed approve of a held permission request reaches the session as allow and is saved as a decision" (moved there after #1580: its phone signs the plan's hash); `proof.test.ts` | none named |
| `#65.bd21c26c` AC5 | `proofs.test.ts`: "an answer marked as signed by the paired phone with another key's signature is refused naming the phone's device, and counts as nothing" | `trusts-channel-proof` (hub) |
| `#65.05709fd8` AC10 | `answers.test.ts`: "B on the phone, then C in the app 2 s later: B is the one answer, and C is refused naming B and the paseo channel" | `last-writer-wins` (hub) |
| `#65.fdfea15b` AC15 | `proofs.test.ts`: "unpaired on the trusted path, the phone is told so, and its signed answer is refused naming its device" | `keeps-unpaired-key` (hub) |
| `#65.84e09e8f` AC16 | `proofs.test.ts`: three cases, refused naming `hub`, `at` and `card_hash` | none named |
| Proof (AC1, AC2, AC3) | `proof.test.ts`: "a task finished on the phone has its check re-run and closes on chat and email; chat's approve of the push is refused" | none named |

## Verified, and not

- `npx tsc --noEmit -p tests/acceptance/65/redraft-1579/tsconfig.json`: no errors.
- The signer, offline, on a stand-in relay: `sig` verifies with the paired public key over the RFC 8785 bytes of
  `signed`; `signed.params` is the 64-character lower-case hex SHA-256 of the carried params; `once` is 16–128 base64url
  characters; a forged answer doesn't verify; and the params hash leaves `signature` out.
- On the base (`BASE-FAILURE.txt`, 9 tests, 9 failed), every case fails at a named assertion or wait. The base still
  checks the old format and refuses every phone answer with `field: 'ask'` ("the signature leaves out ask, so it covers
  too little to count"). So AC5, AC15 and AC16's stale and changed-card cases fail expecting `signature`, `device`,
  `at` and `card_hash`; AC1, AC3, the Proof and AC16's replay time out waiting for the answer to count. AC10 fails at
  its control: the base refuses the app's new-format signature (`credential`, `/params/signature`). `scripts/lease`
  ran the command unleased there (the export has no hub token).
- Not run against an implementation of #1579 (none was shown), and not with the twins.
