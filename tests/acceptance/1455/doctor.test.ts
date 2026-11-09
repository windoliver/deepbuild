// AC4: `deep doctor` on a healthy fixture prints no `Fix:` line and one summary line, and `--json` is byte-equal to the
// merge base's. The healthy fixture is #19's world where every item is right (a hub, `deep setup`, signed-in stand-in
// agents with covered versions, one session started); a healthy item is one whose `--json` level is `ok`. The merge
// base's CLI is built from its own tree (helpers.ts, mergeBaseCli) and runs against the same home and hub.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t19 from '../19/doctor/helpers.ts';
import { AC4, cleanup, deepHook, doctorFailures, inconclusive, mergeBase, mergeBaseCli, MINUTES, NODE, type DoctorItem } from './helpers.ts';

const LONG = 30 * MINUTES;
let w: t19.World;
afterAll(async () => { await cleanup(); await t19.cleanup(); }, 60_000);
beforeAll(async () => { await deepHook(); w = await t19.world(); }, LONG);

const doctor = (args: string[], plant?: string) => t19.deep(w.h, ['doctor', ...args], { env: { DEEP_HUB_PLANT: plant } });
const items = async (): Promise<DoctorItem[]> => t19.jsonLines((await doctor(['--json'])).stdout) as DoctorItem[];
const firstDifference = (a: string, b: string): string => {
  const [x, y] = [a.split('\n'), b.split('\n')];
  const at = x.findIndex((line, i) => line !== y[i]);
  const i = at < 0 ? Math.min(x.length, y.length) : at;
  return `line ${i + 1}: ${JSON.stringify(x[i] ?? '(none)')} against ${JSON.stringify(y[i] ?? '(none)')}`;
};

describe('#1455 deep doctor', () => {
  it(`${AC4}: deep doctor on a healthy fixture prints no Fix: line and one summary line`, async () => {
    const listed = await items();
    expect(listed.length, 'deep doctor --json lists no item').toBeGreaterThan(0);
    const human = await doctor([]);
    const notOk = listed.filter((i) => i.level !== 'ok').map((i) => `${i.item} (${i.level}, ${i.code})`);
    expect(doctorFailures(human.stdout, listed), `deep doctor's output (items not ok in this fixture: ${notOk.join(', ') || 'none'}):\n${human.stdout}`).toEqual([]);
  }, LONG);

  it(`${AC4}: --json is byte-equal to the merge base's`, async () => {
    const base = await mergeBaseCli();
    // Two runs of this one program, either side of the merge base's, must agree before its bytes can be laid against
    // them: an item reads the machine (free disk, a free port), which can move between runs. Up to five tries.
    let head = await doctor(['--json']);
    let before = head;
    let again = head;
    for (let tries = 0; tries < 5; tries++) {
      head = await doctor(['--json']);
      before = await t19.run(NODE, [base, 'doctor', '--json'], { env: t19.childEnv(w.h), cwd: w.h.work, timeoutMs: 180_000 });
      again = await doctor(['--json']);
      if (head.stdout === again.stdout) break;
    }
    if (head.stdout !== again.stdout) inconclusive(`AC4: deep doctor --json differs between two runs of this same program, five times running (${firstDifference(head.stdout, again.stdout)}), so byte equality with the merge base can't be judged`);
    expect(before.stdout === head.stdout, `deep doctor --json differs from the merge base ${mergeBase().slice(0, 8)}'s: ${firstDifference(head.stdout, before.stdout)}`).toBe(true);
  }, LONG);

  it(`${AC4}: a planted healthy item that prints a fix fails, naming the item`, async () => {
    const listed = await items();
    expect(doctorFailures((await doctor([])).stdout, listed), 'the clean doctor already fails AC4, so the plant can\'t be told from it').toEqual([]);
    const failures = doctorFailures((await doctor([], 'doctor-healthy-fix')).stdout, listed);
    expect(failures.filter((f) => f.includes('healthy item hub.socket')), `the planted fix under hub.socket wasn't caught naming it: ${JSON.stringify(failures)}`).not.toEqual([]);
  }, LONG);
});
