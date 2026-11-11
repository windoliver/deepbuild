// #504.df4b9c8f: "A figure's assemblies take apart in order and come back, its readout shows the values that move the
// parts, and saving the document reloads it in place"
//
// The box figure (helpers.ts `boxFigure`): four assemblies, `base` ← `body` ← `lid` ← `knob` (each the parent of the
// next), each with one part (`plate`, `shell`, `cover`, `cap`) that names it as its parent; `body` slides on +Y by its
// `value`, which the driver `raise` sets from the slider `lift` (0 to 0.2 m); apart vectors body (0, 0.3, 0), lid
// (0, 0.3, 0), knob (0.25, 0, 0), in `order` 1, 2, 3; the take-apart is the follow channel `take` on
// `assemblies/apart`, its source keyed 0 → 1 at 1 s and back to 0 at 4 s, a 0.5 s linear transition, its stagger over
// body, lid and knob 0.25 s apart; the card's readout `Lift {assemblies/body/value} m`.
//
// asserts:
//   - take apart in order and come back (`deep-motion eval`, every 1/60 s frame of 0 to 6 s): each assembly's own
//     offset (its part's displacement less its parent's part's) first leaves zero later than the assembly before it in
//     `order` (body, then lid, then knob); from 2.5 s to 4 s each own offset is its apart vector within 1e-9 m; from
//     5.5 s every part is back at rest within 1e-9 m. The planted `take_apart_all_at_once` (eval `planted`: every
//     assembly starts at the stagger's first start) fails, naming the lid;
//   - the readout (`deep-motion eval`, a recorded track: lift 0.05 at 0.2 s, 0.125 at 0.4 s, 0.2 at 0.6 s; frames at
//     0.3, 0.5 and 0.7 s): the shell, the cover and the cap each risen by the lift within 1e-9 m, and the frame's
//     `readouts.card` showing exactly one number, that lift. The planted `readout_reads_document` (eval `planted`: the
//     card fills from the values as the document writes them) fails, naming the readout;
//   - reload in place (`deep-show run`): the figure presented and evaluated at 0.3 s; `read` gives the saved document;
//     that document with the cap's size changed, presented again as a whole revision, reports the cap changed and no
//     other part; evaluated again at 0.3 s, no node of the plate, the shell or the cover runs (each kept or taken from
//     the cache), and a node of the cap does. The planted `reload_rebuilds_every_part` (the scenario's `planted`: a
//     whole revision presented again rebuilds every part) fails, naming the shell.
import { describe, expect, it } from 'vitest';
import {
  ASSEMBLIES, PARTS, TAKE_APART, TIMEOUT, arr, boxFigure, brief, docId, entry, evalFrames, failsNaming, fl, grid, isObject, itemPos, none,
  norm, numbersIn, obj, present, presented, runShow, scenarioOf, strip, sub, useBins, useFolders, type Frame, type JsonObject, type V3,
} from './helpers.ts';

/** The criterion's ID: `#504.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#504.df4b9c8f';

const bin = useBins(['motion', 'show']);
const folder = useFolders();

/** Each assembly in the take-apart's order, with its part and its parent's part. */
const OWN = TAKE_APART.order.map((a) => {
  const part = Object.keys(PARTS).find((p) => PARTS[p]!.assembly === a)!;
  const parent = ASSEMBLIES[a]!.parent!;
  const parentPart = Object.keys(PARTS).find((p) => PARTS[p]!.assembly === parent)!;
  return { assembly: a, part, parentPart };
});
const moved = (f: Frame, part: string, what: string): V3 => sub(itemPos(f, part, what), PARTS[part]!.pos);

function takeApartFailures(frames: Frame[], what: string): string[] {
  const failures: string[] = [];
  const own = (f: Frame, k: number): V3 => sub(moved(f, OWN[k]!.part, what), moved(f, OWN[k]!.parentPart, what));
  const departs = OWN.map((_, k) => frames.findIndex((f) => norm(own(f, k)) > 1e-9));
  OWN.forEach((o, k) => {
    if (departs[k]! < 0) failures.push(`${what}: ${o.assembly} never leaves its parent`);
    else if (frames[departs[k]!]!.t <= fl(TAKE_APART.apart)) failures.push(`${what}: ${o.assembly} leaves its parent at ${frames[departs[k]!]!.t} flicks, before the take-apart starts at ${TAKE_APART.apart} s`);
    if (k > 0 && departs[k]! >= 0 && departs[k - 1]! >= 0 && departs[k]! <= departs[k - 1]!) {
      failures.push(`${what}: ${o.assembly} leaves its parent at frame ${departs[k]}, no later than ${OWN[k - 1]!.assembly} at frame ${departs[k - 1]}: the take-apart isn't in order`);
    }
  });
  for (const f of frames) {
    const s = f.t / fl(1);
    if (s >= 2.5 && s < TAKE_APART.back) {
      OWN.forEach((o, k) => {
        const off = own(f, k);
        if (norm(sub(off, ASSEMBLIES[o.assembly]!.apart)) > 1e-9) failures.push(`${what}: at ${s} s ${o.assembly} is ${brief(off)} from its parent, not apart by ${brief(ASSEMBLIES[o.assembly]!.apart)}`);
      });
    }
    if (s >= 5.5) for (const p of Object.keys(PARTS)) if (norm(moved(f, p, what)) > 1e-9) failures.push(`${what}: at ${s} s ${p} is ${brief(moved(f, p, what))} from rest, not back`);
  }
  return failures;
}

