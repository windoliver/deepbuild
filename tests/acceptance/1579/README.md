# Acceptance tests for #1579: a signature says what it's for

Written first and blind, at base commit `6042ef5a`, from issue #1579 (Scope, five acceptance criteria, Proof), the design and
the base, before any implementation. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

## What was read

- Issue #1579.
- `docs/technical-design.md`: Socket roles and contract versions (The trusted path is a device you paired); An ask, and your
  answer getting back; Threats, and what stops each one; Dogfooding.
- At the base: `packages/hub/src/{trusted,core,channels,server,wire,plant,identity}.ts`, `packages/asks/src/index.ts`,
  `crates/deep-app/src/{device,answer,hub}.rs`, and the suites `16`, `34`, `65`, `1454`.

## How to run

With Node 24.22 first on `PATH`, the workspaces built (`npm ci --ignore-scripts; npm run build --workspaces`) and cargo:

```sh
npx vitest run --root tests/acceptance/1579 --no-file-parallelism        # the suite
node node_modules/typescript/bin/tsc -p tests/acceptance/1579/tsconfig.json
npx vitest run --root tests/acceptance/1579/base                          # the merge base's behaviour (below); at the base only
```

- Every hub runs from `deep hub run` with `HOME` a temp folder (#16's helpers), `DEEP_HUB_TEST_CONFIRM` set to #34's stand-in,
  which says no unless a test says yes, so only a signature can make anything count, and `DEEP_HUB_TEST_CLOCK_STEPS=1`.
  Only processes a test started are stopped, by PID.
- `app.test.ts` builds deep-app's `acceptance_1579` test target once (`cargo test --locked -p deep-app --test acceptance_1579
  --no-run`; a cold target compiles gpui-kit) and runs that binary with `HOME` set to the app's own temp home.
- With `--root` here, Vitest writes `tests/acceptance/1579/node_modules/.vite/`; delete it before committing.

## The surface

The issue names what a signature covers but no wire format, so these tests pin the smallest one that reaches every
criterion. It is the channel path's shape (`signature: { signed, sig }`, packages/hub/src/channels.ts) moved to every method
the trusted path guards, so one verifier can read both. The tests reach it only through the hub's socket (`ask.answer`,
`ask.undo`, `device.unpair`, `device.pair`, `inbox.read`, `events.read`, `test.clock`) and the app's own send path.

### Pinned here: the implementation must provide these

1. **Where the signature lives.** A signed request's params are the method's own params plus one field, `signature`:
   `{ signed: { device, method, hub, at, once, params_hash }, sig }`. Nothing else is added to the params, so `device.unpair`'s
   `device` (the device to unpair) and the signer's `signature.signed.device` never share a param. The base's top-level
   `device` beside a string `signature` no longer counts.
   - `device`: the signer's ID from `device.pair`.
   - `method`: the socket method the request is sent on, e.g. `ask.undo`.
   - `hub`: the hub's ID, the `hub` of the hub's hello line (packages/hub/src/server.ts sends it at the base); that is how a
     client learns it.
   - `at`: when it was signed, ms since the epoch, on the hub's clock (the wall clock, as `test.clock` reports it).
   - `once`: a once-only ID the signer makes fresh for each signature, a string of up to 200 characters.
   - `params_hash`: SHA-256, lower-case hex, of the RFC 8785 bytes of the params with `signature` left out.
   - `sig`: Ed25519 by the device's paired key over the RFC 8785 bytes of `signed`, base64url.
2. **What counts.** A signature counts only when every field holds: a paired device, a `sig` that verifies, `method` the method
   called, `hub` this hub's ID, `at` within 10 minutes of the hub's now (a time 9 minutes old counts, 11 doesn't), `once` never
   spent before, and `params_hash` the params sent. It is judged before anything else in the params is, so the refusal names the
   signature's field even when the method's own params would also be refused. A signed `ask.undo`, `ask.answer` and
   `device.unpair` all count with no OS prompt.
3. **Once.** A spent `once` is kept (the issue: in a table with a time index) and survives a restart of the hub. A replay from
   another connection is refused. These tests never retry the same write on the same connection, which #1577 governs.
4. **The refusal.** The reply's `error` (error@2, as `refusal()` makes it) has `path` `/params/signature/signed/<field>`, the field
   that failed: `method`, `hub`, `at`, `once`, `params_hash` or `device` (a device never paired, or unpaired). For `method` its
   `remediation` holds the method the signature was made for; for `hub`, the hub ID it was made for. A refused request changes
   nothing: the ask stays open, or stays defaulted.
5. **The planted wrong program `signature-skips-time`** (`DEEP_HUB_PLANT`, in `packages/hub/src/plant.ts`): the one verifier,
   with the `at` check skipped and every other check kept.
6. **The app.** deep-app signs with its own key in the format above, for the hub its hello names, and `deep_app::answer::send`
   stays its send path. The implementer adds this to `crates/deep-app/Cargo.toml`:
   ```toml
   [[test]]
   name = "acceptance_1579"
   path = "../../tests/acceptance/1579/app/answer.rs"
   ```
7. **The threats table** (docs/technical-design.md, Threats, and what stops each one) gets a row whose threat names a signature
   or signed answer used again (or replayed, reused, on another method), and whose mitigation says: the method, the hub's ID, the
   time, a once-only ID, the hash of the params, 10 minutes, spent IDs kept, and one verifier.

## Criteria to tests

| Criterion | Tests |
|---|---|
| AC1 an undo's signature is refused on another method, naming it | `signatures.test.ts` AC1 (two); base: `base/merge-base.check.ts` AC1 (two) |
| AC2 11 minutes old, another hub, replayed: each refused naming the field | `signatures.test.ts` AC2 (six, incl. the base's format refused); base: AC2 (two) |
| AC3 the app's new-format answer counts, the flow otherwise unchanged | `app.test.ts` AC3 (the app's own signer; the hub's half; the judge held to the base's format) |
| AC4 a signed unpair works | `signatures.test.ts` AC4 (three); base: AC4 |
| AC5 the threats row; a verifier that skips the time fails its kit | `design.test.ts` AC5 (two); `signatures.test.ts` AC5 (the kit on the real hub, and on the plant) |

"Its kit" is read as the verifier's own case set, `verifierKit` in `helpers.ts`: a good signature, and one wrong in each of
`method`, `hub`, `params_hash`, `at` and `once`. The real hub passes every case (so the kit is no wall); the planted hub must fail
the `at` case alone. The channel path's own kit (`channel@1`, #65) is left as it is.

## The merge base

`base/merge-base.check.ts` asserts what the base does, for the issue's Proof: an undo the app signs as the base signs counts,
and the same signed params, sent as `ask.answer` to the ask it opened, count too (AC1, "the merge base accepts it"); a signature
11 minutes old counts, and a signed undo replayed after the ask defaults again counts again (AC2); a signed unpair is refused
whichever device signs it (AC4, "the merge base refuses it"). The base's format names no hub, so there is nothing to run for
the other-hub case. These checks fail once #1579 lands, by design, so they sit outside the suite's include.
`BASE-FAILURE.txt` holds both runs.
