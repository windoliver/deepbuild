// AC2 #2450.880b408d: "A title naming an item of any other kind is refused at check with `bad_axis`, naming
// `items/<axes>/params/titles/<axis>`"
//
// One document through the working agent's `deep_show` on the full build (README: Fixtures): the axes of criterion 1
// with the vector item `xt` and one item of each of twelve other kinds, among them the kinds a title is most easily
// mistaken to take: a 2D `text@1`, a 3D `mark.text@1`, a `path@1`, a `scale@1` and the axes themselves. The first
// test shows it once with three text titles (presented: every item is valid on its own), then once for each of the
// twelve items with one title, on x, y and z in turn, naming it: each revision is refused, with an error issue of
// code `bad_axis` whose `path` is `items/axes/params/titles/<that axis>`, and no other error on the axes. The
// control is the same revision with that one title naming `xt`, on each axis: presented, with no error, so the kind
// of the named item is all that separates a refusal from it (Scope: "The check stops refusing a title that names a
// `vector@1` item, and refuses one naming any other kind, naming the field").
// The second test runs the planted `axes_title_takes_any_kind` (README: The planted program), whose check takes a
// title naming an item of any kind: the same twelve revisions then fail the judge, each failure naming its field.
// Wrong programs: the base (it refuses the title naming the vector item too, so the control fails there); the plant;
// a check that tells a vector item only by its ID resolving; a refusal with another code, at the axes item or at
// `titles` without the axis, or at another axis.
import { describe, expect, it } from 'vitest';
import {
  AC, AXES, TIMEOUT, VECTOR, agentDoc, brief, docId, errors, notPresented, obj, orbitCamera, putBytes, runShow, sceneItems, sessionDoc, show, str, titleSvg,
  useBins, useOut, type Axis, type JsonObject, type Planted,
} from './helpers.ts';

const ID = AC[2];
const NAME = `AC2 ${ID}`;
const bin = useBins(['deep-show']);
const out = useOut();
const AXIS: Axis[] = ['x', 'y', 'z'];
const field = (axis: Axis): string => `items/${AXES}/params/titles/${axis}`;

/** One item of each of seven more kinds, beside the scene's camera, sky, sun, scales and axes. */
const OTHERS: Record<string, JsonObject> = {
  clay: { kind: 'material@1', params: { base_color: [0.85, 0.45, 0.25, 1], roughness: 0.6, metallic: 0 } },
  note: { kind: 'mark.text@1', at: { pos: [0, 2, 0] }, params: { text: 'a note', font: 'body', size: 0.25, size_space: 'world', facing: 'camera', paint: { fill: { role: 'ink' } } } },
  pt: { kind: 'mark.point@1', at: { pos: [1, 1, 1] }, params: { size: 10, paint: { fill: { role: 'ink' } } } },
  rule: { kind: 'mark.line@1', params: { points: [[0, 0, 0], [1, 1, 0]], width: 1.5, paint: { stroke: { role: 'ink' } } } },
  slab: { kind: 'plate@1', at: { pos: [0, -1, 0] }, params: { grid: [1, 1], size: [1, 1] }, material: 'clay' },
  word: { kind: 'text@1', at: { pos: [12, 10, 0] }, params: { text: 'a word', font: 'body', size: 14, box: { w: 112, h: 20 }, paint: { fill: { role: 'ink' } } } },
  shape: { kind: 'path@1', params: { d: 'M 0 0 L 40 0 L 40 20 Z', paint: { fill: { role: 'ink' } } } },
};
/** The items a title must not name: every item of the document but the vector item, the axes among them. */
const NAMED = ['cam', 'sky', 'sun', 'xs', AXES, ...Object.keys(OTHERS)];

/** The revisions: the document with `titles`, in the agent's form. */
function revision(src: string, titles: JsonObject): JsonObject {
  return agentDoc(sessionDoc('kinds-2450', [640, 360], sceneItems(src, orbitCamera('orthographic', 30), titles, {}, OTHERS)));
}
const kindOf = (doc: JsonObject, id: string): string => str(obj(obj(doc['items'], 'items')[id], `items.${id}`)['kind'], `items.${id}.kind`);

