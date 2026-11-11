# Blind redraft of #65's AC3 signed case, signing the plan's hash (#1580)

AC3 `#65.19700b29`, its signed case only: "the phone's signed approve of a held permission request reaches the session
as allow and is saved as a decision". A fresh run of the blind acceptance-test job (AGENTS.md, Proof; design,
Dogfooding) for that one case, at base `de304b9f` ("Merge pull request #2192 …"). It never saw an implementation of
#1580. It edits no test outside this folder; `../` and `../redraft-1579/` are inputs it imports from and doesn't
change.

## The dispute

#1580 changes what a phone signs for a card with a plan: the card carries the plan's steps and hash to a channel that
can draw them (paseo can), the signed fields include that hash, and the hub never fills it in. A yes over a plan
changed after signing is refused, naming the hash.

The frozen case (`../redraft-1579/answers.test.ts`, the `AC[3]` describe) answers a held permission request, an
authority ask, which always carries a plan. Its stand-in phone (`../redraft-1579/fixtures/phone.ts`, `Phone.answer`)
signs `channel.answer` over `{ask, revision, card_hash, answer}` only. On a hub that follows #1580 that answer leaves
`plan_hash` out and is refused for it: for the format, not for what AC3 tests. This redraft keeps the case's world,
steps, ids and expected values (the session gets `allow`; the answer is saved as a decision `approve`) and signs as
#1580's agreed surface says.

## What it read

- AGENTS.md; `docs/technical-design.md`: the **Channel.** bullet in "Blocks for plug-ins that do real work" ("A card
  with a plan carries the plan's steps and hash to a channel that can draw them, and the signed fields include that
  hash, which the hub never fills in"), and the bullet "The trusted path is a device you paired" (the signature's
  shape, `channel.answer` over `{ask, revision, card_hash, answer}` carried beside `signed` as `params`).
- Issue #1580's text as the job's brief quoted it (the problem, Scope, AC1).
- #1580's blind suite at `105d2cce`, for its agreed surface only: `tests/acceptance/1580/README.md` ("Surfaces this
  suite chose": the plan on the card, the signed fields) and `helpers.ts` (`planOn`, `signedAnswer`).
- The #65 suite: `../README.md`, `../helpers.ts`, `../fixtures/providers.ts`, and `../redraft-1579/` (README,
  `helpers.ts`, `fixtures/phone.ts`, `answers.test.ts`).
- At the base, `packages/hub/src/channels.ts` and `core.ts`, for surface names only (`signedWrong`, the base filling
  `plan_hash` in from `ask.card` at answer time).

## The one change

The phone (`fixtures/phone.ts`) is a copy of redraft-1579's `Phone` that signs over the card as the relay shows it (the
latest card for the thread), adding `plan_hash` when that card carries a `plan` with a string `hash`:

```
{ signed: { device, method: 'channel.answer', hub, at, once, params: sha256hex(JCS(params)) },
  sig: base64url(Ed25519(JCS(signed))),
  params }
params = { ask, revision, card_hash, plan_hash, answer }   // card carries plan.hash
params = { ask, revision, card_hash, answer }              // card carries no plan
```

`plan_hash` is the card's `plan.hash`; `card_hash` stays #65's (SHA-256 hex of the RFC 8785 bytes of `{summary,
options}`); `revision` is the card's own; `hub` is the ID the hub's hello names (redraft-1579's `hubOf`). The signer
(`paramsHash`, `sigOver`, `newOnce`) is imported from redraft-1579's fixture unchanged. The copy drops the `forged` and
`at` options, which this case doesn't use.

Because the phone reads the plan off the card it was shown, it is right on both hubs: the base sends no plan, so it
signs no `plan_hash` and the base fills the hash in; a hub following #1580 sends `plan: {hash, steps}`, so it signs the
hash and the hub has nothing to fill in.

The test (`answers.test.ts`) is the frozen case with `Phone.of(w.phone, await hubOf(w))` in place of redraft-1579's
`phoneOf`, and the first message also naming the `plan_hash` the phone signed. Its describe and it names, steps and
assertions are the frozen case's.

## Readings

1. **A plan with a string `hash`** is what the phone signs from. #1580's `planOn` also wants `steps` to be an array;
   the phone doesn't, since the hash is the only part it signs and the steps' shape is AC1-of-#1580's to check, not
   AC3's.
2. **The plan passes the relay as sent.** The stand-in relay (`../fixtures/providers.ts`) keeps every field of the
   posted item, so `plan` reaches the phone as the hub sent it.
3. **One case only.** AC3's unsigned and BLOCKED real-phone cases stay in `../answers.test.ts`; the Proof
   (`../redraft-1579/proof.test.ts`, tagged AC3) has the phone answer an unblock task, and only an authority ask
   carries a plan (the base's asks core: "only an authority ask carries a plan"), so its phone's signature doesn't
   change under #1580 and it isn't redrafted here.

## Criterion → test → wrong programs

| ID | Test | Wrong program it fails on |
|----|------|---------------------------|
| `#65.19700b29` AC3 | `answers.test.ts`: "the phone's signed approve of a held permission request reaches the session as allow and is saved as a decision" | none named |

## How to run

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci --no-audit --no-fund && npm run build --workspaces   # the test runs the built CLI: deep hub run, deep install
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook   # the hub won't start without it
NO_COLOR=1 npx vitest run tests/acceptance/65/redraft-1580/answers.test.ts --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/65/redraft-1580/tsconfig.json
```

The world is #65's (`../README.md`, The worlds): a real hub under a `/tmp/dh16-*` home, the paseo channel installed
with `deep install`, its relay a stand-in on 127.0.0.1, the OS confirmation stubbed (#34's `Confirmer`), every process
stopped by PID. No network beyond 127.0.0.1, no model, no real phone.

## Verified, and not

- On the base (`BASE-FAILURE.txt`), run once: 1 test, 1 passed. The base's card carries no plan, so the phone signed
  no `plan_hash`, and the session got `allow` with the answer saved as a decision `approve`.
- `tsc -p tests/acceptance/65/redraft-1580/tsconfig.json`: no errors, after a type-only fix to `planHashOn`'s parameter
  that came after the base run; the test wasn't run again.
- The signer, offline, on the stand-in relay (a scratch check, not committed): for a card with `plan: {hash, steps}`
  the params are `{ask, revision, card_hash, plan_hash, answer}` with `plan_hash` the card's `plan.hash`; for a card
  with no plan, or `plan: null`, there's no `plan_hash`; in each, `sig` verifies with the paired public key over the
  RFC 8785 bytes of `signed`, `signed.params` is the SHA-256 hex of the carried params, and `card_hash` is #65's.
- Not run against an implementation of #1580 (none was shown), so the plan path is proven only offline.
