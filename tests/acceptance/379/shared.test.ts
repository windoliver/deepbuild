// #379.0806d709: results shared by content key are allocated once, counted in full against every writer
// that reads them, and released once none does.
//
// Part one: two writers' documents in one window each hold a 4096 × 4096 rgba8 texture with all its mips and
// a 200,000-vertex mesh by equal content keys (the test module's `test.texture@1` and `test.mesh@1`, in the
// `test-meter` build). Alpha's session closes at frame 61 and bravo's at 181; bravo's frames 61–180 are
// compared with a run where bravo was alone. Part two: 200 cycles of a writer that opens a document with a
// 20,000-vertex mesh keyed by the cycle number, sends a revision the check refuses (it names an item's layer), one superseded before the
// latch and one naming an asset whose bytes fail their sha256, then closes. `--planted charges_first_holder`
// and `--planted keeps_unread_results` must fail, naming the writer and the cycle. Device readings are
// Metal's allocated size after each frame's queue drained; off macOS: INCONCLUSIVE.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MB, MIB, W, liveCall, liveReply, mesh, one, requireMetal, sceneDoc, sha256, texture, useBuilds, useOut, viewOf, writeDoc,
  type Frame, type JsonObject, type Live, type LiveEvent, type Planted,
} from './helpers.ts';

const builds = useBuilds(['test-meter']);
const out = useOut();
const ID = '#379.0806d709';

/** A 4096 × 4096 rgba8 texture with all 13 mips holds at least this many bytes; 200,000 vertices at least 12 B each. */
const TEXTURE_MIN = Array.from({ length: 13 }, (_, i) => (4096 >> i) ** 2 * 4).reduce((a, b) => a + b, 0);
const MESH_MIN = 200_000 * 12;

const pairDoc = (title: string): JsonObject => sceneDoc({
  title, class: 'work_product', size: [256, 256], moving: true,
  items: { tex: texture('tex', [4096, 4096], 'shared'), shape: mesh('shape', 200_000, 'shared') },
});

function pairRun(alone: boolean, planted?: Planted): Live {
  const a = writeDoc(out(), 'alpha', pairDoc('Alpha\'s copy'));
  const b = writeDoc(out(), 'bravo', pairDoc('Bravo\'s copy'));
  const sessions = alone ? [{ session: 's-bravo', writer: W.bravo, doc: b }] : [{ session: 's-alpha', writer: W.alpha, doc: a }, { session: 's-bravo', writer: W.bravo, doc: b }];
  const events: LiveEvent[] = alone ? [] : [{ frame: 61, close: 's-alpha' }, { frame: 181, close: 's-bravo' }];
  return liveReply(one(builds.bin('test-meter'), out(), liveCall({ frames: alone ? 180 : 185, sessions, events, report: ['memory', 'hashes'] }), planted ? { planted } : {}));
}

const at = (live: Live, n: number): Frame => {
  const f = live.frames.find((x) => x.frame === n);
  expect(f, `frame ${n} is reported`).toBeDefined();
  return f!;
};
const held = (f: Frame, writer: string) => {
  const h = (f.writers ?? []).find((x) => x.writer === writer);
  expect(h, `frame ${f.frame}: the meter counts ${writer}`).toBeDefined();
  return h!;
};

/** The results both writers hold at frame 60, by key: the shared pair. */
function sharedPair(live: Live): { keys: string[]; bytes: number } {
  const f = at(live, 60);
  const a = held(f, W.alpha);
  const b = held(f, W.bravo);
  const keys = a.results.map((r) => r.key).filter((k) => b.results.some((r) => r.key === k));
  const bytes = keys.reduce((s, k) => s + a.results.find((r) => r.key === k)!.bytes, 0);
  return { keys, bytes };
}

/** What the criterion asks of the counts: each writer holds the pair in full, and bravo's count doesn't move when alpha closes. */
function holdProblems(live: Live, pair: { keys: string[]; bytes: number }): string[] {
  const out: string[] = [];
  for (const w of [W.alpha, W.bravo]) {
    const h = held(at(live, 60), w);
    const sum = h.results.filter((r) => pair.keys.includes(r.key)).reduce((s, r) => s + r.bytes, 0);
    if (sum < TEXTURE_MIN + MESH_MIN || h.count_bytes < sum) out.push(`writer ${w}: its count ${h.count_bytes} B at frame 60 doesn't hold the shared texture and mesh in full (${sum} B of results)`);
  }
  const before = held(at(live, 60), W.bravo);
  for (let n = 61; n <= 180; n++) {
    const after = held(at(live, n), W.bravo);
    if (after.count_bytes !== before.count_bytes) { out.push(`writer ${W.bravo}: its count moved from ${before.count_bytes} B to ${after.count_bytes} B at frame ${n}, after ${W.alpha}'s session closed`); break; }
  }
  return out;
}