const LIFTS: [number, number][] = [[0.2, 0.05], [0.4, 0.125], [0.6, 0.2]];
const READ_AT = [0.3, 0.5, 0.7];
function readoutFailures(frames: Frame[], what: string): string[] {
  const failures: string[] = [];
  frames.forEach((f, i) => {
    const lift = LIFTS[i]![1];
    for (const p of ['shell', 'cover', 'cap']) {
      const m = moved(f, p, what);
      if (norm(sub(m, [0, lift, 0])) > 1e-9) failures.push(`${what}: at ${READ_AT[i]} s ${p} moved ${brief(m)}, not up by the lift ${lift} m`);
    }
    const text = f.readouts['card'];
    const shown = typeof text === 'string' ? numbersIn(text) : [];
    if (shown.length !== 1 || Math.abs(shown[0]! - lift) > 1e-9) failures.push(`${what}: at ${READ_AT[i]} s the card's readout reads ${brief(text ?? null)}, not the lift ${lift} that moves the parts`);
  });
  return failures;
}

const DOC = docId(31);
const T = fl(0.3);
/** The saved figure with the cap's size changed: the one part whose shape the edit changes. */
function edited(saved: JsonObject): JsonObject {
  const out = strip(saved);
  const cap = obj(obj(out['items'], 'the saved document: items')['cap'], 'the saved document: items.cap');
  obj(cap['params'], 'items.cap.params')['size'] = [0.08, 0.04, 0.08];
  return out;
}
const nodesOf = (reply: JsonObject, what: string): JsonObject[] => arr(reply['nodes'], `${what}: nodes`).filter(isObject);
function reloadFailures(replies: JsonObject[], what: string): string[] {
  presented(replies[0]!, `${what}: the figure`);
  const failures: string[] = [];
  const first = nodesOf(replies[1]!, `${what}: the first frame`);
  for (const p of Object.keys(PARTS)) if (!first.some((n) => n['item'] === p)) failures.push(`${what}: the first frame evaluates no node of ${p}`);
  presented(replies[2]!, `${what}: the saved document, reloaded`);
  const changed = Array.isArray(replies[2]!['changed']) ? replies[2]!['changed'] : [];
  if (!changed.includes('cap')) failures.push(`${what}: the reload doesn't report the cap changed: ${brief(changed)}`);
  for (const p of ['plate', 'shell', 'cover']) if (changed.includes(p)) failures.push(`${what}: the reload reports ${p} changed`);
  const again = nodesOf(replies[3]!, `${what}: the frame after the reload`);
  for (const p of ['plate', 'shell', 'cover']) {
    const ran = again.filter((n) => n['item'] === p && n['run'] === 'ran');
    if (ran.length) failures.push(`${what}: reloading rebuilt ${p}, whose shape didn't change: ${ran.map((n) => String(n['operator'])).join(', ')}`);
  }
  if (!again.some((n) => n['item'] === 'cap' && n['run'] === 'ran')) failures.push(`${what}: the cap, whose shape changed, isn't rebuilt`);
  return failures;
}

describe(`${ID} a figure's assemblies take apart and come back, its card reads what moves them, and a saved figure reloads in place`, () => {
  it(`${ID} the assemblies take apart in their order, each by its apart vector, and come back to rest; a planted take-apart that moves every assembly at once fails, naming the lid`, () => {
    const times = grid(60, 0, 6);
    none(takeApartFailures(evalFrames(bin('motion'), { doc: boxFigure(), times }, 'the take-apart'), 'the take-apart'), 'the take-apart in order and back');
    const planted = evalFrames(bin('motion'), { doc: boxFigure(), times, planted: 'take_apart_all_at_once' }, 'the planted take-apart');
    failsNaming(takeApartFailures(planted, 'the planted take-apart'), ['lid'], 'the planted take-apart that moves every assembly at once');
  }, TIMEOUT);

  it(`${ID} the card's readout shows the lift that moves the parts at each entry; a planted readout that reads the document's own values fails, naming the readout`, () => {
    const line = { doc: boxFigure(), times: READ_AT.map(fl), track: LIFTS.map(([t, v]) => entry(t, 'lift', v)) };
    none(readoutFailures(evalFrames(bin('motion'), line, 'the lifted box'), 'the lifted box'), 'the readout reads the values that move the parts');
    failsNaming(readoutFailures(evalFrames(bin('motion'), { ...line, planted: 'readout_reads_document' }, 'the planted readout'), 'the planted readout'), ['readout'], 'the planted readout');
  }, TIMEOUT);

  it(`${ID} the saved figure, reloaded with one part's shape changed, rebuilds that part alone; a planted reload that rebuilds every part fails, naming the shell`, () => {
    const world = (calls: JsonObject[], planted?: string): JsonObject =>
      scenarioOf({ evidence: folder(), panels: { main: [0, 0, 1280, 720] }, docs: { [DOC]: { panel: 'main' } }, calls, ...(planted ? { planted } : {}) });
    const first = [present(DOC, boxFigure()), { call: 'eval', doc: DOC, t: T }];
    const saved = runShow(bin('show'), world([...first, { call: 'read', doc: DOC }]), 'the figure, saved');
    presented(saved[0]!, 'the figure');
    const document = obj(saved[2]!['document'], `the saved document (read: ${brief(saved[2]!, 600)})`);
    expect(isObject(document['assemblies']), 'the saved document keeps its assemblies').toBe(true);
    const calls = [...first, present(DOC, edited(document)), { call: 'eval', doc: DOC, t: T }];
    none(reloadFailures(runShow(bin('show'), world(calls), 'the reload'), 'the reload'), 'the saved figure reloads in place');
    failsNaming(reloadFailures(runShow(bin('show'), world(calls, 'reload_rebuilds_every_part'), 'the planted reload'), 'the planted reload'), ['shell'], 'the planted reload that rebuilds every part');
  }, TIMEOUT);
});
