// AC3 of #389: OKLab, OKLCh and sRGB conversions match palette and bevy_color, kept as data constants
// with their source (fixtures/colors.json), within 1e-6, near-black and hue-wrap cases included, with OKLCh
// hue compared modulo 360° and only where chroma is at least 1e-4, below which hue is powerless.
//
// Blind redraft of this one criterion from the issue, the design (Conventions every primitive uses; the
// closed function list and the ops module; Seeded and replayable), the README's `color` subcommand and
// fixtures sections, helpers.ts and the recorded fixture. No implementation was read.

import { describe, expect, it } from 'vitest';
import { batch, fixture, useBinary, type JsonObject, type JsonValue } from './helpers.ts';

type Vec3 = [number, number, number];
type Space = 'srgb' | 'linear' | 'oklab' | 'oklch';
type Reference = 'palette' | 'bevy';
interface Recorded { linear: Vec3; oklab: Vec3; oklch: Vec3 }
interface Sample { name: string; srgb: Vec3; palette: Recorded; bevy: Recorded }
interface Crate { crate: string; version: string; types: string }
interface Colors { source: { palette: Crate; bevy_color: Crate; how: string; tolerance: string }; samples: Sample[] }

/** The tolerances the criterion and the fixture's `source.tolerance` state. */
const TOL = 1e-6;
/** bevy_color computes in f32; its hue in degrees is held to 1e-6 of a turn (README, Fixtures). */
const BEVY_HUE_TOL_DEG = 360 * 1e-6;
/** Below this chroma hue is powerless and is never read. */
const CHROMA_FLOOR = 1e-4;
/** Hue-wrap samples sit within a degree of the 0/360 seam. */
const SEAM_DEG = 1;

const AXES = [0, 1, 2] as const;
const COMPONENT: Record<Space, readonly [string, string, string]> = {
  srgb: ['r', 'g', 'b'], linear: ['r', 'g', 'b'], oklab: ['L', 'a', 'b'], oklch: ['L', 'C', 'h'],
};
const REFERENCES: readonly Reference[] = ['palette', 'bevy'];

const colors = fixture<Colors>('colors.json');
const samples = colors.samples;

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((x) => typeof x === 'number' && Number.isFinite(x));
}

/** The smallest angle between two hues in degrees, so 359.9999 and 0.0001 are 0.0002 apart. */
function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function expectClose(got: number, want: number, tol: number, what: string): void {
  expect(Math.abs(got - want), `${what}: got ${got}, the reference gives ${want} (tolerance ${tol})`).toBeLessThanOrEqual(tol);
}

/** Runs one `color` process over every value and returns each output `value` as three finite numbers. */
function convert(from: Space, to: Space, values: readonly Vec3[], label: (i: number) => string): Vec3[] {
  const inputs = values.map((value): JsonObject => ({ from, to, value: [value[0], value[1], value[2]] }));
  const outs = batch(['color'], inputs);
  return outs.map((out: JsonValue, i) => {
    const value = typeof out === 'object' && out !== null && !Array.isArray(out) ? out['value'] : undefined;
    expect(isVec3(value), `${label(i)} (${from} → ${to}): value is three finite numbers, got ${JSON.stringify(out)}`).toBe(true);
    return value as Vec3;
  });
}

/** Compares a converted triple with a recorded one, every component to `tol`, naming reference, sample and component. */
function expectTriple(got: Vec3, want: Vec3, tol: number, reference: string, sample: string, space: Space): void {
  for (const i of AXES) {
    expectClose(got[i], want[i], tol, `${reference} ${sample} ${space}[${i}] (${COMPONENT[space][i]})`);
  }
}

/** L and C to `tol`; hue modulo 360 to `hueTol`, and only where the reference chroma is at least 1e-4. Returns whether hue was read. */
function expectOklch(got: Vec3, want: Vec3, tol: number, hueTol: number, reference: string, sample: string): boolean {
  expectClose(got[0], want[0], tol, `${reference} ${sample} oklch[0] (L)`);
  expectClose(got[1], want[1], tol, `${reference} ${sample} oklch[1] (C)`);
  if (want[1] < CHROMA_FLOOR) return false;
  expect(hueGap(got[2], want[2]), `${reference} ${sample} oklch[2] (h, modulo 360): got ${got[2]}, the reference gives ${want[2]} (tolerance ${hueTol}°)`).toBeLessThanOrEqual(hueTol);
  return true;
}

