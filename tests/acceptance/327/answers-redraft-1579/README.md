# Blind redraft of #327 AC2, signed as #1579's design says

AC2 `#327.da06e3b1`: "A taste call with options A, B and C, B recommended and drawn first, answered by a hardware
click on C, records option C in `ask.answered`, and the agent's next input holds C's ID and label, with
`delivery.outcome` delivered and acknowledged; a card that maps the click to the record's index delivers B and fails,
naming the option". A fresh run of the blind acceptance-test job (AGENTS.md, Proof; design, Dogfooding) for this one
criterion, at base `f1e8736e` ("Merge pull request #1742 …"), against the design in the #1579 worktree. It never saw
an implementation. It edits no test outside this folder; `../answers-redraft` and `../helpers.ts` are inputs it
imports from as they are.

## What it read

- AGENTS.md, CONTRIBUTING.md; issue #327 (its AC2), issue #906 (an answer recorded delivered when the hub writes its
  reply, not when a turn shows it), issue #1579 (a signature says what it's for: method, hub, time and once).
- docs/technical-design.md from the #1579 worktree: Threats, "The trusted path is a device you paired" (the
  signature's shape, below); the threats table's "A hub left behind" row ("Every hello names … the hub's ID"); An
  ask, and your answer getting back (text in a session's own prompt "at most … closes a question that needs no
  authority"); the rest of AC2's reading is the earlier redraft's (`../answers-redraft/README.md`, What it read).
- `../answers-redraft/` (README, ac2.test.ts, helpers.ts, BASE-RESULTS.txt), `../helpers.ts`, and #34's
  `helpers.ts` (`newDevice`, `pair`, the old `signed()`).
- The base's packages/hub/src/server.ts hello line (it names the hub's ID as `hub`), trusted.ts and core.ts
  (`answer`, `trusted`), and packages/asks/src/index.ts (a typed prompt answering an open question), read at
  `f1e8736e`, to see how the base treats an answer signed in the new format and why a first draft's click was
  refused as already answered.

## The dispute

`../answers-redraft/ac2.test.ts` sends the card's answer with #34's `signed()`: `device` and a bare `signature`
among the params, Ed25519 over the RFC 8785 bytes of every other param. #1579 changed the design: a paired device's
signature is now `signature: {signed: {device, method, hub, at, once, params}, sig}`, where `method` is the method
called, `hub` the ID the hub's hello names, `at` milliseconds since the epoch, `once` 16 to 128 base64url characters
the device never uses again, `params` the lower-case hex SHA-256 of the RFC 8785 bytes of the call's params with
`signature` left out, and `sig` Ed25519 over the RFC 8785 bytes of `signed`, in base64url. A hub that follows it
refuses or mishandles the old signature, so the earlier redraft fails at the click on C for a reason AC2 doesn't
name. This redraft signs the answer in the new format; everything else is the earlier redraft's.

## How to run

Node 24 first on `PATH`, macOS, the Rust toolchain:

```sh
npm ci && npm run build --workspaces
cargo build --locked -q -p deep-hook
scripts/lease node node_modules/vitest/vitest.mjs run --root tests/acceptance/327/answers-redraft-1579 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/327/answers-redraft-1579/tsconfig.json
```

