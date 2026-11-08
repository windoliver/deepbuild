// #1501 AC2: in a session whose transcript names 9.9.9, with the hub up, everything but the floor stays watch-only:
// a call matching this suite's watch entry is recorded (its tool.before names the entry) and runs, a call matching
// its warn entry runs with nothing added, a call matching its own block entry (not fail_closed) runs and is
// recorded, and the Stop of a turn that did work isn't held (the hub acknowledges it with hold_until_ms null). The
// wrong program the criterion names, a hub that ends watch-only altogether, is built as data: the same hub given
// facts that list 9.9.9 (DEEP_HUB_TEST_FACTS), which gates the session as any listed one; it holds the stop and fails.
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  UNLISTED, assertUnlisted, bash, beforeOf, brief, buildDeepHook, cleanup, decision, events, eventsUntil, hubDecides,
  matchedIn, parseObject, shown, startSession, stopAfterWork, who, widenedFacts, world, type Session, type World,
} from './helpers.ts';

beforeAll(buildDeepHook, 900_000);
afterEach(cleanup, 60_000);

/** Throws at the first thing that isn't watch-only, naming it. The stop comes second, so a hub that gates the session fails there. */
async function watchOnly(w: World, s: Session): Promise<void> {
  const watch = await hubDecides(w, s, bash(`echo ${w.own.word}-watch`));
  if (decision(watch.ran) !== 'allow') throw Error(`the watch entry's call \`echo ${w.own.word}-watch\` (${who(s)}) must run: ${shown(watch.ran)}`);
  const id = String(watch.body.tool_use_id);
  const all = await eventsUntil(w.home, (a) => matchedIn(beforeOf(a, s, id), w.own.watch));
  if (!matchedIn(beforeOf(all, s, id), w.own.watch)) throw Error(`the watch entry's call (${who(s)}) must be recorded, its tool.before naming ${w.own.watch} in matched: ${all.filter((e) => e.session === s.id).map(brief).join('; ')}`);

  const stop = await stopAfterWork(w, s);
  if (stop.ack.hold_until_ms !== null) throw Error(`the Stop of ${who(s)} after a turn that did work must not be held, yet it is held: the hub acknowledged it with hold_until_ms ${JSON.stringify(stop.ack.hold_until_ms)}`);
  const stopped = await stop.done;
  const out = parseObject(stopped.stdout.trim());
  if (stopped.code !== 0 || out?.decision !== undefined || out?.continue === false) throw Error(`the Stop of ${who(s)} must be let through, never held or blocked: ${shown(stopped)}`);

  const warn = await hubDecides(w, s, bash(`echo ${w.own.word}-warn`));
  const warnReason = w.rules.entries[w.own.warn]!.reason;
  if (decision(warn.ran) !== 'allow') throw Error(`the warn entry's call (${who(s)}) must run: ${shown(warn.ran)}`);
  const context = parseObject(warn.ran.stdout.trim())?.hookSpecificOutput?.additionalContext;
  if (context !== undefined || `${warn.ran.stdout}${warn.ran.stderr}`.includes(warnReason)) throw Error(`the warn entry adds nothing in ${who(s)}: no additionalContext, no reason: ${shown(warn.ran)}`);

  const block = await hubDecides(w, s, bash(`echo ${w.own.word}-block`));
  if (decision(block.ran) !== 'allow') throw Error(`a block entry that isn't fail_closed stays watch-only in ${who(s)}: \`echo ${w.own.word}-block\` must run: ${shown(block.ran)}`);
  const bid = String(block.body.tool_use_id);
  const after = await eventsUntil(w.home, (a) => matchedIn(beforeOf(a, s, bid), w.own.block));
  if (!matchedIn(beforeOf(after, s, bid), w.own.block)) throw Error(`the block entry's call (${who(s)}) must be recorded, its tool.before naming ${w.own.block}: ${(await events(w.home)).filter((e) => e.session === s.id).map(brief).join('; ')}`);
}

describe('AC2 #1501.e184c432 in that session a matched watch entry is recorded and runs, a warn entry adds nothing, and a Stop isn\'t held; a hub that ends watch-only altogether holds the stop and fails', () => {
  it(`AC2 a session on Claude Code ${UNLISTED}, hub up: watch recorded and run, warn adds nothing, a non-floor block runs, the stop isn't held`, async () => {
    assertUnlisted();
    const w = await world();
    const s = await startSession(w, UNLISTED);
    await watchOnly(w, s);
  }, 600_000);

  it(`AC2 (wrong program) a hub that ends watch-only altogether (facts widened to list ${UNLISTED}) holds the stop and fails`, async () => {
    assertUnlisted();
    const w = await world({ facts: (tmp) => widenedFacts(join(tmp, 'facts'), UNLISTED) });
    const s = await startSession(w, UNLISTED);
    await expect(watchOnly(w, s)).rejects.toThrow(/the Stop of .* is held/);
  }, 600_000);
});
