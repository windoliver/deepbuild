// AC3 #1297.a04bad6a: Any golden, taste or pixel hash that moves in #422, #424 or #425 is reported. #425's `TASTE.json`
// is left for its owner to re-record.
//
// The hashes: every picture #422, #424 and #425 hold by hash, 19 in all (README: The hashes). #422's four castle
// goldens (`tests/goldens/422/castle-t<k>`, judged by the pixel-hash oracle), and the taste pictures each taste test
// draws: #422's seven and #425's four, recorded by hash in their `TASTE.json`, and #424's four, whose taste call isn't
// recorded, so their hash is that of the pictures in `docs/evidence/424/`. Each one's recorded hash is the base's.
// A hash moves when the program under test, on one machine, draws that picture other than its recorded hash.
//
// No surface the issue or the design names says where a moved hash is reported, so this suite names one (README: The
// report): `docs/evidence/1297/moved-hashes.json`, the GPU layer's fingerprint it was drawn under, and for each of the
// 19 its recorded hash, the hash the change draws, and whether it moved. The test reads it, then draws each picture
// itself, with the calls the owning suite's test makes (its own helpers, imported), and holds the report to them:
// every hash listed, the base's recorded hash, `moved` exactly when drawn and recorded differ, and, on a machine of the
// report's fingerprint, the drawn hash this program draws there. On another fingerprint what this program draws there
// says nothing about the report's machine, so the run is INCONCLUSIVE, never PASS. Whatever the report says, it prints
// what this program draws here as the report's body for this machine.
// #425's TASTE.json must keep the base's bytes: its owner re-records it.
// Wrong programs: a report that leaves out a moved hash or calls it unmoved (the twin `unreported-move`); a renderer
// that draws other pixels than the report says (the twin `normal-offset`); a report with another recorded hash, or with
// no report at all; #425's TASTE.json re-recorded by the change.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as g422 from '../422/helpers.ts';
import * as g424 from '../424/helpers.ts';
import * as g425 from '../425/helpers.ts';
import { bandDoc, levelDoc } from '../425/redraft/helpers.ts';
import { AC3, REPO, SHA, inconclusive, none, requireMetal, sha256, unchanged } from './helpers.ts';

const bin = g425.useBuilds(['default', 'test-meter']);
const made: string[] = [];
/** A temporary folder of the test's own, deleted after the file. */
const scratch = (): string => { const d = mkdtempSync(join(tmpdir(), 'deep-1297-')); made.push(d); return d; };
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