Two tests, no model and no network, about 25 s on an idle Mac. Each starts a real `deep hub run` under a fresh
`/tmp/dh16-*` home (#16's helpers; nothing touches `~/.deepbuild` or `~/.claude`), the Claude Code stand-in in it,
and stops only the processes it started, by PID. With `--root` here Vitest may write `node_modules/.vite/` in this
folder; delete it before committing.

## What it does

`ac2.test.ts` is `../answers-redraft/ac2.test.ts` (its steps 1 to 6, in that README) with three changes:

1. After pairing, it reads the hub's ID from the hello the hub sent on the app's connection (`hello.hub`). A hello
   that names none fails the run, naming the ask, since a device has no hub to sign for.
2. Your click on C is sent as `ask.answer` with params `{ask, option, token, signature}`, where `signature` is
   `signedFor('ask.answer', {ask, option, token}, device, hub)` (`helpers.ts`): `device` the ID pairing gave the
   app's key, `at` now, `once` 32 fresh base64url characters, `params` the hex SHA-256 of the RFC 8785 bytes of
   `{ask, option, token}`, and `sig` the key's Ed25519 signature over the RFC 8785 bytes of `signed`.
3. The session types no prompt while the taste call is open: it starts, the assistant says it asked, and it stops
   with the ask open (step 4 of the earlier README without "your typed prompt"; Readings, 6).

The judges are unchanged: `ask.answered` records `c-cobalt` once; `delivery.outcome` never reads delivered before the
session's transcript shows the answer; the agent's next input holds `c-cobalt` and "C: cobalt header" and neither
`b-bone` nor "B: bone header"; delivered within 30 s once the transcript shows it. A hub that refuses the signed
answer fails at "the hub refused the card's answer …", naming the option and the ask.

## Readings

1. **#906's reading stays**: delivered and acknowledged is recorded only once the session's transcript shows the
   answer (`../answers-redraft/README.md`, Readings 1 to 5: the agent's next input, delivered and acknowledged, the
   2 s transcript lag, the 30 s bound, the card's two mappings).
2. **`device` lives in `signed` only.** The design's shape puts `device` inside `signed` and names no top-level
   `device` param, so the params are `{ask, option, token}` and the hash covers exactly those. A hub that still wants
   `device` among the params refuses this answer and fails the test.
3. **"The ID the hub's hello names"** is the hello's `hub` field. The design doesn't name the field; the base's
   hello already carries the hub's identity as `hub` (server.ts), and the threats table says every hello names the
   hub's ID.
4. **RFC 8785** is written in `helpers.ts`, not taken from the implementation's canonicalizer, so the bytes signed
   are the design's. For the values signed here (strings, integers, flat objects) RFC 8785 is sorted keys, no
   whitespace, and ECMAScript's JSON.stringify for strings and numbers.
5. **The card's flow is otherwise unchanged** (#1579 AC3): the same click token, option and order as before.
6. **No prompt typed while the ask is open.** The design lets text a person types in the session close a question
   that needs no authority, unverified, and a taste call needs none. The ask is seeded before the hub starts, so in
   the earlier redraft the prompt is typed while it is open, and a hub that follows the design may take the prompt
   as the answer and refuse the click as already answered. The base does exactly that (BASE-FAILURE.txt, run 2). AC2
   names no prompt, so the session here types none, and the click is the only answer.

## Criterion → test → wrong programs

| ID | Test | Wrong programs |
|---|---|---|
| `#327.da06e3b1` | `ac2.test.ts`: "a taste call (A, C, B in the record; B recommended, drawn first) answered by a click on C …" | the base (verifies only the old format, so it refuses the new signature: fails at "the hub refused the card's answer c-cobalt …"); a hub that records delivered when it writes the Stop hold's reply (#906's, caught as in `../answers-redraft`); the planted card that maps the click to the record's index ("wrong program: …", which passes only when that run fails naming `b-bone (B: bone header)`) |

## Verified and not

See BASE-FAILURE.txt for the runs on the base. Verified:

- The base fails the main test at its one assertion: the hub refuses the new-format answer, `credential` at
  `/params/signature`.
- The scenario itself works on the base: the same test with #34's old signer swapped back in (a scratch copy,
  deleted) passed 2/2 there, the Stop held, the answer delivered, the planted card caught naming `b-bone`.
- The folder type-checks (`tsc --noEmit -p`).
- The signer's output, checked once by hand: the `params` hash against the hand-written RFC 8785 bytes of
  `{ask, option, token}`, `sig` verified with the public key, `once` 32 base64url characters.

Not verified:

- The test has not run on an implementation of #1579 (this job sees none), so it is unproven here that the new
  signature is accepted and AC2's judges pass with it.
- On the base the wrong-program test passes only because the planted card's answer is refused too, naming `b-bone`.
  On a hub that accepts the new format it is caught at `ask.answered` and the next input, as in the old-signer
  diagnostic.
- One run of the changed folder was BLOCKED in setup under load (the hub didn't record the Stop within 60 s).

## Copied or imported

- `helpers.ts`: the new-format signer and an RFC 8785 serializer, written here.
- `ac2.test.ts`: a copy of `../answers-redraft/ac2.test.ts` with the two changes above. It imports the Claude Code
  stand-in, settings and transcript tools from `../answers-redraft/helpers.ts` (and so its `fixtures/claude.mjs`,
  #25's stand-in with the transcript lag) and the hub world from `../helpers.ts`, both as they are.
- `tsconfig.json`: a copy of `../answers-redraft/tsconfig.json`.
