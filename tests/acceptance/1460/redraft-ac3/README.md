# #1460 AC3, blind redraft: `open` on an ask writes nothing

Criterion `#1460.e8743dab`, verbatim:

> `open` on an ask presents its card unarmed, and the record gains no answer. A planted `open` that writes an event
> fails, naming the event

Written blind at base `96b462a6` (Merge pull request #2051), by a job that never saw an implementation of #1460. It
redrafts only AC3's two real-app tests in `../cli.test.ts` (the plain one and the wrong-program one), with their IDs,
titles, steps and expected values. `../card.test.ts`'s AC3 replica test is not touched. The implementing agent does not
edit these files (AGENTS.md, Proof).

## The dispute

`../cli.test.ts`'s wrong-program test needs `plant-open-writes-event`, an `open` on an ask that writes one event the hub
keeps through the app's hub connection, and its judge (`writtenByOpen` in `../helpers.ts`) counted only events written by
`app` or `cli`, or whose `subject` or `data.ask` is the ask's handle. At the base, the app-role methods that record such an
event answer the ask (`ask.answer`, which counts only with the paired device's signature) or need the OS to confirm you
(`device.pair`, `ask.confirm`, `ask.undo`, `decision.overrule`, `offer.save`), so the only plant that passed that filter
would forge an answer. A write the app can make with neither is `evidence.paste`: the hub stores the image and appends
`evidence.stored`, written by `core`, with no subject, which `writtenByOpen` skipped.

Checked here at the base, not taken on trust: `evidence.paste` is in the role table as app-only
(`packages/hub/src/server.ts`, `ALLOWED`); `paste` and `stored` in `packages/hub/src/core.ts` append `evidence.stored`
through `appendCore`, writer `core`, no subject. A run on this suite's world, through an app-role connection, recorded
`evidence.stored (log_pos 15, written by core)` with no subject and no session.

## What changes

1. **The judge counts every event the record gains** between the last `log_pos` before `deep open` and the record read
   once the card shows and three seconds pass, of any writer and any kind, and names each as
   `<kind> (log_pos <n>, written by <writer>)`. It sets apart only what Pinned 2 states.
2. **The plant is pinned** (Pinned 1).
3. **The world is cut to what AC3 needs**: #83's hub with `deep setup`, one Claude Code stand-in session whose `deep_ask`
   choice stays open, and the real `deep-app` on that home. `../cli.test.ts`'s PASS-claim session serves AC1 and AC7 only.
   Each app launch, the planted one too, waits until the app's tree holds the asking session's row before the open.

Everything else is `../cli.test.ts`'s: `deep open ask/<ULID>`, the ask's address and `question-card` read from the real
window's accessibilityIdentifiers within 30 s, three seconds more, the ask still in `inbox.read`.

## What was read

- Issue #1460 (body and comments), `docs/technical-design.md` (Socket roles and contract versions; deep hub's row;
  "Unknown, not finished"; Dogfooding).
- At the base: `packages/hub/src/server.ts` (the role table, the app and cli hello), `packages/hub/src/core.ts`
  (`paste`, `stored`, `appendCore`, `attention`, `QUIET_MS`, the background jobs, `inbox`), `crates/deep-app/src/hub.rs`
  (the methods the app calls).
- `../README.md`, `../helpers.ts`, `../cli.test.ts` (copied from the earlier blind suite); `../../83/helpers.ts`,
  `../../1459/helpers.ts` (`RealApp`, `settled`), `../../16/helpers.ts` (`cleanup`).
- A scratch run, since deleted, that built this world, launched the plain app and listed what the record gained every
  5 s for 60 s, then ran `deep open` and an app-role `evidence.paste`.

## How to run

With Node 24 first on `PATH`, `npm ci --ignore-scripts; npm run build --workspaces` done once, cargo 1.99.1 on `PATH`
(`$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin`, `$HOME/.cargo/bin`), on macOS in a logged-in, unlocked
session whose test process has Accessibility and Screen Recording (as `../README.md` says):

```sh
caffeinate -di npx vitest run --root tests/acceptance/1460/redraft-ac3 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1460/redraft-ac3/tsconfig.json
```

Builds, temp homes under `/tmp/dh83-*`, and PID-only cleanup are `../helpers.ts`'s and #83's. Vitest writes
`tests/acceptance/1460/redraft-ac3/node_modules/.vite/`; delete it before committing.

### Pinned here: the implementation must provide these

1. **`plant-open-writes-event`**: an empty Cargo feature of `deep-app`, in no shipped build, under which `open` on an ask,
   through the app's hub connection, pastes one small PNG with `evidence.paste`, otherwise right (the card shows, as the
   plain app shows it). Built as `cargo build -p deep-app --bin deep-app --features plant-open-writes-event`.
2. **The judge's rule.** Of what the record gains in the window, two things are set apart and listed in the plain
   test's failure message, never counted:
   - events whose writer is an agent's own connection, `hook` or `mcp` / `mcp:<session>`. Every event's writer comes from
     the connection's credential, and only the app and the CLI hold the control token (design: Socket roles), so
     nothing `deep open` or the app does is written through an agent's hooks or its `deep mcp`;
   - `session.state` and `session.attention`, the hub's reading of an agent session's liveness, which it derives from
     that session's hooks and from time alone (design: "Unknown, not finished": when hooks go quiet a session is unknown;
     at the base, `QUIET_MS`, 30 s after a working session's last hook, and the `states` job each minute). The app and
     the CLI have no method that writes either.

   Everything else counts, `core`'s writes included, so `evidence.stored` counts. The scratch run saw exactly one event
   the window could catch with nobody opening anything: `session.attention (log_pos 14, written by core)`, 30 s after
   the ask's last hook. The rule never names the plant's kind.
3. **The plain test** requires that nothing counts, and that the ask stays in `inbox.read`. A correct `open` that
   answers, arms, confirms or stores anything fails it, naming each event.

## Disputes a redraft may revisit

1. **Liveness kinds set apart by name.** A later hub that writes a session's liveness under another kind would make the
   plain test fail on a correct `open`, naming that kind; the fix is to add it to Pinned 2 with the design line that
   makes it time-derived, never to drop the count.

## Files

- `ac3.test.ts`: the world, the judge and the two tests.
- `tsconfig.json`, `BASE-FAILURE.txt`.