/** Each picture's hash as recorded at the base ed28a8dce. */
const RECORDED: Record<string, string> = {
  '422/golden/castle-t0': '5268e5c1d1c1813b44e125fdfff5dc933da618a93284fc785e40af8a1367479c',
  '422/golden/castle-t1': '88da4bfa3c147d3017be6feabd0d69d6a8f510c50df5bc069bedd1e52765feaf',
  '422/golden/castle-t2': '5f156d9632cf4569263fba174efd893696eabb0b6b5b987ffab59883e147da5a',
  '422/golden/castle-t3': '8ab6c4c982e8582a2584ae8b2849d5d4f0e51843494c887e74793dcdaa20d2f9',
  '422/taste/castle-t0.png': '0450b7d4af9aa25b28f8b398ce40931a5a867d3ba0097b6d2d091cc4615c442f',
  '422/taste/castle-t1.png': '319b10fcbb6c55d4ac839454d5f86e72d2f9a323fe7de44b3130f75ebcef52e9',
  '422/taste/castle-t2.png': '2224e30726ced132994e16b7889107d211473423c94bd4adf80bc560c772b90b',
  '422/taste/castle-t3.png': '7b653b2f1a471bf9513639fe80ef4bc1a2601e18a230f24e279da8e0327fd2f6',
  '422/taste/furnace-metal.png': '937f2e8d98eb067418488832af235f858f012d3f3c52b6ed70f55ff612a670c2',
  '422/taste/sunlit-metal.png': 'bdde86802a4e7d9eb8ef8421c2e845587924c810a189da47b159748113d37b99',
  '422/taste/castle-orbit.apng': '1190faf9e6ba5c8516da0f8cf7730e87008b865579b66bf9f2e328f668c1b2a7',
  '424/taste/engine-block.png': 'dd69dd9c050e9bb2e1d3c68cf7525b391bce9f4e11c3c857b3c2ca533c1b68f8',
  '424/taste/cutaway-shells.png': '3c5bc1a2da5e05d5f74ef473617f2b424135b5b650e066d21f29b307c0d153d8',
  '424/taste/cutaway-section.png': 'd1d8d79d6b52929c93a00847e579bd7cd067fd1f6b17e7c78550382e15d7d8ed',
  '424/taste/additive-beams.png': 'd89d318182c0b127da110b25f331b6cd6ad92cfafd17a6c2ac9c859466a9b3f3',
  '425/taste/mesh-levels.png': '685596966d656712f365fa4b88cf978df19a7ec2d6edd30c2ed5b4cce139b6a1',
  '425/taste/band-blend.png': 'b00eccfb00a773eb37d4c101b646ec9394aa470588fd2ea3426ab09de76c8494',
  '425/taste/ladder-climb.png': '6fba2461e57a5777cdc4d918127b8d4de1f758b91a7f333703cad83dec828423',
  '425/taste/orbit-zoom.apng': '230a111f2a07a4b4e0b99805c8c136b69b609b8e807f068f5dfccb4fceb413fa',
};
const KEYS = Object.keys(RECORDED).sort();
const TASTE_425 = { 'tests/acceptance/425/TASTE.json': 'e4933d3e5c80434003f9c2075d3755410a8324cca517e22b6842f8b0f7fafacc' };
const REPORT = 'docs/evidence/1297/moved-hashes.json';
const FINGERPRINT = ['os', 'gpu', 'driver', 'wgpu'] as const;
type Fingerprint = Record<(typeof FINGERPRINT)[number], string>;
interface Entry { recorded: string; drawn: string; moved: boolean }
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The report as the README shapes it, and what is wrong with it. */
function readReport(): { fingerprint: Fingerprint | null; entries: Map<string, Entry>; problems: string[] } {
  const entries = new Map<string, Entry>(); const problems: string[] = [];
  const file = join(REPO, REPORT);
  if (!existsSync(file)) return { fingerprint: null, entries, problems: [`${REPORT} is missing: no hash is reported (README: The report)`] };
  let r: unknown;
  try { r = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return { fingerprint: null, entries, problems: [`${REPORT} is not JSON: ${(e as Error).message}`] }; }
  if (!isObject(r)) return { fingerprint: null, entries, problems: [`${REPORT} is not an object`] };
  if (r['issue'] !== 1297) problems.push(`${REPORT}: issue is ${JSON.stringify(r['issue'])}, not 1297`);
  if (r['criterion'] !== '#1297.a04bad6a') problems.push(`${REPORT}: criterion is ${JSON.stringify(r['criterion'])}, not #1297.a04bad6a`);
  const fp = r['fingerprint'];
  const fingerprint = isObject(fp) && FINGERPRINT.every((k) => typeof fp[k] === 'string') ? (Object.fromEntries(FINGERPRINT.map((k) => [k, fp[k] as string])) as Fingerprint) : null;
  if (!fingerprint) problems.push(`${REPORT}: fingerprint is not the GPU layer's os, gpu, driver and wgpu it drew under: ${JSON.stringify(fp)}`);
  const hashes = r['hashes'];
  if (!isObject(hashes)) return { fingerprint, entries, problems: [...problems, `${REPORT}: hashes is not an object of the 19 hashes`] };
  const listed = Object.keys(hashes).sort();
  const left = KEYS.filter((k) => !listed.includes(k));
  if (listed.join() !== KEYS.join()) problems.push(`${REPORT} lists ${listed.join(', ') || 'no hash'}; it must list exactly ${KEYS.join(', ')} (left out: ${left.join(', ') || 'none'})`);
  for (const k of KEYS) {
    const e = hashes[k];
    if (!isObject(e)) continue;
    if (e['recorded'] !== RECORDED[k]) problems.push(`${REPORT}: the recorded hash of ${k} is ${JSON.stringify(e['recorded'])}; the base records ${RECORDED[k]}`);
    if (typeof e['drawn'] !== 'string' || !SHA.test(e['drawn'])) { problems.push(`${REPORT}: the drawn hash of ${k} is not a SHA-256: ${JSON.stringify(e['drawn'])}`); continue; }
    if (typeof e['moved'] !== 'boolean') { problems.push(`${REPORT}: moved for ${k} is not true or false`); continue; }
    if (e['moved'] !== (e['drawn'] !== RECORDED[k])) problems.push(`${REPORT}: ${k} says moved ${e['moved']}, but says it draws ${e['drawn']} against the recorded ${RECORDED[k]}`);
    entries.set(k, { recorded: RECORDED[k]!, drawn: e['drawn'], moved: e['moved'] });
  }
  return { fingerprint, entries, problems };
}

