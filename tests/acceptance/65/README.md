# Acceptance tests for #65: channels, asks and tasks on your phone, a chat app or email

Written blind, from the issue, `docs/technical-design.md` and base commit `2735a7dd` (origin/main). Never edit these; a dispute goes to this job's blind redraft (design: Dogfooding).

What this job read: issue #65 (Scope, its 16 criteria, Proof, References, Depends on) as of November 4, 2026; in the design, "Blocks for plug-ins that do real work" (Channel, Send), the Extension API listing (`deep.registerChannel`), the Threats row for Channel, the hub-slot row for `deep.registerChannel` / `channel@1`, "Socket roles and contract versions" (the trusted path is a device you paired; one canonical form before any hash), the Message check, "Where they reach you", Dogfooding, and the Decided rows "The first channels", "Answers from the terminal" and "What an answer authorizes"; `AGENTS.md`; the suites `tests/acceptance/55` (closest analog), `34`, `318`, `319`, `349`, `363`, `24`, `16`, `320`; at base, the public surfaces of `packages/hub` (`ask.answer`, `device.pair`, `trusted.ts`, `inbox.read`, `events.read`, `test.clock`, `plant.ts`, the paseo hook lines and the paseo-bound `deep mcp`), `packages/asks`, `packages/extension-host` (slots, kits at install, `deep.fetch`, `deep.config.get`), `packages/conformance` (`slotKits`, `runKit`, `cleanFills`, the route kit), `packages/paseo`, `packages/contracts` and `packages/cli` (`deep install`, `deep inbox`). The dependencies #139, #318, #319, #320, #34, #55 and #13 were read only to keep their scope out.

## Run

```sh
npm ci && npm run build --workspaces      # the tests run the built CLI: deep hub run, deep install, deep mcp
scripts/lease cargo build --locked -q -p deep-hook   # the hub won't start without target/debug/deep-hook
node node_modules/vitest/vitest.mjs run --testTimeout=600000 --no-file-parallelism --root tests/acceptance/65
node node_modules/typescript/bin/tsc -p tests/acceptance/65/tsconfig.json
```

