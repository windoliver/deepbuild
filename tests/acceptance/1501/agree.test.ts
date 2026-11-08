// #1501 AC4: hub up and hub down agree on the floor. For every fail_closed entry the core ships
// (crates/deep-hook/default-rules.json), one representative call (helpers.ts, representatives; AC1's four calls among
// them) is decided twice in the same session on Claude Code 9.9.9: with the hub up, by the hub itself, and then, the
// hub stopped by its PID and nothing at the address, by deep-hook alone, as today. Each must be denied naming that
// entry both times; the test fails naming every entry where they differ. The kill:hub entry's call needs a running
// hub to aim at, so it is checked with the hub up only. Every decision is the real deep-hook's; no call runs.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  UNLISTED, ac1Calls, assertUnlisted, buildDeepHook, cleanup, decision, floorNames, hook, hubDecides, hubDecidesDirect,
  hubKill, isHubKill, namesGuard, representatives, rootOf, shown, startSession, stopHub, who, world, type Ran,
} from './helpers.ts';

beforeAll(buildDeepHook, 900_000);
afterEach(cleanup, 60_000);

describe('AC4 #1501.043ea69b with the hub stopped the same calls are denied as they are today, so hub up and hub down agree on the floor; a test fails naming the entry when they differ', () => {
  it(`AC4 every shipped fail_closed entry denies its call with the hub up (session on Claude Code ${UNLISTED}) and with the hub stopped, naming the entry`, async () => {
    assertUnlisted();
    const w = await world();
    const s = await startSession(w, UNLISTED);
    const reps = representatives(w);
    const floor = floorNames(w.rules).filter((n) => !n.startsWith('t1501-'));
    const failures: string[] = [];
    const missing = floor.filter((n) => !isHubKill(w.rules, n) && !(n in reps));
    for (const n of missing) failures.push(`INCONCLUSIVE: ${n}: this suite has no representative call for the shipped fail_closed entry, so hub up and hub down weren't compared on it`);
    // AC1's four calls are among the representatives, so "the same calls" are compared here too.
    for (const c of ac1Calls(w)) if (!Object.values(reps).some((r) => r.label === c.label)) failures.push(`BLOCKED: AC1's \`${c.label}\` is not among the representatives`);
    const checked = floor.filter((n) => n in reps);

    const up = new Map<string, Ran>();
    for (const n of checked) up.set(n, (await hubDecides(w, s, reps[n]!)).ran);
    const kill = floor.find((n) => isHubKill(w.rules, n));
    const killUp = kill ? await hubDecidesDirect(w, s, hubKill(w)) : undefined;

    // The hub stopped by its PID, the forwarder closed: nothing answers at the address, as with no hub at all.
    await stopHub(w.hub);
    await w.fwd.close();
    // The token file is left from the hub's last launch; the test keeps one there if the hub took it away.
    const token = join(rootOf(w.home), 'control.token');
    if (!existsSync(token)) writeFileSync(token, 'left-from-the-last-launch\n', { mode: 0o600 });

    for (const n of checked) {
      const call = reps[n]!;
      const down = await hook(w.home, s, call.body(s));
      const upRan = up.get(n)!;
      const downOk = decision(down) === 'deny' && namesGuard(down, w.rules, n);
      const upOk = decision(upRan) === 'deny' && namesGuard(upRan, w.rules, n);
      if (!downOk) failures.push(`${n}: with the hub stopped, \`${call.label}\` must be denied naming ${n}, as it is today: ${shown(down)}`);
      else if (!upOk) failures.push(`${n}: hub up and hub down disagree: with the hub stopped \`${call.label}\` is denied naming ${n}; with the hub up, ${who(s)}, ${decision(upRan) === 'deny' ? `the denial doesn't name ${n} with its reason` : 'it is recorded and runs'}: ${shown(upRan)}`);
    }
    if (kill && killUp && !(decision(killUp) === 'deny' && namesGuard(killUp, w.rules, kill))) {
      failures.push(`${kill}: with the hub up, ${who(s)}, \`kill -9 <the hub's PID>\` must be denied naming ${kill}, as deep-hook denies it whenever it answers alone: ${shown(killUp)}`);
    }
    expect(failures, 'hub up and hub down agree on every fail_closed entry').toEqual([]);
  }, 900_000);
});