/** This run's fingerprint, as the GPU layer's golden call gives it (a call with no snapshot, which reads nothing). */
function fingerprintHere(b: string): Fingerprint {
  const out = scratch();
  const [r] = g422.runGpu(b, out, [{ call: 'golden', store: out, fixture: 'fingerprint-1297', png: join(out, 'none.png'), oracle: 'hash' }]);
  const fp = r!['fingerprint'];
  if (!isObject(fp) || !FINGERPRINT.every((k) => typeof fp[k] === 'string')) inconclusive(`the GPU layer gives no fingerprint here, so it draws on no GPU: ${JSON.stringify(r)}`);
  return Object.fromEntries(FINGERPRINT.map((k) => [k, fp[k] as string])) as Fingerprint;
}

/** #422's castle at its four sampled times (its goldens and taste shots), its orbit, and the metal balls, as its tests draw them. */
function draw422(b: string): Record<string, string> {
  const out = scratch(); const hashes: Record<string, string> = {};
  const c = g422.castle();
  const last = Math.max(...c.samples.map((s) => s.frame));
  const recFps = 10; const recFrames = c.seconds * recFps;
  const [shots, rec] = g422.runGpu(b, out, [
    g422.view3dCall({ doc: c.doc, look: c.look, size: c.size, frames: last + 1, fps: g422.CASTLE_FPS, capture: c.samples.map((s) => s.frame), targets: ['final'], packs: g422.CASTLE_PACKS }),
    g422.view3dCall({ doc: c.doc, look: c.look, size: [640, 400], frames: recFrames, fps: recFps, capture: 'every', targets: ['final'], packs: g422.CASTLE_PACKS }),
  ]);
  const castleFrames = g422.framesOf(shots!, 'the castle');
  for (const s of c.samples) {
    const f = g422.frameAt(castleFrames, s.frame, `the castle at ${s.t}`);
    const h = sha256(g422.readNamed(out, f.final, 'png', `the castle at ${s.t}`));
    hashes[`422/golden/castle-t${s.k}`] = h;
    hashes[`422/taste/castle-t${s.k}.png`] = h;
  }
  const orbit = g422.framesOf(rec!, 'the orbit of the castle');
  expect(orbit.length, `the recording holds the whole orbit: ${recFrames} frames`).toBe(recFrames);
  hashes['422/taste/castle-orbit.apng'] = sha256(g422.encodeApng(orbit.map((f) => g422.readPng(out, f.final, `orbit frame ${f.frame}`)), recFps));
  const params = (r: number) => ({ base_color: [1, 1, 1, 1], metallic: 1, roughness: r });
  const id = (r: number): string => `metal_r${String(Math.round(r * 100)).padStart(3, '0')}`;
  const rough = [0, 0.5, 1];
  const furnace = g422.drawSpheres(b, out, rough.map((r) => g422.sphereDoc(`shot-furnace-${id(r)}`, id(r), params(r), g422.FURNACE_SKY, null)));
  const sunlit = g422.drawSpheres(b, out, rough.map((r) => g422.sphereDoc(`shot-sun-${id(r)}`, id(r), params(r), g422.DARK_SKY, g422.sun(1, [0, 0, 0]))));
  hashes['422/taste/furnace-metal.png'] = sha256(g422.encodePng(g422.sideBySide(furnace.map((d) => d.final))));
  hashes['422/taste/sunlit-metal.png'] = sha256(g422.encodePng(g422.sideBySide(sunlit.map((d) => d.final))));
  return hashes;
}

