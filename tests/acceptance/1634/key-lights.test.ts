// AC6 #1634.41f7525a: Key lights keep today's rules: with 40 key lights the policy still shades 32 and raises
// `lights_over_budget`, and 1,024 fill lamps beside them change neither count. A document past its class's
// `fill_shaded` is refused at check, naming the count and the class.
//
// 1. The room (helpers: `roomDoc`): #485's room and its 40 key point lights, 32 at 800 lm and 8 at 2 lm, far below the
//    cut. Drawn alone and with 1,024 fill lamps beside them, on the noop lane (the policy is the CPU's), with
//    `light_cut: true`. Alone: `shaded` holds the CPU reference's 32 (reference.ts: `ordered`, `cutAt` at 32), each at
//    weight 1, `left_out` its 8, and frame 0 carries one `lights_over_budget` notice whose `lights` are those 8. With
//    the fill lamps: the same 32 in the same order at the same weights, the same 8 left out, the same one notice with
//    the same 8, none of the 1,024 in `shaded`, `left_out` or the notice; and `light_cut.fill` (README: Assumed
//    surfaces 4) holds all 1,024, so the lamps are shaded and not dropped.
// 2. The check, on the noop lane through `live` (#379), which admits a document as its writer sends it: `capDoc`'s fill
//    lamps over a ground slab, one more than each class's `fill_shaded` (33 in figure, 513 in work_product, 2,049 in
//    showpiece and in export). Each session is refused with an issue `over_budget` whose `actual` names the count
//    (`fill_lights`) and the class (`class`). A figure holding exactly 32 is admitted (`state: live`).
// Wrong programs: the base (it reads no `fill` in `view3d`, so the 1,024 join the key lights and 1,032 are left out;
// its check refuses `fill` as an unknown field); fill lamps counted in `shaded`; a cap that drops lights past
// `fill_shaded` in place of refusing the document; a refusal that names neither the count nor the class.
import { describe, expect, it } from 'vitest';
import {
  AC, FILL_SHADED, KEYS, PLAIN_LOOK, ROOM, SWITCH, TIMEOUT, WRITER, answered, arr, capDoc, fillOf, frameAt, framesOf, isObject, none, noticesOf, obj, objs, payload,
  roomDoc, roomFill, runGpu, shown, str, useDir, useGpu, view3dCall, writeJson, type BudgetClass, type Frame, type JsonObject,
} from './helpers.ts';
import { SHADED, cutAt, ordered } from './reference.ts';

const ID = AC[6];
const bin = useGpu();
const dir = useDir();

interface Counts { shaded: string; leftOut: string[]; noticed: string[][] }
/** The key policy's counts in a frame: who is shaded at what weight, who is left out, and what each notice lists. */
function countsOf(f: Frame, what: string): Counts {
  expect(f.lightCut, `${what}: the frame reports its light_cut`).not.toBeNull();
  const shaded = objs(f.lightCut!['shaded'], `${what}: light_cut.shaded`).map((s) => `${str(s['light'], 'shaded[].light')}:${String(s['weight'])}`).join(' ');
  const leftOut = arr(f.lightCut!['left_out'], `${what}: light_cut.left_out`).map((v) => str(v, 'left_out[]')).sort();
  const noticed = noticesOf(f, 'lights_over_budget').map((n) => arr(n['lights'], 'lights_over_budget.lights').map((v) => str(v, 'lights_over_budget.lights[]')).sort());
  return { shaded, leftOut, noticed };
}

