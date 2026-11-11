// #1921.bcd2acd3: Budget, on the reference Mac in the local preflight against the merge base: the 800-body world steps
// within the world's default `step_p95` of 2 ms at 120 Hz, and each frame uploads only the elements whose pose changed;
// sleeping bodies upload nothing.
//
// The 800-body world is the drop's (helpers.ts: dropScene): 400 boxes and 400 balls, one body per element through
// `each:`, dropped from 1 m to 19.70 m onto a plane at 120 Hz, landing and falling asleep one after another; its
// `budget` is left out, so its step_p95 is the design's default, 2 ms.
//
// Uploads, on any Mac (they don't depend on load): `deep-gpu run`'s `view3d` draws frames 0 … 300 (t = f ÷ 60 s, step
// 2f, all of the 5 s) with #484's counters, each frame reporting per instancer the element IDs whose rows it wrote to the
// GPU (`element_uploads`, README: The surface under test). `deep-physics`'s bake of the same scene, every 2 steps, gives
// each element body's pose at each frame and its `rest` and `wake` rows. From frame 1 on, each frame uploads exactly the
// elements whose position or rotation bits differ from the frame before (an element missing would draw a stale pose),
// and no element whose body has slept since before the frame's first step; and the run holds frames with sleeping and
// moving bodies together, then, once all 800 sleep, frames that upload nothing. Off macOS this is INCONCLUSIVE.
//
// The step budget: #2011's check, `node scripts/physics-budget.mjs`, asked for the scene's world (README: The budget
// check) on the app host (this Mac's release build), five timed runs of the 600 steps judged by the reference-Mac rule
// (scripts/benchmark.mjs judgeLimit). Off the reference Mac, or under load, the rule reads INCONCLUSIVE and the test fails
// with `INCONCLUSIVE:` and the check's reasons, never passing, after everything the check reports apart from the verdict
// is judged. The web host isn't this criterion's; it is asked with no reference Mac, so it reads BLOCKED and isn't judged.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, DROP_FRAMES, DROP_STEPS, DROP_WORLD, INSTANCERS, TIMEOUT, BUDGET_TIMEOUT, address, budget, dropBake, dropDoc, dropScene,
  drawnOf, elementIds, gpu, hostTriple, inconclusive, isObject, none, prebuild, prebuildGpu, requireGpu, show, useDirs, view3d,
  type Instancer, type Pose,
} from './helpers.ts';
import { LIMIT_MS, hostOf, reportFailures, timedFailures } from '../2011/helpers.ts';

prebuild();
prebuildGpu();

const ID = CRITERIA[6];
const dirs = useDirs();

const bitsOf = (p: Pose): string => {
  const f = new Float32Array([...p.pos, ...p.rot]);
  return Array.from(new Uint32Array(f.buffer)).join(',');
};

