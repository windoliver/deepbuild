// Criterion 2 (README: Criteria to tests), its headless half: "Under reduced motion every operator holds its still
// pose, with 0 frames after the first. A planted operator with no still pose is refused at pack check."
// The grid (all 24 operators at once) drawn by the replica under reduced motion at four times of the effect clock is
// the same picture at every one; without reduced motion the same four times aren't, so the comparison can see motion.
// The planted operator is input: a copy of the shipped pack whose `halo.soft` has its `still` taken out of pack.json.
// The frames the live window presents after its first are counted in `ac2-still.live.test.ts`.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, PACK, grid, packCheck, replica, useBuild, type Obj } from './helpers.ts';

const bin = useBuild('replica');
const TIMES = [0, 1.3, 2.9, 4.7];

describe(`#1436 AC2 ${AC[2]} under reduced motion every operator holds its still pose`, () => {
  it('AC2 under reduced motion the grid of all 24 operators is byte-equal at 0, 1.3, 2.9 and 4.7 s; without it, it is not', () => {
    const held = replica(bin(), grid(), { reduceMotion: true, at: TIMES });
    held.pngs.slice(1).forEach((png, i) => {
      expect(Buffer.from(png.rgba).equals(Buffer.from(held.pngs[0]!.rgba)), `under reduced motion, the frame at ${TIMES[i + 1]} s against the one at 0 s`).toBe(true);
    });
    expect(held.refusals, 'nothing is refused').toEqual([]);
    const moving = replica(bin(), grid(), { at: TIMES });
    const still = moving.pngs.slice(1).every((png) => Buffer.from(png.rgba).equals(Buffer.from(moving.pngs[0]!.rgba)));
    expect(still, 'without reduced motion the operators move between those times').toBe(false);
  }, 3_600_000);

  it('AC2 a planted operator with no still pose (halo.soft without `still` in a copy of the pack) is refused at pack check, naming it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deep-1436-pack-'));
    try {
      const pack = join(dir, 'chrome-fx-1.0.0');
      cpSync(PACK, pack, { recursive: true });
      const manifest = JSON.parse(readFileSync(join(pack, 'pack.json'), 'utf8')) as { operators: Record<string, Obj> };
      const planted = manifest.operators['halo.soft'];
      expect(planted && 'still' in planted, 'pack.json gives halo.soft its still pose (README: The pack)').toBe(true);
      delete planted!['still'];
      writeFileSync(join(pack, 'pack.json'), JSON.stringify(manifest, null, 2));
      const check = packCheck(bin(), pack);
      expect(check.status, `the pack with a stillless operator fails its check: ${JSON.stringify(check.refusals)}`).toBe(1);
      const named = check.refusals.filter((r) => r['operator'] === 'halo.soft' && r['code'] === 'chrome_fx_no_still');
      expect(named.length, `a refusal names halo.soft and its missing still pose: ${JSON.stringify(check.refusals)}`).toBeGreaterThan(0);
      expect(check.refusals.filter((r) => r['operator'] !== 'halo.soft'), 'no other operator is refused').toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 3_600_000);
});
