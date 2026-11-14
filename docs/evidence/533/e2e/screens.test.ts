// #533 end to end, with screenshots: a logic item drawn by a mark set, through the real deep-show, in the full build and
// in the build without physics; each frame's PNG and `flock.cx` saved to ../screens with a manifest of what each shows.
// Run: npx vitest run --root docs/evidence/533/e2e --testTimeout=3600000
//
// The document: #533's flock (100 boids drifting right; it writes `cx`, the flock's centre x, and reads nothing) and a
// `marks@1` atlas set of one free row whose x reads `flock.cx` (Mark set: logic columns, #535), on a 12 × 3 u page at
// 64 px a u. Its `requires` names no module: a logic item needs none (Document envelope: `requires`).
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flock, flockCx } from '../../../../tests/acceptance/533/programs.ts';
import { DOC, FLICKS, REGISTRY, deepShow, runShow, scenario, putAsset, num, obj, arr, str, show, type JsonObject } from '../../../../tests/acceptance/533/helpers.ts';
import { decodePng, encodeRgbaPng, putEvidence, getEvidence } from '../../../../tests/acceptance/535/helpers.ts';
import { atlasSet, array, film } from '../../../../tests/acceptance/535/fixtures.ts';
import { tmpdir } from 'node:os';

const OUT = join(import.meta.dirname, '..', 'screens');
const PAGE: [number, number] = [12, 3];
const PX: [number, number] = [768, 192];
const TIMES = [0.5, 2.0, 3.5];
const BUILDS = { full: ['full'], 'no-physics': ['full', 'test-leave-out-physics'] } as const;

// A 16 × 8 atlas: cell 0 grey, cell 1 a red 8 × 8 square with a black 2 px border, so a drawn row is easy to see on the
// white page. The renderer samples the cell smoothly, so the frame shows a red core fading through dark to white.
const RED = [230, 25, 75] as const;
const ATLAS = encodeRgbaPng(16, 8, (x, y) => (x < 8 ? [128, 128, 128, 255] : (x < 10 || x > 13 || y < 2 || y > 5) ? [0, 0, 0, 255] : [...RED, 255]));

/** The centre of a frame's pure-red pixels, in px. */
function redCentre(png: Buffer): [number, number] {
  const im = decodePng(png);
  let [n, sx, sy] = [0, 0, 0];
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    const i = (y * im.width + x) * 4;
    if (im.rgba[i] === RED[0] && im.rgba[i + 1] === RED[1] && im.rgba[i + 2] === RED[2]) [n, sx, sy] = [n + 1, sx + x + 0.5, sy + y + 0.5];
  }
  expect(n, 'the frame holds the red square').toBeGreaterThan(0);
  return [sx / n, sy / n];
}