describe(`${ID} the 800-body world's step budget on the reference Mac, and its uploads`, () => {
  it(`${ID} (uploads) each frame uploads only the elements whose pose changed; sleeping bodies upload nothing`, () => {
    requireGpu();
    const { reply, poses } = dropBake(DROP_STEPS, 2);
    // Each element body's sleeps, from the bake's rest and wake rows: [rest step, wake step or Infinity].
    const sleeps = new Map<string, [number, number][]>();
    const rows = Array.isArray(reply['occurrences']) ? reply['occurrences'] : [];
    for (const r of rows) {
      if (!isObject(r) || typeof r['a'] !== 'string' || typeof r['step'] !== 'number') continue;
      const list = sleeps.get(r['a']) ?? [];
      if (r['kind'] === 'rest') list.push([r['step'], Infinity]);
      if (r['kind'] === 'wake' && list.length) list[list.length - 1]![1] = r['step'];
      sleeps.set(r['a'], list);
    }
    const asleepThrough = (id: string, from: number, to: number): boolean => (sleeps.get(id) ?? []).some(([r, w]) => r <= from && w > to);
    const slept = INSTANCERS.flatMap((inst) => elementIds.map((e) => address(inst, e))).filter((id) => sleeps.has(id));
    expect(slept.length, 'every one of the 800 element bodies writes a rest row within the 5 s, under its address').toBe(800);

    const out = dirs();
    const [drawn] = gpu(out, [view3d(dropDoc(out), DROP_FRAMES + 1)]);
    const frames = drawnOf(drawn!, 'the drop, frames 0 to 300');
    expect(frames.map((f) => f.frame), 'the run draws frames 0 to 300').toEqual(Array.from({ length: DROP_FRAMES + 1 }, (_, f) => f));

    const fails: string[] = [];
    let mixed = 0;
    let quiet = 0;
    for (const f of frames.slice(1)) {
      if (f.uploads === null) { fails.push(`frame ${f.frame} reports no element_uploads`); continue; }
      let moving = 0;
      let sleeping = 0;
      for (const inst of INSTANCERS as readonly Instancer[]) {
        const got = new Set(f.uploads[inst] ?? []);
        const changed = elementIds.filter((_, j) => bitsOf(poses[inst][j]![f.frame]!) !== bitsOf(poses[inst][j]![f.frame - 1]!));
        const asleep = elementIds.filter((e) => asleepThrough(address(inst, e), 2 * f.frame - 2, 2 * f.frame));
        moving += changed.length;
        sleeping += asleep.length;
        const changedSet = new Set(changed);
        const missing = changed.filter((e) => !got.has(e));
        const extra = [...got].filter((e) => !changedSet.has(e));
        if (missing.length || extra.length) {
          fails.push(`frame ${f.frame}: ${inst} uploads ${got.size} elements, ${changed.length} changed pose since frame ${f.frame - 1}${missing.length ? `; not uploaded though changed: ${missing.slice(0, 3).map((e) => address(inst, e)).join(', ')}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}` : ''}${extra.length ? `; uploaded though unchanged: ${extra.slice(0, 3).map((e) => address(inst, e)).join(', ')}${extra.length > 3 ? ` and ${extra.length - 3} more` : ''}` : ''}`);
        }
        const woke = asleep.filter((e) => got.has(e));
        if (woke.length) fails.push(`frame ${f.frame}: ${inst} uploads sleeping bodies: ${woke.slice(0, 3).map((e) => address(inst, e)).join(', ')}${woke.length > 3 ? ` and ${woke.length - 3} more` : ''}`);
      }
      if (moving > 0 && sleeping > 0) mixed++;
      if (moving === 0 && Object.values(f.uploads).every((l) => l.length === 0)) quiet++;
    }
    none(fails.slice(0, 40), `each frame's uploads (${fails.length} frames and instancers wrong)`);
    expect(mixed, 'frames where some bodies sleep while others move').toBeGreaterThan(0);
    expect(quiet, 'frames, once all 800 sleep, that upload nothing').toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${ID} (budget) on the reference Mac the 800-body world steps within the world's default step_p95 of 2 ms at 120 Hz`, () => {
    const triple = hostTriple();
    const report = budget({ scene: dropScene(), world: DROP_WORLD, steps: DROP_STEPS, reference_mac: { app: true, web: false } });
    expect(report['limit_ms'], `the limit is the world's default step_p95, ${LIMIT_MS} ms`).toBe(LIMIT_MS);
    none([...reportFailures(report), ...timedFailures(report, 'app', DROP_STEPS, triple)], 'the app host is timed on this Mac, its release build natively, five runs of the 600 steps');
    const app = hostOf(report, 'app');
    const runs = `runs ${show(app['runs'])} ms; ${String(app['reason'] ?? '')}`;
    if (app['verdict'] === 'INCONCLUSIVE') inconclusive(`the app host's step_p95 read INCONCLUSIVE, a reading, not a budget result: ${runs}`);
    expect(app['verdict'], `the 800-body world steps within ${LIMIT_MS} ms at the 95th percentile in every run: ${runs}`).toBe('PASS');
  }, BUDGET_TIMEOUT);
});
