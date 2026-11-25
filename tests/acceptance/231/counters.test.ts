// AC10 #231.77030cf3: "On the city fixture exported as a draft, its frames handed over as GPU surfaces, the export's
// work counters record no frame read back and one 32-byte digest read back per frame, 3,600 in all; a planted export
// that reads each frame back and hashes it on the CPU gives the same frame hashes and fails, naming the readback
// count"
//
// Through `deep-show run`'s `export` with `purpose: "draft"` in the `full,test-encode-tools` build, whose test tool
// `test-frames@1.0.0` (the encode job's suite's) takes each frame as a slot of the export's ring of GPU surfaces and
// writes a PNG sequence; the export's brief pins it. The city (helpers.ts `speedFilm`: 60 s at 1080p60, 3,600 frames,
// each different) is exported whole once: the receipt's `handoff` must read `surface`, and the reply's `work` must
// count 3,600 draws, 3,600 hashes, no frame read back and 3,600 digests of 32 bytes. The tool's own report, the hash
// of each slot as it read it, must be the receipt's frame hashes, so the surfaces held the frames. The planted twin
// runs the same check on the city's first 2 s (120 frames), beside the shipped build on the same range, whose hashes
// it must give. The kit's second law is read from a kit run. Counts hold on any machine; the legs read BLOCKED where
// no tool takes GPU surfaces. Wrong programs: the merge base (it reads every frame back, and its reply holds no
// `work`); `export_hashes_on_cpu`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, BY_SURFACE, DOC, DRAFT, FLICKS, SET, SURFACE_TOOL, TOOLS, blocked, countFailures, countedOf, exportCall, failsNaming, handoffOf, hexes, kitLaws, lawOf, none, obj,
  present, presented, readbackFailures, receiptOf, repeats, runShow, scenario, speedFilm, useShow, useTemp, type JsonObject, type Planted, type Work,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();

function needsSurfaces(): void {
  if (process.platform !== 'darwin') blocked(`the one encode tool that takes GPU surfaces, ${SURFACE_TOOL}, is macOS's, and this is ${process.platform}`);
}
/** The city as a draft through the tool that takes GPU surfaces, whole or over `range`: its hashes, its counters and
 * the frames the tool reports it took. */
function cityBySurface(what: string, o: { range?: [number, number]; planted?: Planted } = {}): { hashes: string[]; work: Work; frames: number; reused: number; taken: string[] } {
  const evidence = temp(); const dir = temp();
  const call = exportCall(DOC.a, join(dir, 'city'), { ...DRAFT, ...BY_SURFACE, ...(o.range ? { range: o.range } : {}) });
  const [shown, reply] = runShow(show(TOOLS), scenario(evidence, [present(DOC.a, speedFilm(evidence, 'city').document), call], o.planted ? { planted: o.planted } : {}), what);
  presented(shown, 'the city');
  const r = receiptOf(reply, what);
  if (handoffOf(r, what) !== 'surface') blocked(`${what}: the receipt's handoff reads copy, so its frames weren't handed over as GPU surfaces on this machine`);
  const taken = hexes(obj(obj(r.raw['encoder'], `${what}: receipt.encoder`)['report'], `${what}: receipt.encoder.report`)['frames'], `${what}: receipt.encoder.report.frames`);
  return { ...countedOf(reply as JsonObject, what), taken };
}

describe(`${AC[10]} a frame handed over as a GPU surface is never read back, only its digest`, () => {
  it(`${AC[10]} the city as a draft, its 3,600 frames handed over as GPU surfaces, counts no frame read back and 3,600 digests of 32 bytes`, () => {
    needsSurfaces();
    const what = 'the city, a draft handed over as GPU surfaces';
    const c = cityBySurface(what);
    none([...countFailures(what, c, { frames: SET.city.frames, draws: SET.city.draws, purpose: 'draft' }), ...readbackFailures(what, c.work, 3600)], what);
    // Not vacuous: the city moves every frame, and the slots held the frames the receipt hashes.
    expect(repeats(c.hashes), `${what}: no frame of the city is its predecessor's picture`).toBe(0);
    expect(c.taken.length, `${what}: the tool took every frame`).toBe(3600);
    expect(c.taken.findIndex((h, k) => h !== c.hashes[k]), `${what}: each slot, as the tool read it, hashes to its frame's hash (the first that doesn't, or -1)`).toBe(-1);
  });

  it(`${AC[10]} a planted export that reads each frame back and hashes it on the CPU gives the same frame hashes and fails, naming the readback count`, () => {
    needsSurfaces();
    const range: [number, number] = [0, 2 * FLICKS];
    const clean = cityBySurface('the city\'s first 2 s, a draft handed over as GPU surfaces', { range });
    none([...countFailures('the city\'s first 2 s', clean, { frames: 120, draws: 120, purpose: 'draft' }), ...readbackFailures('the city\'s first 2 s', clean.work, 120)], 'the city\'s first 2 s on the shipped export');
    const what = 'the city\'s first 2 s (planted export_hashes_on_cpu)';
    const wrong = cityBySurface(what, { range, planted: 'export_hashes_on_cpu' });
    expect(new Set(clean.hashes).size, 'the 120 frames differ, so equal hashes say something').toBe(120);
    expect(wrong.hashes, 'hashing each frame on the CPU gives the same frame hashes').toEqual(clean.hashes);
    failsNaming(readbackFailures(what, wrong.work, 120), /work\.frames_read_back is 120, not 0/, 'an export that reads each frame back');
  });

  it(`${AC[10]} the export module's kit states the law by the export's work counters, and fails it on the planted export, naming the readback count`, () => {
    needsSurfaces();
    const law = lawOf(kitLaws(show(TOOLS), temp()), 'surface_digest_only');
    if (law.verdict === 'BLOCKED') blocked(`the kit's surface_digest_only law can't make its probe here: ${JSON.stringify(law.raw).slice(0, 400)}`);
    expect(law.verdict, `the kit's surface_digest_only law: ${JSON.stringify(law.raw).slice(0, 600)}`).toBe('PASS');
    const frames = law.counted['frames'];
    expect(typeof frames === 'number' && frames >= 2, `the law counted an export of two frames or more: ${JSON.stringify(law.counted)}`).toBe(true);
    expect(law.counted, 'the law counted no frame read back and one 32-byte digest a frame').toEqual({ frames, frames_read_back: 0, digests_read_back: frames, digest_bytes_read_back: 32 * (frames as number) });
    const planted = lawOf(kitLaws(show(TOOLS), temp(), 'export_hashes_on_cpu'), 'surface_digest_only');
    expect(planted.verdict, `the kit fails the law on an export that reads each frame back: ${JSON.stringify(planted.raw).slice(0, 600)}`).toBe('FAIL');
    expect(JSON.stringify(planted.raw['failure'] ?? null), 'the kit\'s failure names the readback count').toContain('frames_read_back');
  });
});