describe(`${ID} two writers' documents share a texture and a mesh by content key`, () => {
  it(`${ID} the pair is allocated once and counted in full against both writers, before and after alpha closes; bravo's next 120 frames match its run alone; the device frees the pair only once both have closed`, () => {
    requireMetal();
    const live = pairRun(false);
    expect(live.sessions.map((s) => `${s.session}: ${s.state}`), 'both sessions opened and closed').toEqual(['s-alpha: closed', 's-bravo: closed']);
    const pair = sharedPair(live);
    expect(pair.keys.length, `the two documents' texture and mesh are the same results by content key: shared keys ${JSON.stringify(pair.keys)}`).toBeGreaterThanOrEqual(2);
    expect(pair.bytes, 'the shared results hold the texture with all its mips and the mesh').toBeGreaterThanOrEqual(TEXTURE_MIN + MESH_MIN);
    expect(holdProblems(live, pair), 'each writer\'s count holds both in full, before and after the other closes').toEqual([]);
    const before = live.device_before;
    expect(typeof before, 'the device\'s allocated size before the call is measured').toBe('number');
    const dev = (n: number): number => {
      const d = at(live, n).device_bytes;
      expect(typeof d, `frame ${n}: the device's allocated size is measured`).toBe('number');
      return d as number;
    };
    expect(dev(60) - (before as number), 'the pair is on the device').toBeGreaterThanOrEqual(pair.bytes);
    expect(dev(60) - (before as number), `allocated once: the device holds less than one and a half pairs (${(pair.bytes / MB).toFixed(1)} MB each)`).toBeLessThan(1.5 * pair.bytes);
    for (let n = 61; n <= 180; n++) expect(dev(n) - (before as number), `frame ${n}: after alpha closed, the pair stays on the device`).toBeGreaterThanOrEqual(pair.bytes);
    const alphaOwn = held(at(live, 60), W.alpha).count_bytes - pair.bytes;
    expect(Math.abs(dev(60) - dev(61) - alphaOwn), `alpha's close frees only what alpha alone held (${alphaOwn} B), not the pair, within 2 MiB`).toBeLessThanOrEqual(2 * MIB);
    const bravoAll = held(at(live, 180), W.bravo).count_bytes;
    expect(dev(180) - dev(185), 'once both have closed and the queue drained, the device falls by at least the pair').toBeGreaterThanOrEqual(pair.bytes);
    expect(Math.abs(dev(180) - dev(185) - bravoAll), `and by bravo's whole count (${bravoAll} B), within 2 MiB`).toBeLessThanOrEqual(2 * MIB);

    const alone = pairRun(true);
    for (let n = 61; n <= 180; n++) {
      const shared = viewOf(at(live, n), 's-bravo').pixel_hash;
      expect(typeof shared === 'string' && shared.length === 64, `frame ${n}: bravo's view has a pixel hash`).toBe(true);
      expect(shared, `frame ${n}: bravo's pixels equal its run alone`).toBe(viewOf(at(alone, n), 's-bravo').pixel_hash);
    }
  }, 1_800_000);

  it(`${ID} a planted cache that charges a shared result to its first holder alone changes bravo's count when alpha closes, and fails naming the writer`, () => {
    requireMetal();
    const live = pairRun(false, 'charges_first_holder');
    const problems = holdProblems(live, sharedPair(live));
    expect(problems.length, 'the planted cache fails the count check').toBeGreaterThan(0);
    expect(problems.join('\n'), 'naming bravo, the writer whose count moved or fell short').toContain(`writer ${W.bravo}`);
  }, 1_800_000);
});

