// #251.0d1641fc: "Contacts: set down from 1 m above where its rays first reach the floor, each wheel writes its first
// contact_begin naming the body and the wheel at √(2 × 1 ÷ 9.81) = 0.4515 s within one step, in the bake's sorted
// order; driving off the end of a raised floor writes contact_end for both front wheels before either rear one; and a
// planted controller that names only the body fails, naming the occurrence"
//
// The drop: the car (README: The car) held level at rest with each wheel's ray, rest + radius long, ending 1 m above
// level ground, sleep off, baked 1 s. A row names the wheel by a `wheel` field beside the body or by an ID `kart#<wheel>`
// as `a` or `b` (README: Rows this suite reads). Each wheel's first contact_begin is at its row's step ÷ 120 s, within
// one step (1/120 s) of 0.4515 s; the list is in #1918's sorted order, and rows of one step, kind and pair are in the
// order of their wheels' names. The edge: the car settled on a floor 3 m above the ground whose end is 2 m ahead of
// its centre, rolling at 4 m/s along its heading, sleep off, baked 2.5 s: each wheel's first contact_end; both front
// wheels' come on earlier steps than either rear wheel's. `contact_names_body_only` writes the rows naming the body alone.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, DT, FRONT, REAR, REST_Y, SETTLED_Y, TIMEOUT, WHEEL_NAMES, ask, bakeRun, box, carWorld, caught, kart, naming, namesBody, none,
  orderFailures, prebuild, rowText, rowsOf, stepAt, wheelNamed, type JsonObject, type Planted, type Row,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[4];
const DROP = 1;
const FIRST = Math.sqrt((2 * DROP) / 9.81);
const DROP_RUN = stepAt(1);
const EDGE_RUN = stepAt(2.5);

function dropRows(planted?: Planted): Row[] {
  const w = carWorld(kart([0, REST_Y + DROP, 0], { sleep: false }));
  const [r] = ask([bakeRun(w, DROP_RUN)], planted, 'the car dropped 1 m');
  return rowsOf(r!, 'the car dropped 1 m');
}

/** Each wheel's first contact_begin names the body and the wheel, at 0.4515 s within one step; the list sorted. */
function dropFailures(rows: Row[]): string[] {
  const f: string[] = [];
  const begins = rows.filter((r) => r.kind === 'contact_begin' && namesBody(r, 'kart'));
  for (const n of WHEEL_NAMES) {
    const first = begins.find((r) => wheelNamed(r, 'kart') === n);
    if (!first) { f.push(`contact_begin: no row names the body kart and the wheel ${n} (kart's contact_begin rows: ${begins.map(rowText).join('; ') || 'none'})`); continue; }
    const t = first.step * DT;
    if (Math.abs(t - FIRST) > DT) f.push(`contact_begin: wheel ${n}'s first, ${rowText(first)}, is at ${t.toFixed(4)} s, not 0.4515 s within one step`);
  }
  f.push(...orderFailures(rows, 'the bake\'s occurrence list'));
  rows.forEach((r, i) => {
    const p = rows[i - 1];
    if (!p || p.step !== r.step || p.kind !== r.kind || p.a !== r.a || p.b !== r.b) return;
    const [x, y] = [wheelNamed(p, 'kart'), wheelNamed(r, 'kart')];
    if (x !== null && y !== null && x > y) f.push(`the bake's occurrence list: ${r.kind} for wheel ${x} comes before wheel ${y} on step ${r.step}`);
  });
  return f;
}

describe(`${ID} each wheel writes contact_begin and contact_end naming the body and the wheel, sorted with the rest`, () => {
  it(`${ID} set down from 1 m above where its rays first reach the floor, each wheel writes its first contact_begin naming the body and the wheel at 0.4515 s within one step, in the bake's sorted order`, () => {
    none(dropFailures(dropRows()), 'each wheel\'s first contact_begin');
  }, TIMEOUT);

  it(`${ID} driving off the end of a raised floor writes contact_end for both front wheels before either rear one`, () => {
    const raised = { kind: 'static', shapes: [{ shape: 'deck', contact_material: 'ground' }], pose: { pos: [0, 2.5, -8] } } as JsonObject;
    const w = carWorld(kart([0, 3 + SETTLED_Y, 0], { sleep: false, velocity: { linear: [0, 0, 4] } }), {}, { shapes: { deck: box([10, 0.5, 10]) }, bodies: { deck: raised } });
    const [r] = ask([bakeRun(w, EDGE_RUN)], undefined, 'the car rolling off the raised floor');
    const ends = rowsOf(r!, 'the car rolling off the raised floor').filter((x) => x.kind === 'contact_end' && namesBody(x, 'kart'));
    const firstEnd = (n: string): number | undefined => ends.find((x) => wheelNamed(x, 'kart') === n)?.step;
    const steps = Object.fromEntries(WHEEL_NAMES.map((n) => [n, firstEnd(n)]));
    expect(WHEEL_NAMES.filter((n) => steps[n] === undefined), `each wheel writes a contact_end naming kart and it, rolling off the edge (rows: ${ends.map(rowText).join('; ') || 'none'})`).toEqual([]);
    const late = FRONT.flatMap((f) => REAR.filter((b) => !(steps[f]! < steps[b]!)).map((b) => `front wheel ${f}'s contact_end at step ${steps[f]} isn't before rear wheel ${b}'s at step ${steps[b]}`));
    none(late, 'both front wheels leave the raised floor before either rear one');
  }, TIMEOUT);

  it(`${ID} (twin: contact_names_body_only) a controller that names only the body fails, naming the occurrence`, () => {
    const failures = dropFailures(dropRows('contact_names_body_only'));
    caught(failures, 'contact_names_body_only');
    naming(failures, /^contact_begin: no row names the body kart and the wheel/, 'contact_names_body_only\'s failure names the occurrence contact_begin');
  }, TIMEOUT);
});