/** #424's four taste pictures, as its taste test draws them. */
function draw424(b: string): Record<string, string> {
  const out = scratch();
  const names = ['engine-block.png', 'cutaway-shells.png', 'cutaway-section.png', 'additive-beams.png'];
  const replies = g424.runGpu(b, out, [
    g424.view3dCall({ doc: g424.writeJson(out, 'engine', g424.engineDoc('shown', 0.3)), size: g424.ENGINE_SIZE, targets: ['final'] }),
    g424.view3dCall({ doc: g424.writeJson(out, 'shells', g424.shellsDoc(0)), size: g424.SHELLS_SIZE, targets: ['final'], cutaway: g424.SHELLS_CUT }),
    g424.view3dCall({ doc: g424.writeJson(out, 'section', g424.sectionDoc()), size: g424.SECTION_SIZE, targets: ['final'], cutaway: g424.sectionCut(0) }),
    g424.view3dCall({ doc: g424.writeJson(out, 'beams', g424.beamsDoc(0, { beams: 'add', wall: false })), size: g424.BEAMS_SIZE, targets: ['final'] }),
  ]);
  return Object.fromEntries(names.map((name, i) => [`424/taste/${name}`, sha256(g424.readNamed(out, g424.only(replies[i]!, name).final, 'png', name))]));
}

/** #425's four taste pictures, as its redrafted taste test draws them. */
function draw425(b: string, meter: string): Record<string, string> {
  const out = scratch(); const hashes: Record<string, string> = {};
  const final = (f: g425.Frame3, what: string): g425.Image => g425.decodePng(g425.readNamed(out, f.final, 'png', what));

  const asset = join(out, 'rock.gltf');
  writeFileSync(asset, g425.rockGltf());
  const [j] = g425.runGpu(b, out, [{ call: 'simplify', asset, node: 0, levels: 'auto' }]);
  const rock = g425.simplifiedOf(j!, out, 'the simplify job');
  const levelsDoc = g425.writeJson(out, 'levels', levelDoc(rock.sha));
  const [l] = g425.runGpu(b, out, [g425.view3dCall({ doc: levelsDoc, look: g425.LOOK, size: g425.BAND_SIZE, frames: g425.LEVEL_SWEEP.leg + 1, capture: 'every', targets: ['final'], lod: true, assets: { [rock.sha]: rock.path } })]);
  const firsts = new Map<number, g425.Frame3>();
  for (const f of g425.framesOf(l!, 'the level sweep')) {
    const level = f.lod?.find((r) => r.item === 'rock')?.level;
    if (typeof level === 'number' && !firsts.has(level)) firsts.set(level, f);
  }
  expect(firsts.size, 'the level sweep draws more than one level').toBeGreaterThan(1);
  const levels = [...firsts.entries()].sort((x, y) => x[0] - y[0]).map(([k, f]) => final(f, `level ${k}`));
  hashes['425/taste/mesh-levels.png'] = sha256(g425.encodePng(g425.sideBySide(levels)));

  const bands = g425.writeJson(out, 'bands', bandDoc());
  const [bs] = g425.runGpu(b, out, [g425.view3dCall({ doc: bands, look: g425.LOOK, size: g425.BAND_SIZE, frames: g425.BAND_SWEEP.leg + 1, capture: 'every', targets: ['final'], lod: true })]);
  const sweep = g425.framesOf(bs!, 'the band sweep');
  const blend = (f: g425.Frame3) => f.lod?.find((r) => r.item === 'ball')?.blend ?? null;
  const margin = sweep.filter((f) => blend(f) !== null);
  expect(margin.length, 'the band sweep has a margin frame').toBeGreaterThan(0);
  const mid = margin.reduce((a, f) => (Math.abs(blend(f)!.level / blend(f)!.of - 0.5) < Math.abs(blend(a)!.level / blend(a)!.of - 0.5) ? f : a));
  const before = g425.frameAt(sweep, Math.max(0, margin[0]!.frame - 1), 'the band sweep');
  const after = g425.frameAt(sweep, Math.min(g425.BAND_SWEEP.leg, margin.at(-1)!.frame + 1), 'the band sweep');
  hashes['425/taste/band-blend.png'] = sha256(g425.encodePng(g425.sideBySide([before, mid, after].map((f) => final(f, `band sweep frame ${f.frame}`)))));

  const show = g425.writeJson(out, 'showpiece', g425.showpiece(true));
  const [c] = g425.runGpu(meter, out, [g425.liveCall({ doc: show, frames: 140, charges: [{ from: 1, gpu_ms: 5 }], capture: [100, 140] })]);
  const climb = g425.liveOf(c!, 'the climbing live view');
  const views = [100, 140].map((n) => g425.decodePng(g425.readNamed(out, climb.views.find((x) => x.frame === n)?.final ?? null, 'png', `the live view at frame ${n}`)));
  hashes['425/taste/ladder-climb.png'] = sha256(g425.encodePng(g425.sideBySide(views)));

  const recFps = 24;
  const items = g425.bandItems();
  items['cam'] = { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 0, elevation: 14, distance: 6 }, fov: 40, near: 0.1, far: 200 } };
  const turn = { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '4s', value: 180, interp: 'linear' } } };
  const zoom = { target: 'items/cam/params/orbit/distance', type: 'f32', keys: { k0: { t: '0s', value: 6, interp: 'linear' }, k1: { t: '2s', value: 30, interp: 'linear' }, k2: { t: '4s', value: 6, interp: 'linear' } } };
  const orbitDoc = g425.writeJson(out, 'orbit', g425.sessionDoc('orbit-425', g425.BAND_SIZE, items, { channels: { turn, zoom } }));
  const [o] = g425.runGpu(b, out, [{ ...g425.view3dCall({ doc: orbitDoc, look: g425.LOOK, size: g425.BAND_SIZE, frames: 4 * recFps + 1, capture: 'every', targets: ['final'] }), fps: recFps }]);
  const rec = g425.framesOf(o!, 'the orbit and zoom');
  hashes['425/taste/orbit-zoom.apng'] = sha256(g425.encodeApng(rec.map((f) => final(f, `orbit frame ${f.frame}`)), recFps));
  return hashes;
}

