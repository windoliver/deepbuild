// AC9: under status.min_distance 0.10, a look whose accent sits 0.095 OKLab from the fail color is refused and
// one at 0.105 is accepted; a planted check that compares against 0.03 accepts the first and fails.
//
// The clean look with `min_distance: 0.1` (the look@1 field the clean look holds at the base) and its accent
// role moved to an 8-bit color 0.095, then 0.105, OKLab from its fail color (found here from the look's own
// status map, every other status color kept at least 0.12 away), judged over fixtures/scene.json with a status
// mark bound to a verdict, a document where status can show. `check` and `raster` take `planted:
// "status_distance_0_03"` (new), the criterion's wrong check, which compares against 0.03. The same criterion
// function runs on both programs: the honest one passes it; the planted one accepts the 0.095 look and fails it.
import { describe, expect, it } from 'vitest';
import {
  RENDER_BIN, batch, clone, colorAtDistance, distanceClash, fixture, hexOf, obj, rasterInput, scratch, shippedLook, shown, statusOf,
  useBinaries, withRoleColor, type JsonObject, type Rgb,
} from './helpers.ts';

useBinaries('deep-canvas-render');
const dir = scratch('distance');
const GATE = 'verdict:01JB4170000000000000000002';
const STATES: JsonObject = { [GATE]: 'fail' };

function statusScene(): JsonObject {
  const doc = fixture('scene.json');
  obj(doc['items'], 'items')['gate'] = { id: 'gate', kind: 'rect@1', layer: 'main', name: 'Status of the release', order: 'a9', params: { box: [16, 40, 96, 24] } };
  doc['status_bindings'] = { 'gate-state': { target: 'items/gate/params/paint/fill', source: GATE } };
  return doc;
}

interface Case { at: number; color: Rgb; look: JsonObject }
let found: { near: Case; far: Case } | null = null;
function cases(): { near: Case; far: Case } {
  if (found) return found;
  const clean = shippedLook('clean');
  const { colors } = statusOf(clean.def, 'clean');
  const fail = colors['fail']!;
  const others = Object.entries(colors).filter(([s]) => s !== 'fail').map(([, c]) => c);
  const make = (target: number, id: string): Case => {
    const c = colorAtDistance(fail, target, others, 0.12);
    const look = withRoleColor(clean.def, 'accent', c.color, id);
    look['min_distance'] = 0.1;
    return { at: c.at, color: c.color, look };
  };
  found = { near: make(0.095, 'clean-accent-0-095'), far: make(0.105, 'clean-accent-0-105') };
  return found;
}

/** The criterion on one program: [] when the 0.095 look is refused naming accent and fail, and the 0.105 look accepted. */
function criterion(planted?: string): { problems: string[]; nearAccepted: boolean } {
  const { near, far } = cases();
  const extra: JsonObject = planted ? { planted } : {};
  const doc = statusScene();
  const checks = batch(RENDER_BIN, ['check'], [near, far].map((c) => ({ doc: clone(doc), look: c.look, states: STATES, ...extra })));
  const rasters = batch(RENDER_BIN, ['raster'], [near, far].map((c) => rasterInput(dir, clone(doc), c.look, { states: STATES, ...extra })));
  const problems: string[] = [];
  const [nc, fc] = checks.map((c, i) => obj(c, `check ${i}`));
  const [nr, fr] = rasters.map((r, i) => obj(r, `raster ${i}`));
  const nearAccepted = nc!['ok'] === true || nr!['ok'] === true;
  for (const [out, how] of [[nc!, 'check'], [nr!, 'raster']] as const) {
    if (out['ok'] !== false) problems.push(`${how} accepts the accent ${hexOf(near.color)} ${near.at.toFixed(4)} from fail`);
    else if (JSON.stringify(distanceClash(out)) !== JSON.stringify({ role: 'accent', state: 'fail' })) problems.push(`${how} refuses the 0.095 look without naming accent and fail: ${shown(out)}`);
  }
  for (const [out, how] of [[fc!, 'check'], [fr!, 'raster']] as const) {
    if (out['ok'] !== true) problems.push(`${how} refuses the accent ${hexOf(far.color)} ${far.at.toFixed(4)} from fail: ${shown(out)}`);
  }
  return { problems, nearAccepted };
}

describe('#417 AC9 under status.min_distance 0.10, an accent 0.095 OKLab from fail is refused and 0.105 accepted; a planted check comparing against 0.03 accepts the first and fails', () => {
  it('AC9 the planted accents sit 0.095 and 0.105 OKLab from the clean look\'s fail color, every other status color at least 0.12 away', () => {
    const { near, far } = cases();
    expect(Math.abs(near.at - 0.095), `${hexOf(near.color)} is ${near.at} from fail`).toBeLessThan(0.0005);
    expect(Math.abs(far.at - 0.105), `${hexOf(far.color)} is ${far.at} from fail`).toBeLessThan(0.0005);
  }, 300_000);

  it('AC9 the 0.095 look is refused by check and raster, naming accent and fail, and the 0.105 look is accepted by both', () => {
    expect(criterion().problems).toEqual([]);
  }, 300_000);

  it('AC9 a planted check that compares against 0.03 (planted status_distance_0_03) accepts the 0.095 look and fails the criterion', () => {
    const { problems, nearAccepted } = criterion('status_distance_0_03');
    expect(nearAccepted, `the planted check accepts the 0.095 look: ${problems.join(' | ')}`).toBe(true);
    expect(problems.some((p) => /accepts the accent/.test(p)), `the criterion fails on the planted check: ${problems.join(' | ')}`).toBe(true);
  }, 300_000);
});
