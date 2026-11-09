# Acceptance tests for #1579: a signature says what it's for (method, hub, time and once)

Written first, blind, by a job that never saw an implementation of #1579; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The issue has five checkbox criteria, AC1 to AC5 in the body's order. Each `describe` and `it` name carries its
criterion's ID (`#1579.` and the first 8 hex digits of SHA-256 of the checkbox's text after `- [ ] `, trimmed, white
space collapsed, as `scripts/proof-change.mjs` reads it).

## Sources read

- Issue #1579 as the job's brief quoted it (`ISSUE-1579.md`): title, Scope, the five criteria, Proof ("The refused
  signatures on this branch and the merge base"), Depends on #1454 (closed, merged in this base). Not read from GitHub.
- `docs/technical-design.md`: Socket roles and contract versions, the bullet "The trusted path is a device you paired"
  (the format: `signature: {signed: {device, method, hub, at, once, params}, sig}`, 10 minutes, one verifier, refusals
  naming the field, spent `once` kept across restarts); Threats, and what stops each one (the row "Signatures used
  again"); An ask, and your answer getting back (defaults, undo, the card); Panels and devices (trusted ring). `AGENTS.md`.
- At the base `f1e8736e` (main), for surfaces and conventions only: `packages/hub/src/trusted.ts` (`Devices.signed`),
  `core.ts` (`trusted`, `answer`, `undo`, `unpair`, `pair`, `test.clock`, the method switch), `channels.ts`
  (`signedWrong`, the channel path's fields), `server.ts` (the hello's `hub`, `DEEP_HUB_TEST_CLOCK_STEPS`), `wire.ts`
  (`refusal`: `{code, retryable, remediation, path, actual}`), `plant.ts` (`DEEP_HUB_PLANT`), `packages/asks` (defaults,
  undo, the inbox row); the suites `tests/acceptance/16` (hub process, socket client, imported), `34` (pairing, the
  OS stand-in `Confirmer`, the merge base's signer, imported), `65` (channels, refusals naming a field), `880` (a plant
  failing a scenario), `1338/README.md` (layout).

## Criteria to tests

| AC | ID | File | Tests |
|---|---|---|---|
| AC1 | `#1579.cbb8b7e5` | `method.test.ts` | (1) a defaulted ask; the app's undo signed for `ask.undo` counts and opens it; the same params and signature sent on `ask.answer` are refused with `path` `/params/signature/signed/method`, the refusal naming `ask.undo`, nothing answered. (2) the merge base's format: the undo's signature over `{ask, device}` sent on `ask.answer` is refused at the signature (the merge base passes it and refuses only at `/params/option`) |
| AC2 | `#1579.f338a953` | `fields.test.ts` | (1) an approval signed 11 minutes ago by the hub's clock: refused at `/params/signature/signed/at`, nothing answered; one signed 9 minutes ago counts; a fresh one for the refused ask counts. (2) signed for another hub: refused at `/params/signature/signed/hub`; the same signed for the hello's `hub` counts. (3) a signed undo that counted, replayed once the ask defaults again (within its 10 minutes): refused at `/params/signature/signed/once`, the ask stays defaulted; the same after the hub restarts. (4) the merge base's format: a signed undo replayed after the ask defaults again is refused at the signature (the merge base opens the ask again), and a fresh undo in the design's format then counts |
| AC3 | `#1579.68360e4a` | `answers.test.ts` | (1) an approval and a taste answer from the app in the new format count; each is recorded and handed on (`answer`, `decision`, `plan_hash`, `verified`, click token) as its twin from the CLI with the OS confirming you; the twins' cards (`ask.card`) are alike before and after. (2) a no signed and sent as a yes: refused at `/params/signature/signed/params`; a key never paired signing as the app's ID: refused at the signature; an unsigned app answer: refused; none answers; then the app's own signature counts |
| AC4 | `#1579.1d716d86` | `unpair.test.ts` | the phone's signature counts while paired; an unsigned `device.unpair` from the app is refused; the app's `device.unpair {device: <phone>}` signed in the new format returns `{unpaired: <phone>}`; the phone's next signature is refused at `/params/signature/signed/device` and answers nothing; the app's still counts |
| AC5 | `#1579.78fa4f3f` | `threat.test.ts` | (1) the design's threats table (under "Threats, and what stops each one") has the row `Signatures used again` naming the method, the hub, the time, the once-only ID, the hash of the params, 10 minutes, one verifier for the app, phones and channels, restarts, the planted verifier and `#1579`. (2) the row's kit (`scenarios.ts`, `signatureKit`) run on the hub with `DEEP_HUB_PLANT=signature-skips-time` fails at its 11-minute-old case, naming the ask that counted, and passes every other case. (3) the kit passes on the hub as shipped |

`scenarios.ts` holds the cases AC1, AC2 and AC5 share; `signatureKit` runs them all on one hub: 11 minutes old, 9
minutes old, another hub, a fresh one, the captured undo on another method, the replayed undo.

## Run

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci --no-audit --no-fund                 # once
npm run build --workspaces                  # the tests run packages/cli/dist/main.js (deep hub run)
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook   # the hub won't start without target/debug/deep-hook
NO_COLOR=1 npx vitest run tests/acceptance/1579 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1579/tsconfig.json
```

The tests themselves call no Rust code, but the base hub refuses to start without a built deep-hook. No network, no model. Each world is a temp home under `/tmp/dh1579-*` (the OS stand-in's
folder is #34's, under `/tmp/dh16-*`), with `HOME` there for the hub; the folders are removed and every hub stopped by
its PID after each test (#16's `cleanup`). Nothing times anything, so the suite needs no `alone` entry in
`scripts/lanes.mjs`; each test starts one hub (two for the restart) and takes a few seconds once built.

## Surfaces this suite chose

The design fixes the format; these are the suite's choices where it or the base leaves one:

- **The format, as sent.** The call's params carry `signature: {signed: {device, method, hub, at, once, params}, sig}`
  and no top-level `device` of the signer's. `signed.device` is the paired device's ID from `device.pair`; `method` the
  socket method called (`ask.answer`, `ask.undo`, `device.unpair`); `hub` the hello's `hub` field
  (`{"hello":"deep-hub", …, "hub": <identity id>}`, the base's); `at` the hub's clock in ms; `once` 24 base64url
  characters (18 random bytes); `params` the lower-case hex SHA-256 of `canonicalize` (RFC 8785, `@deepbuild/contracts`)
  of the params without `signature`; `sig` Ed25519 over `canonicalize(signed)`, base64url. For `device.unpair` the
  params are `{device: <the device unpaired>}`, so the signer and the device unpaired no longer share a name.
- **Refusals name the field by `error.path`**, exactly `/params/signature/signed/<field>`: `method`, `at`, `hub`, `once`,
  `params`, and `device` for a device no longer paired. The tests don't assert the `code`. The `method` refusal's text
  (anywhere in the error object) must contain `ask.undo`, the method the signature was made for.
- **Check order.** A signature that was spent on `ask.undo` and is then sent on `ask.answer` is refused naming `method`,
  not `once`: the verifier checks the method before it spends or checks the once, in the design's order (a field left
  out, method, hub, time, once).
- **The merge base's format** (`signature` a string over the params with `device` in them, #34's signer) is refused at
  `/params/signature…` or at `/params/device`, on `ask.answer` and on `ask.undo` alike, and counts for nothing.
- **The hub's clock** is the one the verifier reads: hubs start with `DEEP_HUB_TEST_CLOCK_STEPS=1` (the base's), the
  tests read it with `test.clock {advance_ms: 0}` and step it with `test.clock {advance_ms}` on a CLI connection. The
  time cases run before any step. Asks for undo cases wait 3 minutes; a 4-minute step defaults them (authority asks
  default to no) and the base's asks tick takes the default within a second.
- **A spent `once` stays spent across a restart** of the hub on the same root (stopped by PID, `deep hub run` again).
- **The plant:** `DEEP_HUB_PLANT=signature-skips-time`, added to `packages/hub/src/plant.ts`'s list by the implementing
  change: the one verifier with its `at` check left out (any `at` counts), every other check as shipped. The kit must
  fail on it at the 11-minute case only.
- **"Its kit"** is read as the row's own scenario set (`signatureKit` in this folder), as #880's plant fails its
  scenario; no conformance-package kit is required.
- **Test-only settings used**, all the base's: `DEEP_HUB_TEST_CONFIRM` (#34's OS stand-in; it says yes only while a
  test pairs a device or answers from the CLI twin), `DEEP_HUB_TEST_CLOCK_STEPS=1`, `DEEP_HUB_PLANT`, `TZ=UTC`.
- **No CLI command** is new: the CLI twin in AC3 is `ask.answer` on a `cli` connection, `deep inbox answer`'s path.

## Readings where the issue leaves a choice

- **"Another method" (AC1)** is `ask.answer` with the undo's own params, `{ask}`: the only method the base serves whose
  params are the same bytes as an undo's. On the merge base the undo's signature passes the check there and the call
  is refused only because an answer needs an option (`/params/option`): that is "the merge base accepts it".
- **"The merge base accepts it" / "refuses it"** are shown by the base run (`BASE-FAILURE.txt`), not asserted as
  passing on the branch. The merge-base-format tests in AC1 and AC2 pass on the branch and fail on the base at the
  point the issue names.
- **"Replayed" (AC2)** is the issue's own case: the same signed undo, counted once, sent again after its ask defaults
  again and while its `at` is within 10 minutes, so `once` is the only field that differs.
- **"The card's flow is otherwise unchanged" (AC3)** is read against the CLI twin, which this issue doesn't touch: the
  same record (`ask.answered`'s fields the agent's delivery reads) and the same `ask.card` before and after, with the
  ask's own handle, question, key, times, pin and plan taken out.
- **The window's edge.** 9 minutes counts and 11 doesn't, so a hub with a shorter window fails too.

## Files

- `helpers.ts`: temp folders, the world (asks seeded through the asks core, the hub, the app's paired device, app and
  CLI connections, the hub's ID), restart, the hub's clock, the design-format signer `signNew`, the merge base's
  `signOld` (#34's), the inbox and record reads, and the judges (`refusedNaming`, `refusedSignature`, `answeredNothing`).
- `scenarios.ts`: the row's cases and `signatureKit`.
- `method.test.ts` (AC1), `fields.test.ts` (AC2), `answers.test.ts` (AC3), `unpair.test.ts` (AC4), `threat.test.ts` (AC5).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base, with each test's reason. No implementation was run; a throwaway patch in a
  scratch copy, used only to check the suite, passed all 12, and three mutants of it failed the tests naming them.