function runBuild(name: keyof typeof BUILDS): JsonObject[] {
  const ev = mkdtempSync(join(tmpdir(), 'deep-533-e2e-'));
  const program = flock();
  putAsset(ev, program);
  const atlas = putEvidence(ev, ATLAS);
  const doc = film('flock-drawn', PAGE, [
    { id: 'flock', kind: 'logic@1', name: 'Logic flock', order: 'a9', params: { program: program.sha, step_rate: 60, writes: { cx: { type: 'f64' } } } },
    atlasSet('dot', 'a1', { asset: atlas, cell: [8, 8] }, { cell: [1, 1] }, { place: 'free', columns: { x: array('flock.cx', 'f32'), y: { const: 1.5 }, tile: { const: 1 } } }),
  ], { flock_program: program.sha, dot_atlas: atlas });
  const calls: JsonObject[] = [
    REGISTRY,
    { call: 'deep_show', session: 'sess-alpha', doc: DOC.a, document: doc, include: ['issues'], size: PX },
    ...TIMES.map((s) => ({ call: 'eval', doc: DOC.a, t: Math.round(s * FLICKS), arrays: ['flock.cx'], pixels: true, size: PX })),
  ];
  const replies = runShow(deepShow([...BUILDS[name]]), scenario(ev, calls));
  const modules = arr(replies[0]!['modules'], `${name}: registry.modules`).map(String);
  const shown = replies[1]!;
  expect(shown['outcome'], `${name}: the document is presented: ${show(shown['issues'] ?? shown)}`).toBe('presented');
  return replies.slice(2).map((r, i) => {
    const snaps = arr(r['snapshots'], `${name} eval ${TIMES[i]} s: snapshots (${show(r)})`);
    const sha = str(obj(snaps[0], 'snapshot')['sha256'], 'snapshot sha256');
    const file = `${name}-t${TIMES[i]}s.png`;
    const png = getEvidence(ev, sha, file);
    writeFileSync(join(OUT, file), png);
    expect(createHash('sha256').update(png).digest('hex'), `${file}: the saved bytes are the snapshot`).toBe(sha);
    const cx = num(obj(r['arrays'], 'arrays')['flock.cx'], `${name} flock.cx at ${TIMES[i]} s`);
    const [x, y] = redCentre(png);
    expect(Math.abs(x - cx * 64), `${file}: the square's centre x ${x} px is cx × 64 = ${cx * 64} px`).toBeLessThan(1);
    expect(Math.abs(y - 96), `${file}: the square's centre y ${y} px is 96 px`).toBeLessThan(1);
    return { build: name, modules, t_s: TIMES[i]!, file, sha256: sha, cx, square_centre_px: [x, y] } as unknown as JsonObject;
  });
}

describe('#533 end to end: a logic item drawn in the full build and without physics', () => {
  it('records each frame, with flock.cx, in both builds', () => {
    mkdirSync(OUT, { recursive: true });
    const rows = [...runBuild('full'), ...runBuild('no-physics')];
    const steps = TIMES.map((s) => Math.floor(s * 60));
    const mirror = flockCx(Math.max(...steps) + 1);
    const manifest = {
      document: 'flock (logic@1, writes cx: the 100 boids\' centre x, in u) + marks@1 set "dot": one free row, x = flock.cx, y = 1.5 u, a red square with a black border, sampled smoothly; page 12 × 3 u at 64 px/u (768 × 192 px); requires names no module',
      expect: 'the square\'s centre at x = cx × 64 px, y = 96 px; it moves right as t grows; the full and no-physics frames at the same t are the same picture; each is asserted by screens.test.ts, with cx checked against mirror_cx',
      mirror_cx: Object.fromEntries(TIMES.map((s, i) => [`${s}s`, mirror[steps[i]!]])),
      frames: rows,
    };
    for (const r of rows) expect(r['modules'] as unknown as string[]).toContain('logic');
    expect(rows.filter((r) => r['build'] === 'full').every((r) => (r['modules'] as unknown as string[]).includes('physics')), 'the full build holds physics').toBe(true);
    expect(rows.some((r) => r['build'] === 'no-physics' && (r['modules'] as unknown as string[]).includes('physics')), 'the no-physics build holds none').toBe(false);
    TIMES.forEach((s, i) => rows.filter((r) => r['t_s'] === s).forEach((r) => expect(num(r['cx'], 'cx'), `cx at ${s} s is the mirror's`).toBeCloseTo(mirror[steps[i]!]!, 9)));
    const xs = rows.filter((r) => r['build'] === 'full').map((r) => num(r['cx'], 'cx'));
    expect(xs.every((x, i) => i === 0 || x > xs[i - 1]!), `the square moves right: ${xs}`).toBe(true);
    for (const s of TIMES) {
      const [a, b] = [rows.find((r) => r['build'] === 'full' && r['t_s'] === s)!, rows.find((r) => r['build'] === 'no-physics' && r['t_s'] === s)!];
      expect(b['sha256'], `the frame at ${s} s is the same picture with and without physics`).toBe(a['sha256']);
    }
    writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }, 3_600_000);
});
