// The tone maps (Look `look@1`: tone mapping), three criteria.
//
// #418.51b765f4 AgX matches the curve the look defines (a toe and a shoulder meeting at 0.18 with one slope, between
// the AgX inset and outset matrices), computed in f64, within one 10-bit code value at contrast 1.0, 1.25 and 1.5 with
// white 16.29; Neutral matches Khronos's reference within one; and the app ships no LUT file.
// #418.4c61160e Each tone map (none, filmic, AgX, neutral) renders the fixture scene with the status colors still exact.
// #418.052c8008 Each tone curve (none, filmic, AgX, neutral) keeps black at black and neutral greys neutral, never
// decreases, maps [0, white] into [0, 1] and is clamped to 1 above white, checked by an analytic parity fixture.
//
// The curves are read through the new `tone` call, which runs the look's tone map as the frame's tone-mapping pass
// runs it, on the GPU, over an f32 image of inputs, and writes what it gives before the sRGB encode. The references
// are this suite's f64 code (helpers.ts: The tone curves). At the base there is no `tone` call, and `view3d` has no
// status report under a tone map other than #382's.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  AGX, FAIL, FAILED, Lcg, REPO, answered, ev100, film, frameAt, look, nameOf, readF32, readPng, requireGpu, run, srgbEncode, statusExact, statusOf,
  toneRef, useGpuBin, useOut, whiteOf, writeF32, writeJson, type F32, type JsonObject, type Lin, type Rgb, type ToneMap,
} from './helpers.ts';

const gpu = useGpuBin();
const out = useOut();

/** One `tone` call: the tone map applied to every pixel of `input` (no exposure), read back as f32 RGBA. */
function toneCalls(maps: ToneMap[], input: F32): F32[] {
  const path = writeF32(out(), 'input', input);
  const replies = run(gpu.bin(), out(), maps.map((m) => ({ call: 'tone', tone_map: m as JsonObject | string, input: path, size: [input.width, input.height] })));
  return replies.map((r, i) => readF32(out(), answered(r, `tone under ${nameOf(maps[i]!)}`)['output'], [input.width, input.height], `tone under ${nameOf(maps[i]!)}: output`));
}
const at = (img: F32, i: number): Lin => [img.rgba[i * 4]!, img.rgba[i * 4 + 1]!, img.rgba[i * 4 + 2]!];

/** Each channel of `got` against the reference, both sRGB-encoded, in 10-bit code values; the worst, and the first few past one. */
function vsReference(map: ToneMap, input: F32, got: F32): { worst: number; off: string[] } {
  let worst = 0; const off: string[] = [];
  for (let i = 0; i < input.width * input.height; i++) {
    const want = toneRef(map, at(input, i)); const have = at(got, i);
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(srgbEncode(have[c]!) - srgbEncode(want[c]!)) * 1023;
      worst = Math.max(worst, d);
      if (d > 1 && off.length < 5) off.push(`input [${at(input, i).map((v) => v.toPrecision(5))}] channel ${c}: ${have[c]!.toPrecision(6)} where ${nameOf(map)} gives ${want[c]!.toPrecision(6)} (${d.toFixed(2)} codes)`);
    }
  }
  return { worst, off };
}

/** Tracked files that are LUTs by extension, or name a LUT, outside tests and docs. */
const LUT = /\.(cube|3dl|lut|clf|ctf|csp|spi1d|spi3d|spimtx|vf|mga|m3d)$|(^|[/_.-])(lut|luts|tony[_-]?mc[_-]?mapface)([/_.-]|$)/i;
const luts = (files: string[]): string[] => files.filter((f) => !/^(tests|docs)\//.test(f) && LUT.test(f));

describe('#418.51b765f4 AgX and Neutral match their analytic curves, with no LUT', () => {
  it('#418.51b765f4 AgX at contrast 1.0, 1.25 and 1.5 with white 16.29 and Neutral each land within one 10-bit code value of this suite\'s f64 curve, and no LUT file is tracked', () => {
    requireGpu();
    // 512 greys from 0 to twice the white, dense in the darks, then 1,536 seeded colors up to 16 per channel.
    const input: F32 = { width: 256, height: 8, rgba: new Float32Array(256 * 8 * 4) };
    const rng = new Lcg(418);
    for (let i = 0; i < 256 * 8; i++) {
      const c = i < 512 ? Array(3).fill(2 * 16.29 * (i / 511) ** 3) : [0, 0, 0].map(() => 16 * rng.next() ** 3);
      input.rgba.set([c[0]!, c[1]!, c[2]!, 1], i * 4);
    }
    const maps: ToneMap[] = [AGX(1.0), AGX(1.25), AGX(1.5), 'neutral'];
    const got = toneCalls(maps, input);
    for (const [k, m] of maps.entries()) {
      const r = vsReference(m, input, got[k]!);
      expect(r.off, `${nameOf(m)} is within one 10-bit code value of its curve (worst ${r.worst.toFixed(3)})`).toEqual([]);
    }
    // The twin: the contrast-1.0 output misses the contrast-1.25 curve, so the comparison sees the contrast.
    expect(vsReference(AGX(1.25), input, got[0]!).worst, 'AgX at contrast 1.0 misses the 1.25 curve by more than one code value').toBeGreaterThan(1);

    const files = spawnSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).stdout.split('\n').filter(Boolean);
    expect(files.length, 'git ls-files lists the checkout').toBeGreaterThan(100);
    expect(luts(files), 'the app ships no LUT file').toEqual([]);
    expect(luts(['crates/deep-scene3d-render/src/agx.cube', 'crates/x/assets/tony_mc_mapface.dds']).length, 'the twin: the LUT scan finds a planted .cube and a named LUT').toBe(2);
  }, 1_800_000);
});

