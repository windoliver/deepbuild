// #1411 AC2: back at normal the pool gives its tokens back, and a flapping level moves it at most once in its hysteresis
// window. The same world and stand-in build as AC1's: at `warn` the pool must first hold tokens back (no more than 4
// out within 15 s), else there is nothing to give back. The level returns to `normal`: all 8 must be out again within
// 70 s (a window of at most 60 s, README, Open points 4). Once all 8 have been out for a second, the level flaps,
// `warn`, `normal`, `warn`, `normal`, `warn`, 700 ms each, then stays `normal`: in the 4 s from the first flap the pool
// may change at most once (a move of the tokens out by 2 or more one way is one change), and all 8 must be out again
// within 70 s after. Its wrong programs: a pool that gives tokens back only once no leased command runs
// (DEEP_HUB_PLANT=restores-only-when-idle), and one that follows each reading at the next tick
// (DEEP_HUB_PLANT=no-hysteresis).
import { describe, expect, it } from 'vitest';
import { mustFail } from '../1016/helpers.ts';
import { AC2, changes, CORES, entriesRepo, fullAtNormal, heldBack, joinedPool, outNow, pressed, readings, RESTORE_MS, sleep, startBuild, TOKENS, timeline, until, World, type Phase, type Reading } from './helpers.ts';

const FLAPS = ['warn', 'normal', 'warn', 'normal', 'warn'] as const;
const FLAP_MS = 700;
/** The flapping's 3.5 s and half a second for the hub's tick: within one hysteresis window, read as at least 5 s. */
const COUNTED_MS = FLAPS.length * FLAP_MS + 500;

interface Seen { w: World; warn: Phase; restored?: number; flapped?: Reading[]; again?: number }

async function restoring(plant?: string, flap = true): Promise<Seen> {
  const w = new World({ cores: CORES, ...(plant ? { plant } : {}) });
  await w.startHub();
  try {
    const repo = entriesRepo(w);
    const t0 = Date.now();
    const { build, full } = await startBuild(w, repo);
    joinedPool(w, build);
    fullAtNormal(w, full);
    const warn = await pressed(w, 'warn', 2000);
    const normalAt = Date.now();
    w.setLevel('normal');
    const back = await until(() => outNow(w) === TOKENS, RESTORE_MS, 50);
    const seen: Seen = { w, warn, ...(back ? { restored: Date.now() - normalAt } : {}) };
    if (back && flap) {
      await sleep(1000);
      const flappedAt = Date.now();
      for (const level of FLAPS) {
        w.setLevel(level);
        await sleep(FLAP_MS);
      }
      w.setLevel('normal');
      const settledAt = Date.now();
      await sleep(Math.max(0, flappedAt + COUNTED_MS - Date.now()));
      seen.flapped = readings(w).filter((r) => r.ms >= flappedAt && r.ms <= flappedAt + COUNTED_MS);
      if (await until(() => outNow(w) === TOKENS, RESTORE_MS, 50)) seen.again = Date.now() - settledAt;
    }
    const goAt = Date.now();
    w.go('build');
    await Promise.race([build.done, sleep(60_000)]);
    // The Proof's reading: the pool driven by the scripted level, its tokens out over time.
    const c = seen.flapped ? changes(seen.flapped) : undefined;
    console.log(`AC2 ${plant ?? 'as built'}: tokens out over time (level in brackets): ${timeline(w, t0, goAt)}. All ${TOKENS} out again ${seen.restored !== undefined ? `${seen.restored} ms` : `not within ${RESTORE_MS} ms`} after normal${c ? `; in the ${COUNTED_MS} ms from the first flap: ${c.path.join(' → ')} (${c.count} change(s)); all ${TOKENS} out ${seen.again !== undefined ? `${seen.again} ms` : `not within ${RESTORE_MS} ms`} after it stayed normal` : ''}`);
    return seen;
  } finally {
    w.setLevel('normal');
    await w.stopHub();
  }
}

/** Held back at warn first, then all 8 out again within 70 s of normal. */
function backAtNormal(s: Seen): void {
  heldBack(s.w, s.warn, 'all 8 "available again" at normal needs tokens held back first: ');
  expect(s.restored, `back at \`normal\`, all ${TOKENS} tokens must be out again within ${RESTORE_MS / 1000} s (a hysteresis window of at most 60 s and the hub's ticks): ${outNow(s.w)} were out`).toBeDefined();
}
/** At most one change of the pool while the level flaps, and all 8 out again once it stays normal. */
function flapsOnce(s: Seen): void {
  expect(s.flapped, 'the level must have flapped: all 8 tokens were never out again after warn').toBeDefined();
  const c = changes(s.flapped!);
  expect(c.count <= 1, `a level flapping ${FLAPS.join(', ')} (${FLAP_MS} ms each) changed the pool ${c.count} times in the ${COUNTED_MS / 1000} s from its first flap, within one hysteresis window: tokens out ${c.path.join(' → ')}`).toBe(true);
  expect(s.again, `once the level stays \`normal\` after flapping, all ${TOKENS} tokens must be out again within ${RESTORE_MS / 1000} s: ${outNow(s.w)} were out`).toBeDefined();
}

describe(`${AC2} back at normal the pool gives its tokens back, and a flapping level changes it at most once in its hysteresis window`, () => {
  it(`${AC2} back at \`normal\`, all 8 are available again, and a flapping level doesn't change the pool more than once in its hysteresis window`, async () => {
    const s = await restoring();
    backAtNormal(s);
    flapsOnce(s);
  }, 600_000);

  it(`${AC2} (wrong program) a pool that gives its tokens back only once no leased command runs (DEEP_HUB_PLANT=restores-only-when-idle) keeps them from a running build at normal and fails`, async () => {
    const s = await restoring('restores-only-when-idle', false);
    await mustFail('restores-only-when-idle', () => backAtNormal(s), ['must be out again']);
  }, 600_000);

  it(`${AC2} (wrong program) a pool that follows each reading at the next tick (DEEP_HUB_PLANT=no-hysteresis) changes with every flap and fails`, async () => {
    const s = await restoring('no-hysteresis');
    backAtNormal(s);
    await mustFail('no-hysteresis', () => flapsOnce(s), ['changed the pool']);
  }, 600_000);
});