describe(`${ID} key lights keep today's rules beside fill lamps, and a class's fill_shaded is a refusal`, () => {
  it(`${ID} with 40 key lights the policy shades 32 and raises lights_over_budget for the other 8, and 1,024 fill lamps beside them change neither count`, () => {
    const out = dir();
    const call = (name: string, withFill: boolean): JsonObject => view3dCall({ doc: writeJson(out, name, roomDoc(withFill)), look: PLAIN_LOOK, size: ROOM.size, targets: [], light_cut: true });
    const replies = runGpu(bin(), out, [call('room-keys', false), call('room-with-fill', true)], { lane: 'noop' });
    const [alone, beside] = replies.map((r, i) => frameAt(framesOf(out, r, ROOM.size, i === 0 ? 'the 40 key lights' : 'the 40 key lights and 1,024 fill lamps'), 0, 'the room'));
    const want = cutAt(ordered(ROOM.cam, KEYS), SHADED);
    const failures: string[] = [];
    const a = countsOf(alone!, 'the 40 key lights');
    const wantShaded = want.kept.map((k) => `${k.id}:${k.weight}`).join(' ');
    const wantOut = [...want.dropped].sort();
    expect(want.kept.length, 'the fixture: the reference shades 32').toBe(32);
    expect(wantOut.length, 'the fixture: the reference leaves 8 out').toBe(8);
    if (a.shaded !== wantShaded) failures.push(`with 40 key lights the policy shades [${a.shaded}], where today's rule shades [${wantShaded}]`);
    if (a.leftOut.join(' ') !== wantOut.join(' ')) failures.push(`with 40 key lights the policy leaves out [${a.leftOut.join(', ')}], where today's rule leaves out [${wantOut.join(', ')}]`);
    if (a.noticed.length !== 1 || a.noticed[0]!.join(' ') !== wantOut.join(' ')) failures.push(`with 40 key lights frame 0 carries ${a.noticed.length} lights_over_budget notices listing ${shown(a.noticed)}, not one listing the 8 left out`);
    const b = countsOf(beside!, 'the 40 key lights and 1,024 fill lamps');
    if (b.shaded !== a.shaded) failures.push(`1,024 fill lamps change the shaded key lights: ${b.shaded.split(' ').length} shaded, [${b.shaded.slice(0, 300)}], where 32 were, [${a.shaded.slice(0, 300)}]`);
    if (b.leftOut.join(' ') !== a.leftOut.join(' ')) failures.push(`1,024 fill lamps change the lights left out: ${b.leftOut.length}, [${b.leftOut.slice(0, 12).join(', ')}…], where 8 were`);
    if (JSON.stringify(b.noticed) !== JSON.stringify(a.noticed)) failures.push(`1,024 fill lamps change lights_over_budget: ${b.noticed.length} notices listing ${b.noticed.map((n) => n.length).join(', ')} lights, where one listed 8`);
    if (beside!.lightCut!['fill'] === undefined) failures.push('light_cut reports no fill lights (light_cut.fill), so nothing says the 1,024 are shaded');
    else {
      const fill = fillOf(beside!, 'the 40 key lights and 1,024 fill lamps').map((l) => l.light).sort();
      if (fill.join(' ') !== roomFill().map((l) => l.id).sort().join(' ')) failures.push(`light_cut.fill holds ${fill.length} lights, not the 1,024 fill lamps`);
    }
    none(failures, 'the key policy beside fill lamps');
  }, TIMEOUT);

  it(`${ID} a document one fill lamp past its class's fill_shaded (32 in figure, 512 in work_product, 2,048 in showpiece and export) is refused at check, naming the count and the class; a figure at 32 is admitted`, () => {
    const out = dir();
    const classes = Object.keys(FILL_SHADED) as BudgetClass[];
    const cases: { session: string; cls: BudgetClass; n: number; refused: boolean }[] = [
      ...classes.map((cls) => ({ session: `past_${cls}`, cls, n: FILL_SHADED[cls] + 1, refused: true })),
      { session: 'at_figure', cls: 'figure', n: FILL_SHADED.figure, refused: false },
    ];
    const sessions = cases.map((c) => ({ session: c.session, doc: writeJson(out, c.session, payload(capDoc(c.cls, c.n))), size: SWITCH.size, writer: WRITER }));
    const [reply] = runGpu(bin(), out, [{ call: 'live', look: PLAIN_LOOK, fps: 30, frames: 1, sessions, events: [] }], { lane: 'noop' });
    const rows = objs(answered(reply!, 'the documents at and past fill_shaded')['sessions'], 'live: sessions');
    const failures: string[] = [];
    for (const c of cases) {
      const what = `${c.n} fill lamps in a ${c.cls} document`;
      const row = rows.find((r) => r['session'] === c.session);
      if (!row) { failures.push(`${what}: the reply has no row for its session`); continue; }
      const issues = Array.isArray(row['issues']) ? row['issues'].filter(isObject) : [];
      if (!c.refused) {
        if (row['state'] !== 'live') failures.push(`${what}, the class's fill_shaded, isn't admitted: ${shown({ state: row['state'] ?? null, issues: issues.slice(0, 2) })}`);
        continue;
      }
      if (row['state'] !== 'refused') { failures.push(`${what}, one past its fill_shaded of ${FILL_SHADED[c.cls]}, is admitted (state ${String(row['state'])})`); continue; }
      const named = issues.some((i) => i['code'] === 'over_budget' && isObject(i['actual']) && obj(i['actual'], 'actual')['fill_lights'] === c.n && obj(i['actual'], 'actual')['class'] === c.cls);
      if (!named) failures.push(`${what} is refused, but by no over_budget issue whose actual names fill_lights ${c.n} and class ${c.cls}: ${shown(issues.slice(0, 2))}`);
    }
    none(failures, 'the check at each class\'s fill_shaded');
  }, TIMEOUT);
});