function sampleAt(i: number): string { return samples[i]?.name ?? `sample #${i}`; }
function isWrap(s: Sample): boolean { return s.palette.oklch[1] >= CHROMA_FLOOR && Math.min(s.palette.oklch[2], 360 - s.palette.oklch[2]) < SEAM_DEG; }

describe('AC3 color spaces: OKLab, OKLCh and sRGB against palette and bevy_color', () => {
  useBinary();

  it('AC3 the fixture names its two sources with versions and holds near-black and hue-wrap samples', () => {
    // The data constants with their source: both crates named, each with the version the values were printed from.
    expect(colors.source.palette.crate, 'fixture source: the first reference crate').toBe('palette');
    expect(colors.source.palette.version, 'fixture source: palette version').toBe('0.7.7');
    expect(colors.source.palette.types, 'fixture source: palette types name the f64 path').toContain('Oklab<f64>');
    expect(colors.source.bevy_color.crate, 'fixture source: the second reference crate').toBe('bevy_color');
    expect(colors.source.bevy_color.version, 'fixture source: bevy_color version').toBe('0.20.0');
    expect(colors.source.bevy_color.types, 'fixture source: bevy_color types name the f32 path').toContain('Oklcha');
    expect(colors.source.how.length, 'fixture source: how the values were produced').toBeGreaterThan(0);
    expect(colors.source.tolerance, 'fixture source: tolerance names the chroma floor').toContain('1e-4');

    expect(samples.length, 'fixture: the 24 recorded samples').toBe(24);
    const names = new Set<string>();
    for (const s of samples) {
      expect(names.has(s.name), `fixture ${s.name}: a sample name is unique`).toBe(false);
      names.add(s.name);
      expect(isVec3(s.srgb), `fixture ${s.name} srgb: three finite numbers`).toBe(true);
      for (const i of AXES) {
        expect(s.srgb[i] >= 0 && s.srgb[i] <= 1, `fixture ${s.name} srgb[${i}]: encoded sRGB in 0–1`).toBe(true);
      }
      for (const reference of REFERENCES) {
        const rec = s[reference];
        for (const space of ['linear', 'oklab', 'oklch'] as const) {
          expect(isVec3(rec[space]), `fixture ${reference} ${s.name} ${space}: three finite numbers`).toBe(true);
        }
        expect(rec.oklch[1] >= 0, `fixture ${reference} ${s.name} oklch[1] (C): non-negative`).toBe(true);
        expect(rec.oklch[2] >= 0 && rec.oklch[2] < 360, `fixture ${reference} ${s.name} oklch[2] (h): in [0, 360)`).toBe(true);
      }
    }

    expect(names.has('black'), 'fixture: holds black').toBe(true);
    expect(names.has('white'), 'fixture: holds white').toBe(true);
    const nearBlack = samples.filter((s) => s.name.startsWith('near-black'));
    expect(nearBlack.length, 'fixture: at least three near-black samples').toBeGreaterThanOrEqual(3);
    for (const s of nearBlack) {
      expect(Math.max(...s.srgb), `fixture ${s.name} srgb: every channel at most 1/255, so it is near black`).toBeLessThanOrEqual(1 / 255 + 1e-12);
    }
    const wraps = samples.filter(isWrap);
    expect(wraps.map((s) => s.name), 'fixture: at least four hue-wrap samples within a degree of the 0/360 seam with chroma ≥ 1e-4').toHaveLength(4);
    expect(wraps.some((s) => s.palette.oklch[2] > 360 - SEAM_DEG), 'fixture: a hue-wrap sample just under 360°').toBe(true);
    expect(wraps.some((s) => s.palette.oklch[2] < SEAM_DEG), 'fixture: a hue-wrap sample just over 0°').toBe(true);
    const powerless = samples.filter((s) => s.palette.oklch[1] < CHROMA_FLOOR);
    expect(powerless.length, 'fixture: samples whose chroma is below 1e-4, where hue is powerless (black, white, greys)').toBeGreaterThanOrEqual(3);
  });

  it('AC3 sRGB → linear matches palette and bevy_color within 1e-6 on every sample', () => {
    const got = convert('srgb', 'linear', samples.map((s) => s.srgb), sampleAt);
    samples.forEach((s, i) => {
      for (const reference of REFERENCES) expectTriple(got[i]!, s[reference].linear, TOL, reference, s.name, 'linear');
    });
  });

  it('AC3 sRGB → OKLab matches palette and bevy_color within 1e-6, near-black samples included', () => {
    const got = convert('srgb', 'oklab', samples.map((s) => s.srgb), sampleAt);
    samples.forEach((s, i) => {
      for (const reference of REFERENCES) expectTriple(got[i]!, s[reference].oklab, TOL, reference, s.name, 'oklab');
    });
  });

  it('AC3 sRGB → OKLCh matches both references: L and C within 1e-6, hue modulo 360° only where chroma ≥ 1e-4', () => {
    const got = convert('srgb', 'oklch', samples.map((s) => s.srgb), sampleAt);
    let huesRead = 0;
    let huesSkipped = 0;
    let wrapsRead = 0;
    samples.forEach((s, i) => {
      const out = got[i]!;
      expect(out[2] >= 0 && out[2] < 360, `binary ${s.name} oklch[2] (h): reported in [0, 360), got ${out[2]}`).toBe(true);
      // palette is f64: hue to 1e-6°. bevy_color is f32: its hue is held to 1e-6 of a turn (3.6e-4°), per the fixture's source.tolerance.
      const readPalette = expectOklch(out, s.palette.oklch, TOL, TOL, 'palette', s.name);
      const readBevy = expectOklch(out, s.bevy.oklch, TOL, BEVY_HUE_TOL_DEG, 'bevy', s.name);
      if (readPalette) huesRead++; else huesSkipped++;
      if (readPalette && readBevy && isWrap(s)) wrapsRead++;
    });
    // The criterion's hue-wrap and chroma-floor cases must actually be exercised, not skipped away.
    expect(wrapsRead, 'hue-wrap samples compared modulo 360° against both references').toBe(4);
    expect(huesRead, 'samples whose hue was compared (chroma ≥ 1e-4)').toBeGreaterThanOrEqual(16);
    expect(huesSkipped, 'samples whose hue was left unread (chroma < 1e-4)').toBeGreaterThanOrEqual(3);
  });

  it('AC3 the inverse directions return to the recorded values within 1e-6', () => {
    // From the f64 reference's recorded values back along each arrow, and the sRGB transfer's inverse from both.
    const names = sampleAt;
    const srgbFromLinear = convert('linear', 'srgb', samples.map((s) => s.palette.linear), names);
    const srgbFromOklab = convert('oklab', 'srgb', samples.map((s) => s.palette.oklab), names);
    const srgbFromOklch = convert('oklch', 'srgb', samples.map((s) => s.palette.oklch), names);
    const linearFromOklab = convert('oklab', 'linear', samples.map((s) => s.palette.oklab), names);
    const oklabFromOklch = convert('oklch', 'oklab', samples.map((s) => s.palette.oklch), names);
    const oklchFromOklab = convert('oklab', 'oklch', samples.map((s) => s.palette.oklab), names);
    const srgbFromBevyLinear = convert('linear', 'srgb', samples.map((s) => s.bevy.linear), names);
    samples.forEach((s, i) => {
      expectTriple(srgbFromLinear[i]!, s.srgb, TOL, 'palette linear → srgb', s.name, 'srgb');
      expectTriple(srgbFromOklab[i]!, s.srgb, TOL, 'palette oklab → srgb', s.name, 'srgb');
      expectTriple(srgbFromOklch[i]!, s.srgb, TOL, 'palette oklch → srgb', s.name, 'srgb');
      expectTriple(linearFromOklab[i]!, s.palette.linear, TOL, 'palette oklab → linear', s.name, 'linear');
      expectTriple(oklabFromOklch[i]!, s.palette.oklab, TOL, 'palette oklch → oklab', s.name, 'oklab');
      expectOklch(oklchFromOklab[i]!, s.palette.oklch, TOL, TOL, 'palette oklab → oklch', s.name);
      expectTriple(srgbFromBevyLinear[i]!, s.srgb, TOL, 'bevy linear → srgb', s.name, 'srgb');
    });
  });

  it('AC3 hue is reported in [0, 360), and hues just under 360°, just over 0° and over 360° on input give one OKLab', () => {
    // Every sample's reported hue lies in [0, 360): checked on the forward conversion and on OKLab → OKLCh.
    const forward = convert('srgb', 'oklch', samples.map((s) => s.srgb), sampleAt);
    const viaOklab = convert('oklab', 'oklch', samples.map((s) => s.palette.oklab), sampleAt);
    samples.forEach((s, i) => {
      expect(forward[i]![2] >= 0 && forward[i]![2] < 360, `binary ${s.name} srgb → oklch[2] (h): in [0, 360), got ${forward[i]![2]}`).toBe(true);
      expect(viaOklab[i]![2] >= 0 && viaOklab[i]![2] < 360, `binary ${s.name} oklab → oklch[2] (h): in [0, 360), got ${viaOklab[i]![2]}`).toBe(true);
    });

    // The README's seam: 359.9999, −0.0001 and 719.9999 are one hue. Each hue-wrap sample's recorded hue, and the
    // same hue shifted by −360 and +360, give one OKLab, within 1e-6 of the recorded one and within 1e-9 of each other.
    const wraps = samples.filter(isWrap);
    const seam: { sample: string; label: string; oklch: Vec3; want: Vec3 }[] = [];
    for (const s of wraps) {
      const [L, C, h] = s.palette.oklch;
      seam.push({ sample: s.name, label: `h = ${h}`, oklch: [L, C, h], want: s.palette.oklab });
      seam.push({ sample: s.name, label: `h − 360 = ${h - 360}`, oklch: [L, C, h - 360], want: s.palette.oklab });
      seam.push({ sample: s.name, label: `h + 360 = ${h + 360}`, oklch: [L, C, h + 360], want: s.palette.oklab });
    }
    const readme: { label: string; oklch: Vec3 }[] = [
      { label: 'h = 359.9999', oklch: [0.5, 0.1, 359.9999] },
      { label: 'h = −0.0001', oklch: [0.5, 0.1, -0.0001] },
      { label: 'h = 719.9999', oklch: [0.5, 0.1, 719.9999] },
    ];
    const got = convert('oklch', 'oklab', [...seam.map((c) => c.oklch), ...readme.map((c) => c.oklch)], (i) => {
      const c = seam[i];
      return c ? `${c.sample} ${c.label}` : `README seam ${readme[i - seam.length]?.label ?? `#${i}`}`;
    });

    seam.forEach((c, i) => expectTriple(got[i]!, c.want, TOL, `palette oklch (${c.label}) → oklab`, c.sample, 'oklab'));
    for (const s of wraps) {
      const base = seam.findIndex((c) => c.sample === s.name);
      const [atH, under, over] = [got[base]!, got[base + 1]!, got[base + 2]!];
      for (const i of AXES) {
        expectClose(under[i], atH[i], 1e-9, `binary ${s.name} oklab[${i}] (${COMPONENT.oklab[i]}) from h − 360 vs from h`);
        expectClose(over[i], atH[i], 1e-9, `binary ${s.name} oklab[${i}] (${COMPONENT.oklab[i]}) from h + 360 vs from h`);
      }
    }

    const [underSeam, negative, overTurn] = [got[seam.length]!, got[seam.length + 1]!, got[seam.length + 2]!];
    for (const i of AXES) {
      expectClose(negative[i], underSeam[i], 1e-9, `binary README seam oklab[${i}] (${COMPONENT.oklab[i]}) from h = −0.0001 vs from h = 359.9999`);
      expectClose(overTurn[i], underSeam[i], 1e-9, `binary README seam oklab[${i}] (${COMPONENT.oklab[i]}) from h = 719.9999 vs from h = 359.9999`);
    }
    // And the hue the binary reports for those inputs comes back in [0, 360), one hue modulo 360.
    const back = convert('oklab', 'oklch', [underSeam, negative, overTurn], (i) => `README seam ${readme[i]?.label ?? `#${i}`}`);
    for (const [i, c] of readme.entries()) {
      const h = back[i]![2];
      expect(h >= 0 && h < 360, `binary README seam ${c.label} oklch[2] (h): in [0, 360), got ${h}`).toBe(true);
      expect(hueGap(h, 359.9999), `binary README seam ${c.label} oklch[2] (h, modulo 360): got ${h}, expected 359.9999`).toBeLessThanOrEqual(TOL);
    }
  });
});
