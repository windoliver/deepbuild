// AC2 #451.6846b36f: "A world-space emitter whose anchor a logic array or a live drag moves is refused at check, naming
// the anchor, and a channel-driven anchor emits at the same bucket times on a 60 Hz and a 144 Hz display"
//
// The emitter `sparks` (3D, `space: world`, `emit.anchor` naming its anchor, born 45 a second, life 1 s, no motion of
// its own, so each particle stays where its anchor was at its birth bucket). The document's frame rate is 30/1, so
// birth buckets fall on whole multiples of 1/30 s (Particles: space and paths), neither display's frame interval.
//
// Refused at check (the `particles` call's check, #449's): with the anchor `swarm#0.0`, an element of an instancer
// whose `pos` reads the logic array `brain.pos`; and with the anchor `puck`, the handle of a document control dragged
// live (`drag_along`). Each must answer `refused` with an error issue at `items/sparks/params/emit/anchor` whose `ids`
// name the anchor (its item, or the anchor as written). The same reply with that issue taken out, made in test code,
// fails the judge naming the anchor.
//
// Same bucket times: the anchor `ship`, keyed by a channel from x = 0 to 4 m over 4 s (1 m/s) at y = 1. `view3d` draws
// the document at 60 fps (frames 0 to 180) and at 144 fps (frames 0 to 432), each in its own process, with #449's
// `particles` field; the `particles` call evaluates it at the 36 times both displays draw, m ÷ 12 s for m = 1 to 36.
// At each: the 60 Hz frame 5m and the 144 Hz frame 12m carry the same evaluated-data hash, the hash of the evaluation's
// places; and every live particle sits where the anchor was at a bucket: x a whole multiple of 1/30 m within 1e-6, that
// bucket less than one interval from its birth, y 1 and z 0 within 1e-6. Two wrong programs made in test code from
// this run's readings must fail naming `sparks`: births keyed to each display's frames (the anchor read at the last
// 1/60 s or 1/144 s at or before each birth), and births read at their exact time, not their bucket.

import { describe, expect, it } from 'vitest';
import {
  FLICKS, STILL, TIMEOUT, ac, camera, checkOf, errors, evaluatedHash, failsNaming, framesOf, linearChannel, none, particlesCall,
  passed, reading, requireGpu, run, sha256, show, useBins, useDir, view3d, writeJson,
  type Checked, type JsonObject, type V3,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const BUCKET = 1 / 30;
const SHARED = Array.from({ length: 36 }, (_, i) => i + 1);
/** m ÷ 12 s in whole flicks: frame 5m at 60 fps and frame 12m at 144 fps. */
const sharedT = (m: number): number => m * (FLICKS / 12);
const ANCHOR_PATH = 'items/sparks/params/emit/anchor';

/** A 3D document as a session holds it (#378), the emitter `sparks` anchored to `anchor` in `space`. */
function sceneDoc(slug: string, anchor: string, items: Record<string, JsonObject>, extra: JsonObject = {}, space: 'world' | 'local' = 'world'): JsonObject {
  const all: Record<string, JsonObject> = {
    cam: camera([2, 1.5, 6], [2, 1, 0], 45),
    ...items,
    sparks: {
      kind: 'particles@1', at: { pos: [0, 0, 0] },
      params: { count: 64, life: 1, space, emit: { anchor, rate: 45 }, motion: STILL, draw: 'dot', size: 4, opacity: 1, color: [{ at: 0, role: 'spark-a' }, { at: 1, role: 'spark-b' }] },
    },
  };
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(all)) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id: `doc-451-${slug}`, profile: 'scene', title: `World anchor ${slug}`, description: `World anchor ${slug}: a #451 acceptance fixture.`, size: [320, 240], seed: 451,
    camera: 'cam', requires: { modules: { scene3d: '^1', effects: '^1' } }, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    transport: { span: '4s', frame_rate: '30/1' },
    ...extra,
    items: withIds,
  };
}
const sphere = (pos: V3, role: string): JsonObject => ({ kind: 'mark.sphere@1', params: { size: [0.1, 0.1, 0.1], paint: { fill: { role } } }, at: { pos } });