describe('#418.4c61160e every tone map keeps status colors exact', () => {
  it('#418.4c61160e under none, filmic, AgX and neutral, 2 stops over, the film\'s fail mark and legend draw the fail color exactly, while the scene itself draws differently under each', () => {
    requireGpu();
    const roles: Record<string, Rgb> = { lamp: [217, 164, 65], block: [184, 188, 196], crate: [127, 167, 201], floor: [42, 45, 51] };
    const doc = writeJson(out(), 'film.json', film('film-tone-418', { binding: true }));
    const maps: ToneMap[] = ['none', 'filmic', AGX(), 'neutral'];
    const replies = run(gpu.bin(), out(), maps.map((m) => ({ call: 'view3d', doc, look: look('tone-418', roles, { tone_map: m as JsonObject | string, exposure: ev100(4) }), size: [480, 360], states: FAILED, targets: ['final'], capture: [0] })));
    const hashes = new Set<string>();
    for (const [i, m] of maps.entries()) {
      const what = `the film under ${nameOf(m)}`;
      const reply = answered(replies[i]!, what);
      const f = frameAt(reply, 0, what);
      hashes.add(f.pixel_hash);
      expect(statusExact(statusOf(reply, what), readPng(out(), f, 'final', what), FAIL, what)).toEqual([]);
    }
    expect(hashes.size, 'each tone map draws the scene differently (four pixel hashes), so each was applied').toBe(4);
  }, 1_800_000);
});

/** The criterion's properties of one curve over a grey ramp `ramp` (ascending, from 0) and greys at or above white `above`. */
function properties(name: string, white: number, clampTol: number, ramp: { x: number; y: Lin }[], above: { x: number; y: Lin }[]): string[] {
  const p: string[] = [];
  const first = ramp[0]!;
  if (first.x !== 0 || first.y.some((v) => v !== 0)) p.push(`${name}: black ${first.x} maps to [${first.y}], not black`);
  for (const s of [...ramp, ...above]) if (Math.max(...s.y) - Math.min(...s.y) > 1e-4) { p.push(`${name}: grey ${s.x} maps to [${s.y}], not neutral`); break; }
  for (let i = 1; i < ramp.length; i++) for (let c = 0; c < 3; c++)
    if (ramp[i]!.y[c]! < ramp[i - 1]!.y[c]! - 1e-6) { p.push(`${name}: decreases from ${ramp[i - 1]!.x} (${ramp[i - 1]!.y[c]}) to ${ramp[i]!.x} (${ramp[i]!.y[c]})`); i = ramp.length; break; }
  for (const s of ramp) if (s.x <= white && s.y.some((v) => v < 0 || v > 1)) { p.push(`${name}: ${s.x} in [0, white] maps to [${s.y}], outside [0, 1]`); break; }
  for (const s of above) if (s.y.some((v) => Math.abs(v - 1) > clampTol)) { p.push(`${name}: ${s.x}, above white ${white.toFixed(4)}, maps to [${s.y}], not 1`); break; }
  return p;
}

describe('#418.052c8008 every tone curve keeps black, neutral greys, order and its range', () => {
  it('#418.052c8008 none, filmic, AgX and neutral each map black to black, greys to greys, never decrease, keep [0, white] in [0, 1] and give 1 above white', () => {
    requireGpu();
    const maps: ToneMap[] = ['none', 'filmic', AGX(), 'neutral'];
    const n = 2048;
    const inputs = maps.map((m): F32 => {
      const w = whiteOf(m);
      const img: F32 = { width: n, height: 2, rgba: new Float32Array(n * 2 * 4) };
      for (let i = 0; i < n; i++) {
        const g = 2 * w * (i / (n - 1)) ** 4; // the ramp, 0 to twice white
        const h = w * (1 + 63 * (i / (n - 1))); // white to 64 × white
        img.rgba.set([g, g, g, 1], i * 4); img.rgba.set([h, h, h, 1], (n + i) * 4);
      }
      return img;
    });
    const problems: string[] = [];
    for (const [k, m] of maps.entries()) {
      const got = toneCalls([m], inputs[k]!)[0]!;
      const w = whiteOf(m);
      const ramp = Array.from({ length: n }, (_, i) => ({ x: inputs[k]!.rgba[i * 4]!, y: at(got, i) }));
      const above = [...ramp.filter((s) => s.x >= w * (1 + 1e-6)), ...Array.from({ length: n }, (_, i) => ({ x: inputs[k]!.rgba[(n + i) * 4]!, y: at(got, n + i) })).filter((s) => s.x >= w * (1 + 1e-6))];
      // Neutral reaches 1 only in the limit: its white is where it comes within half a 10-bit code of 1.
      problems.push(...properties(nameOf(m), w, m === 'neutral' ? 0.5 / 1023 + 1e-6 : 1e-6, ramp, above));
    }
    expect(problems).toEqual([]);
    // The twin: the property check fails the ACES fit left unclamped, which passes 1 above its white.
    const raw = (x: number): number => (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
    const fw = whiteOf('filmic');
    const xs = [0, 0.5, 1, fw, 10, 100];
    const twin = properties('filmic unclamped', fw, 1e-6, xs.map((x) => ({ x, y: [raw(x), raw(x), raw(x)] as Lin })), xs.filter((x) => x > fw).map((x) => ({ x, y: [raw(x), raw(x), raw(x)] as Lin })));
    expect(twin.length, 'the twin: an unclamped curve fails the property check').toBeGreaterThan(0);
  }, 1_800_000);
});