- Node 24.22 (type stripping on; Homebrew's Node 23 breaks the check sandbox), on macOS. `--no-file-parallelism`: every test starts its own hub and installs channel plug-ins in the platform sandbox, and AC13 holds a phone silent for two real minutes.
- Every hub runs under `HOME=/tmp/dh16-*/h` (#16's helpers), so its root is `<tmp>/h/.deepbuild`; the real `~/.deepbuild` is never touched. Each hub has `DEEP_HUB_TEST_CONFIRM` set to #34's stand-in, saying yes, so no real Touch ID prompt appears, and `TZ=UTC`. Processes are stopped by PID, never by name or port.
- No network beyond 127.0.0.1, no model, no account, no real phone. With `--root` here Vitest writes `tests/acceptance/65/node_modules/.vite`; delete it before committing.
- `DEEP_HUB_PLANT=<name>` set by hand reaches every hub the suite starts, to try a wrong program.

## The worlds

Everything this repo owns runs for real: the hub (`deep hub run`), its record and asks core, the extension host and its sandbox, `deep install` with channel@1 at install, the conformance package's runner, the paseo hook lines and `deep mcp`. What it doesn't own is a stand-in, in `fixtures/providers.ts`:

- **Four providers** on 127.0.0.1, one per channel: paseo's relay to your phone, a chat app with a bot token, an email provider and a text-message provider. Each speaks the provider protocol below, records every request, and lets a test hold or fail a send, go silent, report a second client on its token, or change a card on the way. The person's presses and replies are answers the test gives the provider.
- **paseo's phone app** (`Phone`): an Ed25519 key the test pairs with `device.pair`, which reads the cards the relay holds and signs answers over the card as it showed it.
- **An agent paseo runs**: the test sends the hub the hook lines paseo's plugin sends (#55: `agent: 'paseo'`, the agent's session ID and its `bind` token), and runs `deep mcp` with `DEEP_PASEO_BIND`, as paseo starts it. A held `agent.permission.before` is an authority ask whose answer goes back on the held line; `deep_ask` (kind unblock) is a task proved by the repo's check.
- **Asks in the record** before a hub starts, raised through the real asks core from rows of `ask.sources@1` (`effect.push`, `deep_ask.choice`, `deep_ask.unblock`), as #34's tests seed them.
- **The repo**: a git repo whose `.deepbuild/done.yaml` names one check, `task-done`, a `node --test` file that passes once `done.txt` exists; trusted through Claude Code's workspace trust.
- **The app**: an Ed25519 device paired with `device.pair`, answering through `ask.answer` on an app connection, signed as #34 defines.
- **AC4's planted channel** (`fixtures/planted-channel`): a package whose channel says delivered without calling its provider.

## Criteria

| ID | Criterion | Tests | Wrong program it fails on |
|----|-----------|-------|---------------------------|
| `#65.82812f3b` AC1 | answered on one channel, gone from every other and from Needs you within 10 s | `redraft-1579/answers.test.ts`; `redraft-1579/proof.test.ts` (both swapped in with the owner's approval after #1579 changed what a paired device signs) | none named |
| `#65.c0406413` AC2 | an authority answer from chat is refused, pointing to the trusted path | `answers.test.ts`; `redraft-1579/proof.test.ts` | none named |
| `#65.19700b29` AC3 | the phone's signed answer reaches the waiting session as a decision; unsigned, it counts as nothing | `answers.test.ts` (two: unsigned, the real phone BLOCKED); `redraft-1579/answers.test.ts` (signed); `redraft-1579/proof.test.ts` | none named |
| `#65.7430b5d9` AC4 | delivered with no acknowledgement: recorded stalled, fails channel@1 at install, naming the item | `kit.test.ts` (two: the kit's planted fill, and `deep install` of the planted package) | the planted fill `delivered-without-ack`; the package `fixtures/planted-channel` |
| `#65.bd21c26c` AC5 | an answer with a forged signature or an unheld account link is refused, naming the key or the link | `proofs.test.ts` (the unheld link); `redraft-1579/proofs.test.ts` (the forged signature); `kit.test.ts` (the planted fill) | `trusts-channel-proof` (hub); the planted fill `signed-without-signature` |
| `#65.fc037c24` AC6 | no payload holds a secret-shaped string, a diff or evidence, on recorded items | `routes.test.ts` | none named |
| `#65.0a1ebdd7` AC7 | an unseen urgent item moves on after its wait; quiet hours hold what isn't urgent | `routes.test.ts` (two) | none named |
| `#65.2fec5389` AC8 | a text message is only a link; an unproven "I did it" is refused | `routes.test.ts`; `proofs.test.ts` | none named |
| `#65.a9fef351` AC9 | an item reaches a channel within 10 s, a plug-in under 50 MB, against the merge base | `budgets.test.ts` (three) | none named; off the reference Mac or under load, INCONCLUSIVE |
| `#65.05709fd8` AC10 | B on the phone, C in the app 2 s later: B stands, C refused naming B and its channel | `redraft-1579/answers.test.ts` | `last-writer-wins` (hub) |
| `#65.af4419b9` AC11 | a card in flight ends showing the app's answer; a press on a closed card changes nothing; a failed send closes nothing | `sends.test.ts` (three) | `live-buttons-after-answer`, `closes-on-failed-send` (hub) |
| `#65.b9ca998f` AC12 | a second client on the bot token: conflict, nothing delivered | `sends.test.ts` | `takes-turns-at-token` (hub) |
| `#65.fbb68832` AC13 | the phone silent 2 minutes: reconnected; chat not delayed, nothing resent | `sends.test.ts` | `reconnects-every-channel` (hub) |
| `#65.08d3ff31` AC14 | an authority ask on chat: no buttons, the words; a choice: answerable and first | `routes.test.ts` | `buttons-for-authority` (hub) |
| `#65.fdfea15b` AC15 | an unpaired phone's signature counts for nothing; its next connection is told | `redraft-1579/proofs.test.ts` | `keeps-unpaired-key` (hub) |
| `#65.84e09e8f` AC16 | a replayed, a stale and a changed-card answer are each refused, naming the field | `redraft-1579/proofs.test.ts` (three) | none named |

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed. `twins.json` maps each criterion that names a wrong hub to its twin under `twins/`. The Proof is `redraft-1579/proof.test.ts`, one end-to-end test tagged AC1, AC2 and AC3; it replaced this draft's `proof.test.ts`, whose phone signed in the format #1579 replaced, with the owner's approval.

## The surface (my choice)

The issue and the design name `deep.registerChannel`, `deliver({summary, link, thread_key})` → delivered | stalled | timed_out, `receive()` → `{thread_key, answer, signature | account_link_id}`, the `channel@1` kit with its two planted fills, the trusted path, Needs you and the record; not these paths, fields and methods. An implementation must provide exactly these.

**The channel plug-ins.** Four DeepBuild packages, `packages/channels/paseo`, `packages/channels/chat`, `packages/channels/email` and `packages/channels/text`, each a folder with a `deepbuild.json` that `deep install <folder>` installs (id and version are the implementer's). Each calls `deep.registerChannel(name, channel)` once, `name` being its folder's name. Installed with `deep install` once the OS confirms you, each passes channel@1 at install and loads, and `deep install` exits 0. How the hub grants a channel the host of its `api` is the implementer's; the tests write the settings below and install.

**`deep.registerChannel(name, channel)`**, a new extension API method; `channel` is a channel@1 fill:

```ts
interface Channel {
  slot: 'channel@1'; revision: 1;
  kind: 'device' | 'chat' | 'email' | 'text';      // paseo's is 'device'
  deliver(item: Item, ctx: Ctx): Promise<Delivered>;
  receive(ctx: Ctx): Promise<Received>;
}
type Delivered = { outcome: 'delivered'; ack: string } | { outcome: 'stalled' } | { outcome: 'timed_out' } | { outcome: 'conflict'; conflict: string };
interface Received { answers: ChannelAnswer[]; seen: string[]; conflict: string | null }   // seen: thread keys the provider says you saw
type ChannelAnswer = { thread_key: string; answer: string; signature?: { signed: Signed; sig: string }; account_link_id?: string };
interface Ctx {
  settings: Record<string, unknown>;   // the channel's entry in channels.json, without `token`
  // The hub's call to `settings.api + path`, with a JSON body; it adds `authorization: Bearer <token>` when the entry has
  // a token, so a plug-in never holds it; a call the provider doesn't answer within the hub's timeout rejects.
  fetch(request: { method: 'GET' | 'POST'; path: string; body?: unknown }): Promise<{ status: number; body: unknown }>;
}
```

The hub calls each channel's `receive` at least once a second, except a channel in conflict, which it calls no more. A `delivered` without a non-empty `ack` is recorded as `stalled`.

**`<HOME>/.deepbuild/channels.json`**, mode 0600, read when the hub starts:

```jsonc
{
  "channels": { "<name>": { "api": "http://127.0.0.1:<port>", "token": "<bot token>"?, "to": "<address or number>"? } },
  "routes": [ { "kinds": ["authority", …], "to": ["paseo", …], "urgent": true?, "next": ["chat", …]?, "unseen": "5m"? } ],
  "quiet": { "from": "22:00", "to": "07:00" } | null
}
```

An ask goes, once it shows in Needs you, to every channel in `to` of the first route naming its kind; no route, no channel. An urgent route's item no channel reported `seen` within `unseen` (a duration as the ask settings write them) also goes to every channel in `next`. In quiet hours, in the hub's local time, only items of urgent routes go out; the rest are held and go out when quiet hours end. Routing reads the hub's clock: after a `test.clock` step, what the new time makes due goes out within 10 s.

**The provider protocol**, what each plug-in speaks to its provider through `ctx.fetch` (the stand-ins in `fixtures/providers.ts`):

- `POST /messages` with `{ to: settings.to ?? null, item }`, the item as the hub handed it: `200 {ack}` is delivered with that ack; `409 {conflict}` is conflict; any other status is stalled; no answer is timed out.
- `GET /answers?after=<cursor>` (no `after` on the first call): `200 { answers: [{ thread_key, answer, signature?, account? }], seen: [thread_key], cursor }`, the plug-in passing `signature` on unchanged, `account` as `account_link_id`, and `cursor` as the next call's `after`; `409 {conflict}` is conflict.
- The chat provider takes only requests with its token (401 otherwise).

**The item**, deliver's first argument, which the hub renders per channel:

```ts
interface Item {
  thread_key: string;          // the ask's handle, ask:<ULID>: one thread per item on every channel
  summary: string;             // the hub's words; '' on a text channel
  link: string;                // one URL (no whitespace) to the item, the same on every channel
  answerable: 'answer' | 'view' | 'cancel' | 'closed';
  options: { id: string; label: string }[];   // the answer buttons: [] unless answerable is 'answer'
  revision: number;            // the card's revision, an integer ≥ 1
  hub: string;                 // this hub's ID: the same across its restarts, different on another hub
  refused: string | null;      // the reason the hub refused the channel's last answer on this thread, else null
  unpaired?: { device: string; by: string };  // the notice to a device that it was unpaired, `by` the Mac (os.hostname())
}
```

- On a `device` channel every open item is `answer`. On `chat` and `email`, a choice, taste or unblock is `answer` when the hub holds a verified account link for that channel, else `view`; an authority ask (and an exception or definition) is always `view`, with no options and the words "answer in the app or on your paired phone" in its `summary`. On `text` every item is `view` with `summary: ''`, `options: []` and `refused: null`: a text message carries only the link. When several items are due on one channel at once, the answerable ones go first.
- No item carries a secret, code, a diff, evidence or an evidence hash, whatever the ask's question or plan holds.
- When an item closes (answered anywhere, defaulted, moot), the hub delivers it once more on every channel it was delivered on, `answerable: 'closed'`, `options: []`, its `summary` naming the chosen option's label; within 10 s of the answer, and once a send still in flight when it closed has ended. A send that fails closes nothing, on any channel or in Needs you.
- An answer the hub refuses on an open item comes back to its channel as the item again with `refused` set to the reason. A press on a closed item changes nothing: no card, no answer, no decision.
- After `device.unpair`, the hub delivers to every `device` channel an item with `unpaired: { device, by }` (its `thread_key` is the device's ID).

**What an answer counts as.** A channel answer counts only after the hub checks its proof, never on the channel's word:

- `signature.signed` is `{ device, ask, revision, card_hash, hub, at, answer }`: the device ID `device.pair` returned, the ask's handle, the card's revision, the SHA-256 hex of the RFC 8785 bytes of `{summary, options}` as the item carried them, the hub's ID, ms since the epoch, and the option. `sig` is base64url of the Ed25519 signature over the RFC 8785 bytes of `signed`, by the device's paired key. The hub checks, in order, naming the first field that fails: each of `device`, `ask`, `revision`, `card_hash`, `hub` and `at` is there (the missing one); `hub` is this hub's (`hub`); `device` is paired and not unpaired (`device`); `sig` verifies (`signature`); `at` is within 10 minutes of the hub's clock (`at`); `ask` is the thread's and `revision` the card's current one (`ask`, `revision`); `card_hash` is the hash of the card the hub sent on that thread to that channel (`card_hash`); `signed.answer` is the answer (`answer`). An answer that passes all of these is on the trusted path.
- An `account_link_id` counts only when the hub holds a link of that account for that channel (`account_link_id`). It makes a choice, taste or "I did it" answer count; never an authority answer, or one that saves a decision or changes what a check demands.
- An answer with neither counts for nothing. An authority answer that isn't on the trusted path is refused with a reason saying `trusted path`.
- Counted, a channel answer is the asks core's answer, as `ask.answer`'s is (so "I did it" runs its check again, and a trusted-path answer is saved as a decision as the app's is); the first answer appended stands, and a later one, from any channel, the app or the CLI, is refused naming the first answer's option and its channel (`ask.answer`'s error says both).

**In the record** (`events.read`), each core-written:

- `channel.delivered` per `deliver` call: subject the thread key, `data: { channel, thread_key, item, outcome, ack }`, `item` exactly as handed over and `outcome` as recorded (`stalled` for a delivered without an ack).
- `channel.refused` per refused answer: subject the thread key, `data: { channel, thread_key, answer, field, reason }`, `field` the field named above or null, `reason` naming the device ID or the account where one is at fault.
- `channel.conflict` when a channel reports conflict: `data: { channel, conflict }`, `conflict` the provider's words; from then on the hub calls that channel no more until you remove one of the clients.

**Hub methods**, beside `device.pair`, `ask.answer`, `inbox.read`, `events.read` and `test.clock` as they are:

- `channel.link { channel, account }` → `{ channel, account }`: links your account on a channel, counting only once the OS confirms you, as `device.pair` does.
- `device.unpair { device }` → `{ unpaired: device }`: on the trusted path, as `device.pair`; from then on the device's signatures count for nothing.

**The kit.** `slotKits()` of `@deepbuild/conformance` holds a kit with `slot: 'channel@1'` whose `planted` include `delivered-without-ack` and `signed-without-signature`, each failing it under `runKit`, while every fill `cleanFills` gives passes. Its fixtures' inputs carry items with `thread_key`s; a failing case of `delivered-without-ack` says `stalled` and names the item's `thread_key`. The hub runs it at install on each channel a package registers; a package that fails it isn't loaded, and `deep install` exits non-zero printing the failure (naming `channel@1`, `stalled` and the thread key).

**The budget.** `benchmarks/channels.mjs` exits 0, its last stdout line `{"reach_ms": <ms from an ask to its card at a provider>, "rss_mb": {"paseo": …, "chat": …, "email": …, "text": …}}` (each plug-in's memory). `benchmarks/budgets.json` has a task whose `command` includes it and whose `initialReason` names `#65`; `validateBudgets` accepts it against the merge base.

## Wrong programs

Each twin is `packages/hub/src/plant.ts` as base `2735a7dd` has it, with `plantOf` and `activePlant` fixed to its name; the implementation adds each name to `Plant` and `PLANTS` and makes the hub do that wrong thing under it, as #55's hub plant does.

| Value | The wrong program |
|-------|-------------------|
| `trusts-channel-proof` | an answer marked as signed by a paired device, or naming an account link, counts without the signature checked or the link held (AC5) |
| `last-writer-wins` | every answer is taken: the app's C after the phone's B is appended and delivered too (AC10) |
| `live-buttons-after-answer` | a card sent while its ask was answered elsewhere stays as sent, with live buttons (AC11) |
| `closes-on-failed-send` | one channel's failed send closes the ask, in Needs you and everywhere (AC11) |
| `takes-turns-at-token` | the hub keeps calling a provider that said another client holds the token (AC12) |
| `reconnects-every-channel` | one channel stalling reconnects every channel, each sent its open items again (AC13) |
| `buttons-for-authority` | an authority ask goes to chat with live answer buttons (AC14) |
| `keeps-unpaired-key` | an unpaired device's signature still counts (AC15) |

The kit's planted fills (`delivered-without-ack`, `signed-without-signature`) and `fixtures/planted-channel` are inputs the tests run, not twins.

## Timing

A step a criterion bounds (AC1's and the Proof's 10 s to close, AC7's 10 s once due, AC13's 10 s to chat) must happen within a minute at all, or the test FAILs; past its bound it FAILs, unless the machine's 1-minute load is past its core count, when it reads INCONCLUSIVE (a skip whose message says so and prints the readings), never PASS. AC9's numbers count only on a reference Mac (#40's `environmentProblem`) in a fit state and unloaded; anywhere else they are printed and read INCONCLUSIVE. The comparison with the merge base is the perf lane's task.

## Readings where the issue leaves a choice

- **No provider is reachable**, so the four plug-ins speak one small protocol to stand-ins; a real provider's API is the plug-in's to speak beyond these tests. paseo's real phone app can't be reached at all: AC3 has a test that reads BLOCKED saying so, and the stand-in phone proves the hub's side.
- **AC4's "recorded as stalled"** is read at the kit: a planted channel that fails channel@1 at install never loads, so its delivery is recorded as stalled where the kit runs it, in the kit's failing case and in what `deep install` prints. The hub's own rule (a delivered without an ack is recorded stalled) is in the surface.
- **AC5's planted channel at the hub** is a real channel plug-in carrying what a forging provider handed it: the hub can't tell a channel that forges from one that faithfully carries a forgery, and must refuse both. A channel that forges on its own fails channel@1 (the kit's planted fill).
- **"The paired device key" and "the key" (AC5, AC15)** are named by the device's ID from `device.pair`, in `channel.refused`'s reason.
- **AC10's "naming both channels"** is the failure message naming paseo's B and the app's C.
- **AC12's "two copies"** is the provider reporting a second client on the token (as Telegram's `getUpdates` answers 409); "taking turns" is any call to that provider after it said so.
- **AC13's "reconnects"** is the paseo channel's item reaching the phone once its connection is back; "resends nothing" is no identical card accepted twice on chat; "delays nothing" is the item raised during the silence reaching chat within 10 s. The silence is two real minutes.
- **AC8's "I did it"** comes by email, a channel with neither a paired device nor an account link. A verified account link is one you made with `channel.link` once the OS confirmed you.
- **"Gone from every other channel" (AC1)** is the closing card on each, text included (its closing card is the link alone); "gone from Needs you" is `inbox.read`'s row `status: 'closed'`.
- **"By which Mac" (AC15's Scope line)** is `os.hostname()`; the test checks only that `by` is there.
- **Urgency** is the route's: "everything you didn't mark urgent" is what no `urgent` route names. Quiet hours are in the hub's local time; the hubs here run with `TZ=UTC` and the test clock.
- **"Answerable first" (AC14)** is the order the chat provider accepted the cards, the authority ask having been raised first.

## How far these tests were checked

Type-checked with this tsconfig. Run on base: every test fails, for the missing channel plug-ins, the missing channel@1 kit, `deep install` not naming channel@1, or the missing budget task, and the real phone BLOCKED (`BASE-FAILURE.txt`). The harness parts that exist at base were run against the base hub with a throwaway probe: a paseo agent's turn and its `DEEP_PASEO_BIND`-bound `deep mcp`, `deep_ask` raising a task whose "I did it" (from `deep inbox answer`) ran `task-done` again to `passed`, a held paseo permission request answered approve returning `{"decision":"allow"}` with a `decision.created`, asks seeded with a secret-shaped question, and a hub started on the test clock. Never run against an implementation, because none exists: every scenario past the hub's start, and the twins.
