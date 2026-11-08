// #1501 AC3: a session on a version the facts list (their newest) behaves as on the base, with the hub up: the
// floor's calls are denied naming their guard; this suite's own block entry (not fail_closed) is denied; its warn
// entry's call runs with the reason added; its watch entry's call runs and is recorded; the Stop of a turn that did
// work is held (a number in hold_until_ms); and `rm -rf "$X"/*`, a delete of unknown reach, is held for the gate to
// stage or ask (#347), not denied outright. A fix that let the watch-only floor leak into gated sessions, denying the
// staged delete or dropping the stop hold, fails here.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ac1Calls, bash, beforeOf, buildDeepHook, cleanup, decision, eventsUntil, floorNamed, hubDecides, listed, matchedIn,
  namesGuard, parseObject, shown, startSession, stopAfterWork, ackOf, who, world,
} from './helpers.ts';

beforeAll(buildDeepHook, 900_000);
afterEach(cleanup, 60_000);

describe('AC3 #1501.37078b1d a session on a listed version behaves as it does on the merge base', () => {
  it('AC3 a session on the newest listed Claude Code version, hub up: the floor denies, a block denies, a warn warns, a watch records, the stop is held, the staged delete is held for the gate', async () => {
    const w = await world();
    const s = await startSession(w, listed());
    const failures: string[] = [];
    const [spec, settings, off, rm] = ac1Calls(w);

    for (const call of [spec!, settings!, off!]) {
      const { ran } = await hubDecides(w, s, call);
      if (decision(ran) !== 'deny' || !floorNamed(ran, w.rules).length) failures.push(`\`${call.label}\` (${who(s)}) is denied by the floor, naming its guard, as on the base: ${shown(ran)}`);
    }

    const block = await hubDecides(w, s, bash(`echo ${w.own.word}-block`));
    if (decision(block.ran) !== 'deny' || !namesGuard(block.ran, w.rules, w.own.block)) failures.push(`this suite's block entry denies its call in ${who(s)}, naming ${w.own.block}, as on the base: ${shown(block.ran)}`);

    const warn = await hubDecides(w, s, bash(`echo ${w.own.word}-warn`));
    const context = String(parseObject(warn.ran.stdout.trim())?.hookSpecificOutput?.additionalContext ?? '');
    if (decision(warn.ran) !== 'allow' || !context.includes(w.rules.entries[w.own.warn]!.reason)) failures.push(`this suite's warn entry lets its call run in ${who(s)} with its reason added, as on the base: ${shown(warn.ran)}`);

    const watch = await hubDecides(w, s, bash(`echo ${w.own.word}-watch`));
    const id = String(watch.body.tool_use_id);
    const all = await eventsUntil(w.home, (a) => matchedIn(beforeOf(a, s, id), w.own.watch));
    if (decision(watch.ran) !== 'allow' || !matchedIn(beforeOf(all, s, id), w.own.watch)) failures.push(`this suite's watch entry's call runs in ${who(s)} and is recorded naming ${w.own.watch}, as on the base: ${shown(watch.ran)}`);

    const stop = await stopAfterWork(w, s);
    if (typeof stop.ack.hold_until_ms !== 'number') failures.push(`the Stop of ${who(s)} after a turn that did work is held, as on the base: the hub acknowledged it with ${JSON.stringify(stop.ack)}`);

    // The staged delete: its hold is read off the acknowledgement; the test doesn't wait for the gate's end.
    const body = rm!.body(s);
    const got = await ackOf(w, s, body, (l) => l.payload?.tool_use_id === body.tool_use_id);
    if (!got) throw Error(`INCONCLUSIVE: the hub never acknowledged \`${rm!.label}\` (${who(s)})`);
    if (typeof got.ack.hold_until_ms !== 'number') failures.push(`\`${rm!.label}\` (${who(s)}) is held for the gate to stage or ask, as on the base, not answered at once: the hub acknowledged it with ${JSON.stringify(got.ack)}`);

    expect(failures, `a session on listed version ${s.version} behaves as on the base`).toEqual([]);
  }, 600_000);
});