/** The anchor an element of an instancer whose `pos` reads the logic array `brain.pos`. */
const logicDoc = (): JsonObject => sceneDoc('logic', 'swarm#0.0', {
  brain: { kind: 'logic@1', params: { program: sha256('#451 brain'), step_rate: 60, reads: [], writes: { pos: { type: 'vec3', count: 1 }, live: { type: 'bool', count: 1 }, gen: { type: 'u32', count: 1 } } } },
  probe: sphere([0, 1, 0], 'lamp'),
  swarm: { kind: 'instance@1', params: { of: ['probe'], pos: { array: 'brain.pos', as: 'vec3' }, live: { array: 'brain.live', as: 'bool' }, gen: { array: 'brain.gen', as: 'u32' } } },
});
/** The anchor the handle of a document control you drag live (#308's `drag_along` spelling). */
const dragDoc = (): JsonObject => sceneDoc('drag', 'puck', { puck: sphere([0, 1, 0], 'lamp') }, {
  controls: { slide: { kind: 'drag_along', class: 'document', label: 'Slide', role: 'slider', range: [0, 1], default: 0, handle: { item: 'puck', along: { polyline: [[0, 1], [2, 1]] }, drag: 'along' } } },
});
/** The anchor `ship`, keyed by a channel along x at 1 m/s over the 4 s. */
const SHIP_KEYS = [[0, 0], [4, 4]] as const;
const channelDoc = (): JsonObject => sceneDoc('channel', 'ship', { ship: sphere([0, 1, 0], 'lamp') }, { channels: { slide: linearChannel('items/ship/at/pos/0', SHIP_KEYS) } });

/** The refusal AC2 asks of a check: an error at the anchor's path naming the anchor. The failure names the anchor. */
function refusalProblems(c: Checked, anchor: string, how: string): string[] {
  const item = anchor.split('#')[0]!;
  const named = c.outcome === 'refused' && errors(c).some((i) => i.path === ANCHOR_PATH && (i.ids.includes(item) || i.ids.includes(anchor)));
  return named ? [] : [`sparks, a world-space emitter whose anchor ${anchor} ${how}, is not refused at check with an error at ${ANCHOR_PATH} naming ${anchor} (outcome ${c.outcome}, errors ${show(errors(c).map((i) => i.raw))})`];
}

interface Display { hz: 60 | 144; hashes: Map<number, string> }
/** The displays' hashes at each shared time against the evaluation's; each failure names `sparks` and the time. */
function sameDisplays(d60: Display, d144: Display, evaluated: Map<number, string>): string[] {
  const out: string[] = [];
  for (const m of SHARED) {
    const want = evaluated.get(m)!;
    const a = d60.hashes.get(m); const b = d144.hashes.get(m);
    if (a !== b) out.push(`sparks at ${m}/12 s: the 60 Hz display draws evaluated data ${a?.slice(0, 12) ?? 'none'}, the 144 Hz display ${b?.slice(0, 12) ?? 'none'}`);
    if (a !== want) out.push(`sparks at ${m}/12 s: the 60 Hz display draws evaluated data ${a?.slice(0, 12) ?? 'none'}, the evaluation gives ${want.slice(0, 12)}`);
    if (b !== want) out.push(`sparks at ${m}/12 s: the 144 Hz display draws evaluated data ${b?.slice(0, 12) ?? 'none'}, the evaluation gives ${want.slice(0, 12)}`);
  }
  return out;
}

interface Live3 { row: number; at: V3; born: number }
/** Every live particle where the anchor was at a bucket less than one interval from its birth. */
function bucketProblems(samples: Map<number, Live3[]>): string[] {
  const out: string[] = [];
  for (const [m, live] of samples) {
    for (const l of live) {
      const name = `sparks row ${l.row} at ${m}/12 s (born at ${l.born.toFixed(6)} s)`;
      const k = Math.round(l.at[0] / BUCKET);
      const bucket = k * BUCKET;
      if (Math.abs(l.at[0] - bucket) > 1e-6) out.push(`${name}: x ${l.at[0].toFixed(7)} m is no whole multiple of 1/30 m, so ship wasn't read at a birth bucket`);
      else if (Math.abs(l.born - bucket) >= BUCKET - 1e-9) out.push(`${name}: it sits where ship was at ${bucket.toFixed(6)} s, a bucket a whole interval or more from its birth`);
      if (Math.abs(l.at[1] - 1) > 1e-6 || Math.abs(l.at[2]) > 1e-6) out.push(`${name}: at (${l.at.map((x) => x.toFixed(6)).join(', ')}), off ship's line y = 1, z = 0`);
    }
  }
  return out;
}