describe(`${ID} 200 cycles of open, refuse, supersede, fail an asset and close leave nothing behind`, () => {
  const CYCLES = 200;
  const PER = 5;
  function cycles(planted?: Planted): Live {
    const dir = out();
    const bad = join(dir, 'bad-asset.bin');
    writeFileSync(bad, Buffer.alloc(240_000, 7));
    const assets: Record<string, string> = {};
    const events: LiveEvent[] = [];
    const docFor = (name: string, items: Record<string, JsonObject>): string => writeDoc(dir, name, sceneDoc({ title: `Cycle doc ${name}`, class: 'work_product', size: [128, 128], boxes: 1, items }));
    for (let c = 1; c <= CYCLES; c++) {
      const f0 = (c - 1) * PER + 1;
      const session = `s-cycle-${c}`;
      const asset = sha256(`asset named by cycle ${c}`);
      assets[asset] = bad;
      const refusedDoc = sceneDoc({ title: `Refused ${c}`, class: 'work_product', size: [128, 128], boxes: 1, items: { shape: mesh('shape', 20_000, `refused-${c}`) } });
      // A payload that names an item's layer is refused by the check (#393: Writer layer, "never in a payload").
      ((refusedDoc['items'] as JsonObject)['box-0'] as JsonObject)['layer'] = 'not-yours';
      const open = docFor(`open-${c}`, { shape: mesh('shape', 20_000, `cycle-${c}`) });
      events.push(
        { frame: f0, open: { session, writer: W.test, doc: open } },
        { frame: f0 + 1, revise: { session, doc: writeDoc(dir, `refused-${c}`, refusedDoc) } },
        { frame: f0 + 2, revise: { session, doc: docFor(`superseded-${c}`, { shape: mesh('shape', 20_000, `superseded-${c}`) }) } },
        { frame: f0 + 2, revise: { session, doc: docFor(`asset-${c}`, { shape: mesh('shape', 20_000, `asset-${c}`, asset) }) } },
        { frame: f0 + 3, close: session },
      );
    }
    return liveReply(one(builds.bin('test-meter'), dir, liveCall({ frames: CYCLES * PER, sessions: [], events, report: ['memory'], assets }), planted ? { planted } : {}));
  }
  const end = (live: Live, c: number): Frame => at(live, c * PER);

  /** The cycles whose end state differs from cycle 10's: the first one named. */
  function cycleProblems(live: Live): string[] {
    const ten = end(live, 10);
    for (let c = 11; c <= CYCLES; c++) {
      const e = end(live, c);
      if (e.cache?.entries !== ten.cache?.entries || e.cache?.bytes !== ten.cache?.bytes) {
        return [`cycle ${c}: the core's cache holds ${e.cache?.entries} entries and ${e.cache?.bytes} B after it, against ${ten.cache?.entries} entries and ${ten.cache?.bytes} B after cycle 10`];
      }
    }
    return [];
  }

  it(`${ID} after cycle 200 the core's cache entries and byte count equal those after cycle 10, and the device's allocated size is within 2 MiB of its cycle-10 value`, () => {
    requireMetal();
    const live = cycles();
    expect(live.frames.length, `${CYCLES * PER} frames`).toBe(CYCLES * PER);
    for (const c of [1, 10, 100, 200]) {
      const row = live.sessions.find((s) => s.session === `s-cycle-${c}`);
      expect(row?.revisions.map((r) => r.outcome), `cycle ${c}: the open revision is current, then one refused, one superseded and one whose asset failed`).toEqual(['current', 'refused', 'superseded', expect.stringMatching(/^(refused|failed)$/)]);
      const opened = at(live, (c - 1) * PER + 1);
      expect(held(opened, W.test).count_bytes, `cycle ${c}: while open, the writer's count holds its 20,000-vertex mesh`).toBeGreaterThanOrEqual(20_000 * 12);
      expect(opened.cache?.entries ?? 0, `cycle ${c}: while open, the cache holds the mesh`).toBeGreaterThanOrEqual(1);
    }
    expect(cycleProblems(live), 'every cycle ends with the cache as cycle 10 left it').toEqual([]);
    const d10 = end(live, 10).device_bytes;
    const d200 = end(live, 200).device_bytes;
    expect(typeof d10 === 'number' && typeof d200 === 'number', 'the device\'s allocated size is measured after cycles 10 and 200').toBe(true);
    expect(Math.abs((d200 as number) - (d10 as number)), `the device after cycle 200 is within 2 MiB of cycle 10 (${d10} B, ${d200} B)`).toBeLessThanOrEqual(2 * MIB);
  }, 3_600_000);

  it(`${ID} a planted cache that keeps results no current revision reads grows each cycle and fails, naming the cycle`, () => {
    requireMetal();
    const live = cycles('keeps_unread_results');
    const problems = cycleProblems(live);
    expect(problems.length, 'the planted cache fails the cycle check').toBeGreaterThan(0);
    expect(problems[0], 'naming the first cycle after 10').toMatch(/^cycle 11: /);
    const grew = ((end(live, 200).cache?.bytes ?? 0) - (end(live, 10).cache?.bytes ?? 0)) / 190;
    console.log(`keeps_unread_results grows ${(grew / MB).toFixed(2)} MB a cycle`);
    expect(grew, 'it grows by a mesh each cycle (at least 20,000 vertices of 12 B)').toBeGreaterThanOrEqual(20_000 * 12);
  }, 3_600_000);
});
