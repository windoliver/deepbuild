// AC5: "Particle counts follow the budget class: an item of count 1,048,576 checks in a showpiece and in an export, its
// estimate counting 1,048,576 elements in the class's operator time and 32 MiB of scratch; the same item in a figure is
// refused at check, naming the item, its count and the figure's cap of 65,536, and one of 1,048,577 in a showpiece is
// refused, naming the cap of 1,048,576; a planted check that applies 65,536 to every class refuses the showpiece, and one
// that applies 1,048,576 to every class passes the figure, and each fails, naming the item"
//
// One item `swarm` (helpers below) in four documents, each naming its class in `budget.class`: 1,048,576 particles in
// a showpiece, an export and a figure, and 1,048,577 in a showpiece. The `particles` call is asked for the check alone
// (no times). The showpiece and the export check, and the estimate counts the item's 1,048,576 elements, a share of
// operator time above 0 that the document's operator time includes, and 33,554,432 bytes (32 MiB, 32 B a particle) of
// scratch that the document's operator storage includes. The figure is refused with an error issue naming swarm, at
// items/swarm/params/count, whose `actual` names the count 1,048,576 and the cap 65,536; the 1,048,577 showpiece is
// refused the same way, naming the cap 1,048,576. The planted `count_cap_65536_every_class` and
// `count_cap_1048576_every_class` (README: Planted programs) each fail this check, in a failure that names swarm.

import { describe, it } from 'vitest';
import {
  TIMEOUT, ac, camera, checkOf, errors, failsNaming, fmt, isObject, none, particlesCall, particlesItem, runGpu, sessionDoc, show,
  useBins, useDir, writeJson, type Planted,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const SHOWPIECE_CAP = 1_048_576;
const FIGURE_CAP = 65_536;
const SCRATCH = 32 * 1024 * 1024;

function swarmDoc(cls: string, count: number): string {
  const doc = sessionDoc(`Swarm ${cls} ${count}`, {
    cam: camera([0, 2, 8], [0, 1, 0], 50),
    swarm: particlesItem({
      count, emit: { shape: 'sphere', radius: 1, rate: count, span: 4 }, life: [1, 1],
      motion: { ballistic: { v0: [0.5, 1], gravity: [0, -1, 0], drag: 0 } }, draw: 'dot', size: 1, opacity: 1,
    }, [0, 1, 0]),
  }, { budget: { class: cls }, transport: { span: '4s' } });
  return writeJson(dir(), `swarm-${cls}-${count}.json`, doc);
}

/** Everything the criterion asks of the four documents, as sentences naming what failed; each names the item. */
function classProblems(planted?: Planted): string[] {
  const cases = [
    { name: 'the showpiece of 1,048,576', cls: 'showpiece', count: SHOWPIECE_CAP, cap: null },
    { name: 'the export of 1,048,576', cls: 'export', count: SHOWPIECE_CAP, cap: null },
    { name: 'the figure of 1,048,576', cls: 'figure', count: SHOWPIECE_CAP, cap: FIGURE_CAP },
    { name: 'the showpiece of 1,048,577', cls: 'showpiece', count: SHOWPIECE_CAP + 1, cap: SHOWPIECE_CAP },
  ];
  const calls = cases.map((c) => particlesCall({ doc: swarmDoc(c.cls, c.count) }));
  const replies = runGpu(bins.bin('deep-gpu'), dir(), calls, { backend: 'noop', ...(planted ? { planted } : {}) });
  const out: string[] = [];
  cases.forEach((c, i) => {
    const r = checkOf(replies[i]!, calls[i]!, c.name);
    const named = errors(r).filter((x) => x.ids.includes('swarm'));
    if (c.cap === null) {
      if (r.outcome !== 'checked' || named.length) { out.push(`${c.name}: swarm is refused at check: ${show(errors(r).map((x) => x.raw))}`); return; }
      const e = r.estimate!.items.get('swarm');
      if (!e) { out.push(`${c.name}: the estimate has no entry for swarm`); return; }
      if (e.elements !== SHOWPIECE_CAP) out.push(`${c.name}: the estimate counts ${e.elements} compute elements for swarm, not 1,048,576`);
      if (e.scratchBytes !== SCRATCH) out.push(`${c.name}: the estimate counts ${e.scratchBytes} bytes of scratch for swarm, not 33,554,432 (32 MiB)`);
      if (!(e.operatorMs > 0)) out.push(`${c.name}: swarm's 1,048,576 elements count ${e.operatorMs} ms of operator time`);
      if (!(r.estimate!.operatorMs >= e.operatorMs)) out.push(`${c.name}: the class's operator time ${fmt(r.estimate!.operatorMs)} ms leaves out swarm's ${fmt(e.operatorMs)} ms`);
      if (!(r.estimate!.storageBytes >= e.scratchBytes)) out.push(`${c.name}: the class's operator storage ${r.estimate!.storageBytes} B leaves out swarm's scratch`);
      return;
    }
    if (r.outcome !== 'refused' || !named.length) { out.push(`${c.name}: swarm is not refused at check, though its count passes the ${c.cls}'s cap of ${c.cap}`); return; }
    const right = named.find((x) => x.path === 'items/swarm/params/count' && isObject(x.actual) && x.actual['count'] === c.count && x.actual['cap'] === c.cap);
    if (!right) out.push(`${c.name}: swarm's refusal doesn't name its count ${c.count} and the cap ${c.cap} at items/swarm/params/count: ${show(named.map((x) => x.raw))}`);
  });
  return out;
}

describe(`${ac(5)} particle counts follow the budget class`, () => {
  it(`${ac(5)} 1,048,576 particles check in a showpiece and an export with 1,048,576 elements and 32 MiB of scratch in the estimate; a figure refuses them naming swarm, 1,048,576 and the cap of 65,536; a showpiece refuses 1,048,577 naming the cap of 1,048,576`, () => {
    none(classProblems(), 'counts by budget class');
  }, TIMEOUT);

  it(`${ac(5)} the planted check that applies 65,536 to every class refuses the showpiece, and fails naming swarm`, () => {
    failsNaming(classProblems('count_cap_65536_every_class'), ['swarm'], 'the planted count_cap_65536_every_class');
  }, TIMEOUT);

  it(`${ac(5)} the planted check that applies 1,048,576 to every class passes the figure, and fails naming swarm`, () => {
    failsNaming(classProblems('count_cap_1048576_every_class'), ['swarm'], 'the planted count_cap_1048576_every_class');
  }, TIMEOUT);
});