describe(`${AC3} a golden, taste or pixel hash that moves in #422, #424 or #425 is reported, and the TASTE.json of #425 is left for its owner`, () => {
  it(`${AC3} the report lists all 19 hashes with the base's recorded hash and the hash this program draws on the report's machine, moved exactly where the two differ; the TASTE.json of #425 keeps the base's bytes`, () => {
    requireMetal();
    const problems = unchanged(TASTE_425).map((p) => `the TASTE.json of #425 is for its owner to re-record, but ${p}`);
    const report = readReport();
    problems.push(...report.problems);
    const here = fingerprintHere(bin('default'));
    const same = report.fingerprint !== null && FINGERPRINT.every((k) => report.fingerprint![k] === here[k]);
    if (report.problems.length === 0 && !same) {
      none(problems, `${AC3}: the TASTE.json of #425`);
      inconclusive(`the report was drawn under ${JSON.stringify(report.fingerprint)} and this machine is ${JSON.stringify(here)}, so what this program draws here says nothing about it`);
    }
    const drawn: Record<string, string> = { ...draw422(bin('default')), ...draw424(bin('default')), ...draw425(bin('default'), bin('test-meter')) };
    expect(Object.keys(drawn).sort(), 'every one of the 19 pictures is drawn').toEqual(KEYS);
    const off = KEYS.filter((k) => drawn[k] !== RECORDED[k]);
    const body = { issue: 1297, criterion: '#1297.a04bad6a', fingerprint: here, hashes: Object.fromEntries(KEYS.map((k) => [k, { recorded: RECORDED[k], drawn: drawn[k], moved: off.includes(k) }])) };
    console.log(`${AC3}: here this program draws ${off.length} of the 19 off their record; as the report would say it:\n${JSON.stringify(body, null, 2)}`);
    if (report.problems.length === 0) for (const k of KEYS) {
      const e = report.entries.get(k)!;
      if (e.drawn === drawn[k]) continue;
      const moved = off.includes(k);
      const where = moved ? `off its recorded ${RECORDED[k]}` : 'its recorded hash';
      const left = moved && !e.moved ? ', a moved hash left unreported' : '';
      problems.push(`${k}: this program draws ${drawn[k]} on the machine of the report, ${where}, but the report says ${e.drawn} (moved ${e.moved})${left}`);
    }
    none(problems, `${AC3}: the moved hashes reported`);
  }, 3 * 3_600_000);
});