describe(`${ac(2)} a world-space emitter's anchor: refused when logic or a drag moves it, emitting at the same buckets on two displays when a channel does`, () => {
  it(`${ac(2)} a world-space emitter whose anchor a logic array or a live drag moves is refused at check, naming the anchor`, () => {
    const calls = [logicDoc(), dragDoc(), channelDoc()].map((d, i) => particlesCall({ doc: writeJson(dir(), `doc-${i}.json`, d) }));
    const replies = run(bins.bin('deep-gpu'), dir(), calls, { backend: 'noop' });
    const cases = [
      { anchor: 'swarm#0.0', how: 'is moved by the logic array brain.pos', check: checkOf(replies[0]!, calls[0]!, 'the logic-moved anchor') },
      { anchor: 'puck', how: 'is dragged live by the control slide', check: checkOf(replies[1]!, calls[1]!, 'the dragged anchor') },
    ];
    for (const c of cases) {
      none(refusalProblems(c.check, c.anchor, c.how), `the anchor that ${c.how}`);
      // The same check without the refusal (a check that misses the rule) fails, naming the anchor.
      const missed: Checked = { ...c.check, outcome: 'checked', issues: c.check.issues.filter((i) => i.path !== ANCHOR_PATH) };
      failsNaming(refusalProblems(missed, c.anchor, c.how), [c.anchor], `a check that doesn't refuse the anchor that ${c.how}`);
    }
    passed(replies[2]!, calls[2]!, 'the channel-driven anchor (a world-space emitter whose anchor a channel moves is checked)');
  }, TIMEOUT);

  it(`${ac(2)} a channel-driven anchor emits at the same bucket times on a 60 Hz and a 144 Hz display; display-keyed or unbucketed births fail naming the emitter`, () => {
    requireGpu();
    const path = writeJson(dir(), 'channel.json', channelDoc());
    const call = particlesCall({ doc: path, t: SHARED.map(sharedT), items: ['sparks'] });
    const r = reading(passed(run(bins.bin('deep-gpu'), dir(), [call], { backend: 'noop' })[0]!, call, 'the channel-driven anchor'), 'sparks', 'the channel-driven anchor');
    const display = (hz: 60 | 144): Display => {
      const frames = (hz / 12) * 36 + 1;
      const fs = framesOf(run(bins.bin('deep-gpu'), dir(), [view3d({ doc: path, fps: hz, from: 0, frames, particles: ['sparks'], particle_cull: 'none' })])[0]!, `the ${hz} Hz display`, ['sparks']);
      expect(fs.length, `the ${hz} Hz display draws frames 0 to ${frames - 1}`).toBe(frames);
      return { hz, hashes: new Map(SHARED.map((m) => [m, fs.find((f) => f.frame === (hz / 12) * m)?.particles.get('sparks')?.hash ?? ''])) };
    };
    const d60 = display(60);
    const d144 = display(144);

    const live = new Map<number, Live3[]>();
    const evaluated = new Map<number, string>();
    SHARED.forEach((m, k) => {
      const cpu = r.at[k]!.cpu;
      evaluated.set(m, evaluatedHash(cpu));
      const t = m / 12;
      live.set(m, cpu.flatMap((at, row) => {
        if (at === null) return [];
        const p = r.particles.find((q) => q.row === row && q.born <= t && t < q.ends);
        expect(p, `sparks row ${row} is live at ${m}/12 s and a particle in the list holds it`).toBeDefined();
        return [{ row, at, born: p!.born }];
      }));
    });
    for (const m of SHARED.filter((x) => x >= 12)) expect(live.get(m)!.length, `about 45 sparks live at ${m}/12 s`).toBeGreaterThanOrEqual(40);
    expect(new Set(live.get(36)!.map((l) => l.at[0])).size, 'the sparks at 3 s sit at many places along ship\'s path').toBeGreaterThanOrEqual(20);
    // `born` is each particle's own birth time (45 a second), not its bucket, so most fall between buckets.
    expect([...live.values()].flat().filter((l) => Math.abs(l.born / BUCKET - Math.round(l.born / BUCKET)) > 1e-6).length, 'sparks born between buckets').toBeGreaterThan(0);

    none(sameDisplays(d60, d144, evaluated), 'the 60 Hz and 144 Hz displays draw the evaluation\'s sparks at every time both draw');
    none(bucketProblems(live), 'every spark sits where ship was at its birth bucket');

    // Wrong programs made from this run's readings, each failing naming sparks.
    const keyed = (hz: number): Display => ({
      hz: hz as 60 | 144,
      hashes: new Map(SHARED.map((m, k) => [m, evaluatedHash(r.at[k]!.cpu.map((at, row) => {
        if (at === null) return null;
        const p = live.get(m)!.find((l) => l.row === row)!;
        return [Math.floor(p.born * hz) / hz, at[1], at[2]] as V3;
      }))])),
    });
    failsNaming(sameDisplays(keyed(60), keyed(144), evaluated), ['sparks'], 'births keyed to each display\'s frames');
    const exact = new Map([...live].map(([m, ls]) => [m, ls.map((l) => ({ ...l, at: [l.born, l.at[1], l.at[2]] as V3 }))]));
    failsNaming(bucketProblems(exact), ['sparks'], 'births read at their exact time, not their bucket');
  }, 2 * TIMEOUT);
});
