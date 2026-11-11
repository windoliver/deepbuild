# Acceptance tests for #1580: a phone's yes covers what the phone showed

Written first, blind, by a job that never saw an implementation of #1580; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The issue has four checkbox criteria, AC1 to AC4 in the body's order. Each `describe` and `it` name carries its
criterion's ID (`#1580.` and the first 8 hex digits of SHA-256 of the checkbox's text after `- [ ] `, trimmed, white
space collapsed, as `scripts/proof-change.mjs` reads it).

## Sources read

- Issue #1580 as the job's brief quoted it: title, body, Epic #6, Design links, Scope, the four criteria, Proof ("A
  signed yes refused for a changed plan, on this branch and the merge base"), Depends on #1579 (merged in this base).
  Not read from GitHub.
- `docs/technical-design.md`: the **Channel.** bullet under "Blocks for plug-ins that do real work" (a card with a plan
  carries the plan's steps and hash to a channel that can draw them; the signed fields include that hash, which the
  hub never fills in; a channel that can't draw the steps shows the item view only; a card's revision rises when its
  text or plan changes and on Take over, which moves a card to this device on the trusted path, so an answer from an
  older copy is refused, naming the revision); the bullet "The trusted path is a device you paired" (the signature's
  shape, `channel.answer` over `{ask, revision, card_hash, answer}` carried beside `signed` as `params`, refusals
  naming the field); the Threats row "Approvals that drift"; "An ask, and your answer getting back" (Asks stay current,
  Where they reach you); "Plans before acting"; Dogfooding. `AGENTS.md`.