/** What is wrong with the refusal of a title on `axis` that names an item of another kind: sentences, each naming the field. */
function refusalFailures(reply: JsonObject, axis: Axis, what: string): string[] {
  const failures: string[] = [];
  const errs = errors(reply, what);
  const list = errs.map((e) => brief(e.raw, 400)).join('; ') || 'no error issue';
  if (reply['outcome'] !== 'refused') failures.push(`${what}: the revision is ${brief(reply['outcome'])}, not refused at ${field(axis)}`);
  if (!errs.some((e) => e.code === 'bad_axis' && e.path === field(axis))) failures.push(`${what}: no error issue is bad_axis at ${field(axis)}: ${list}`);
  const onAxes = errs.filter((e) => (e.ids.includes(AXES) || e.path === `items/${AXES}` || e.path.startsWith(`items/${AXES}/`)) && !(e.code === 'bad_axis' && e.path === field(axis)));
  if (onAxes.length) failures.push(`${what}: the axes are refused another way than bad_axis at ${field(axis)}: ${onAxes.map((e) => brief(e.raw, 400)).join('; ')}`);
  return failures;
}

/** Each of the twelve revisions whose one title names an item of another kind, shown in one run: its judge's failures. */
function judged(dir: string, planted?: Planted): { id: string; kind: string; axis: Axis; failures: string[] }[] {
  const src = putBytes(dir, titleSvg());
  const docs = NAMED.map((_, i) => docId(100 + i));
  const revisions = NAMED.map((id, i) => revision(src, { [AXIS[i % 3]!]: id }));
  const replies = runShow(bin('deep-show'), dir, docs, revisions.map((r, i) => show(docs[i]!, r)), planted);
  return NAMED.map((id, i) => {
    const [axis, kind] = [AXIS[i % 3]!, kindOf(revisions[i]!, id)];
    return { id, kind, axis, failures: refusalFailures(replies[i]!, axis, `the ${axis} title naming ${id}, a ${kind}`) };
  });
}

describe(`${NAME} a title naming an item of any other kind is refused at check, naming the field`, () => {
  it(`${NAME} a title naming an item of each of twelve other kinds is refused with bad_axis at items/axes/params/titles/<axis>, and the same title naming the vector@1 item isn't`, () => {
    const dir = out();
    const src = putBytes(dir, titleSvg());
    // The fixture: twelve items of twelve kinds, none a vector, beside the one vector item.
    const whole = revision(src, { x: 'x', y: 'y', z: 'z' });
    const kinds = NAMED.map((id) => kindOf(whole, id));
    expect(new Set(kinds).size, `the twelve named items are of twelve kinds: ${kinds.join(', ')}`).toBe(12);
    expect(kinds, 'none of them is a vector').not.toContain('vector@1');
    expect(kindOf(whole, VECTOR), 'the control names a vector@1 item').toBe('vector@1');
    expect(Object.keys(obj(whole['items'], 'items')).sort(), 'the document holds those items, the other scales and the vector item').toEqual([...NAMED, 'ys', 'zs', VECTOR].sort());
    const controls = [docId(1), docId(2), docId(3), docId(4)];
    const [texts, ...vectors] = runShow(bin('deep-show'), dir, controls, [show(controls[0]!, whole), ...AXIS.map((axis, i) => show(controls[1 + i]!, revision(src, { [axis]: VECTOR })))]);
    expect(notPresented(texts!, 'the document with three text titles'), 'with text titles the document is presented: every item in it is valid on its own').toEqual([]);

    const refusals = judged(dir);
    expect(refusals.flatMap((r) => r.failures), 'a title naming an item of any other kind is refused with bad_axis, naming its field').toEqual([]);
    expect(AXIS.flatMap((axis, i) => notPresented(vectors[i]!, `the ${axis} title naming the vector@1 item ${VECTOR}`)), 'the same title naming the vector@1 item is presented, with no error').toEqual([]);
  }, TIMEOUT);

  it(`${NAME} a planted check that takes a title naming an item of any kind fails, naming items/axes/params/titles/<axis> for each kind`, () => {
    const refusals = judged(out(), 'axes_title_takes_any_kind');
    expect(refusals.filter((r) => r.failures.length === 0).map((r) => `${r.id} (${r.kind})`), 'under the plant the judge fails for every one of the twelve kinds').toEqual([]);
    expect(refusals.flatMap((r) => r.failures.filter((f) => !f.includes(field(r.axis)))), 'each failure names the title\'s field').toEqual([]);
  }, TIMEOUT);
});