- At the base `de304b9f` (main), for surfaces and conventions only: `packages/hub/src/channels.ts` (`render`,
  `cardHash`, `signedWrong`, the item, `revision: 1`), `trusted.ts` (`Devices.verify`), `core.ts` (`answer`, where
  the hub fills `plan_hash` in for a phone's allow, `trusted`, `askCard`, `channelAsks`, the channels' wiring),
  `server.ts` (the method table), `packages/asks/src/index.ts` (raise with a plan, `plan.proposed`, "the plan an ask
  shows is the first one proposed for it", the card, the approval's `plan_hash` check),
  `packages/record/src/projections.ts` (nothing edits an open ask's words), `packages/channels/*`,
  `packages/contracts/slots/channel@1.json`, `packages/extension-host/src/host.ts` (`deep.registerChannel`),
  `packages/conformance/src/slots/channel.ts`; the suites `tests/acceptance/65` and `65/redraft-1579` (the providers'
  stand-ins, the phone's signer, imported), `1579` (signature format, README layout), `34` (the OS stand-in, imported),
  `16` (hub process, imported).

## Criteria to tests

| AC | ID | File | Test |
|---|---|---|---|
| AC1 | `#1580.c589397a` | `plan.test.ts` | The phone signs a yes over the push ask's card as the paseo relay shows it. The hub stops; the core proposes another plan for the ask; the hub starts again and the signed yes arrives: refused, `channel.refused` naming `plan_hash`; no `ask.answered`; still open in Needs you. The card it signed carried the plan's hash and steps. The card then carries the new plan, and a yes over it counts, its `ask.answered` binding the new plan's hash. This is the Proof's case; on the merge base the same steps count the stale yes (`BASE-FAILURE.txt`) |
| AC2 | `#1580.e4bc2c78` | `view.test.ts` | The planted `watch` channel (a device channel declaring it can't draw steps) gets the push ask's card as `view`, no options, its summary holding the question and "answer in the app"; a choice ask (no plan) is `answer` there |
| AC3 | `#1580.96c9855a` | `take-over.test.ts` | Control: the app's signed answer counts on a second ask. The app reads its copy (`ask.card`); the phone takes the card over (`ask.take_over`, signed by the phone): no error, and the phone's relay gets the card at a higher revision. The app's answer from its old copy is refused, the error naming `revision`, and counts for nothing. The phone's answer over its card then counts |
| AC4 | `#1580.787b444a` | `words.test.ts` | The phone signs over a choice ask's chat card as it reads before you link your chat account; `channel.link` changes the card's words; the signature arrives through chat: refused, `channel.refused` naming `revision`; nothing counted. A signature over the card as it reads now counts |

## Run

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci --no-audit --no-fund
npm run build --workspaces                  # the tests run packages/cli/dist/main.js (deep hub run, deep install)
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook   # the hub won't start without it
NO_COLOR=1 npx vitest run tests/acceptance/1580/plan.test.ts --testTimeout=600000 --no-file-parallelism
NO_COLOR=1 npx vitest run tests/acceptance/1580/view.test.ts --testTimeout=600000 --no-file-parallelism
NO_COLOR=1 npx vitest run tests/acceptance/1580/take-over.test.ts --testTimeout=600000 --no-file-parallelism
NO_COLOR=1 npx vitest run tests/acceptance/1580/words.test.ts --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1580/tsconfig.json
```

Node 24.22 (an official build: `deep install` runs the channel plug-ins in the platform sandbox), macOS. Each world is a
temp home under `/tmp/dh1580-*` (the OS stand-in's folder is #34's, under `/tmp/dh16-*`), `HOME` there for the hub, the
real `~/.deepbuild` never touched; every hub is stopped by its PID and the folders removed after each test. No network
beyond 127.0.0.1, no model, no real phone. Nothing is timed, so the suite needs no `alone` entry in
`scripts/lanes.mjs`; each test starts one hub (AC1 starts it twice) and installs one channel.

## The worlds

As #65's: a real hub, the channel plug-ins installed with `deep install`, the providers as #65's stand-ins
(`../65/fixtures/providers.ts`: the relay records each card it was sent, and a test gives it the person's answers),
asks raised through the real asks core before the hub starts, the OS confirmation stubbed to say yes (#34's
`Confirmer`). Two devices are paired with `device.pair`: the phone and the app's. Both sign in #1579's format,
`signature: {signed: {device, method, hub, at, once, params}, sig}`, `hub` read from the hub's hello.

## Surfaces this suite chose

The issue and the design leave these open; an implementation must provide them as written here.

- **The plan on the card.** A card with a plan, sent to a channel that can draw steps, carries `plan: {hash, steps}`
  beside the item's other fields: `hash` the plan's hash as the asks core holds it (`ask.card`'s `plan.hash`), `steps`
  the plan's steps. The tests check the hash exactly and only that the steps hold each step's `does`.
- **The signed fields.** The phone's answer is signed for `channel.answer` over `{ask, revision, card_hash, plan_hash,
  answer}` when its card carries a plan (`plan_hash` the card's `plan.hash`), and over `{ask, revision, card_hash,
  answer}`, with no `plan_hash`, when it carries none, as the design's format reads. `card_hash` stays #65's: the
  SHA-256 hex of the RFC 8785 bytes of `{summary, options}` as the item carried them. A yes that counts is recorded
  with the `plan_hash` the phone signed.
- **How a plan changes on an open ask.** The core proposes another plan for it: a `plan.proposed` written by the core
  for the same ask, the record's own kind for a plan, as the asks core writes one when it raises an authority ask. The
  card shows, and a yes binds, the newest plan the core proposed. (The base shows the first one, so this is new.) The
  test appends it to the hub's record while the hub is stopped and starts the hub again on the same root, since the
  hub holds its record while it runs and no method of the base writes a second plan.
- **Naming the hash.** A yes refused for a changed plan is recorded as `channel.refused` with `data.field:
  'plan_hash'`, though its revision may have risen with the plan too.
- **A channel that can't draw steps** declares so on its channel@1 fill, the object it passes `deep.registerChannel`:
  `steps: false`. The planted `watch` package (`fixtures/watch`, paseo's code under another name, `kind: 'device'`)
  declares it. How a channel that can draw them, such as paseo, says so is the implementation's.
- **The item view only, saying where to answer:** `answerable: 'view'`, `options: []`, and a `summary` holding the
  question and the words "answer in the app" (case aside), as #65's "answer in the app or on your paired phone" does.
- **Take over** is `ask.take_over {ask}` on the hub's socket, on the trusted path: signed in #1579's format, for the
  method `ask.take_over`, by the paired device the card moves to. The phone's call is made on an app connection, as
  #1579's suite makes the phone's calls. It replies without an error; the card's revision rises and the device's
  channel gets the card again at the higher revision.
- **The app's old copy** is the card `ask.card` returned on an app connection before the Take over. The app answers
  from it with `ask.answer {ask, option}` signed by its own device, adding `revision` when its copy carries a numeric
  `revision`. "Naming the revision" there: the reply is an error whose JSON contains the word `revision`.
- **A card whose words changed** is a channel's card for an open ask whose text the hub changed on that thread: the
  chat card of a choice ask, which reads as the item view saying where to answer until you link your chat account
  (`channel.link`) and as the question with its buttons after. Nothing in the base changes an open ask's own words,
  and this is the one change of a card's text the base makes while its ask stays open. The signature is the paired
  phone's, over the earlier card, carried by the chat channel as channels carry an answer's proof unchanged. Naming
  the revision: `channel.refused` with `data.field: 'revision'`.
- **Test-only settings used**, all the base's: `DEEP_HUB_TEST_CONFIRM` (#34's OS stand-in), `TZ=UTC`.

## Readings where the issue leaves a choice

- **"The merge base accepts it" (AC1)** is shown by the base run (`BASE-FAILURE.txt`): the same steps on the base count
  the phone's yes signed before the plan changed. It isn't asserted as passing on the branch.
- **"After signing" (AC1).** The phone signs while the first plan stands; the plan changes before the signed yes
  reaches the hub. A plan changed on the way to the phone, which the phone then signs, is a different case and isn't
  tested.
- **AC1's control** (a yes over the new plan counts and binds it) and **AC3's and AC4's** (an answer over the card as
  it now stands counts) keep a hub that refuses every phone answer, or never moves the plan, from passing.
- **"Take over from the phone" (AC3)** is the Take over done on the phone, moving the card there, so the app's copy is
  the old one.
- **Which ask.** AC1 and AC2 use a push (an authority ask, which carries a plan); AC3 and AC4 use choices, which carry
  none, so their phone answers sign no `plan_hash` and don't depend on AC1's surface.

## Files

- `helpers.ts`: temp folders, the world (asks seeded through the asks core, `channels.json`, the hub, the phone and
  the app paired, the channels installed), the hub's restart, `proposeAgain` (the core's later `plan.proposed`), the
  planted `watch` package, `planOn` (the plan a card carries), the signers (`signedAnswer` for a channel answer,
  `signedCall` for a signed call on an app connection) and the record reads.
- `fixtures/watch/`: the planted channel's manifest and code (`index.ts.fixture`, renamed `index.ts` in the test's
  copy, its digest set there).
- `plan.test.ts` (AC1, the Proof), `view.test.ts` (AC2), `take-over.test.ts` (AC3), `words.test.ts` (AC4).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: each file's run on the base, with the assertion it failed at.

## Verified, and not

- `tsc -p tests/acceptance/1580/tsconfig.json`: no errors.
- On the base (`BASE-FAILURE.txt`), each file run once: 4 tests, 4 failed, each at a named assertion after its setup
  held. AC1: the base counted the stale yes, binding the first plan (the merge base accepts it). AC2: the watch's plan
  card was answerable. AC3: `ask.take_over` is an unknown method (the app's control answer counted first). AC4: the
  refusal named `card_hash`, not `revision`.
- Not run against an implementation of #1580 (none exists), so the passing path, and each control after the first
  failing assertion, is untried.
