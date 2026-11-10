// AC3: a planted decode of 500 ms keeps GPUI's frame time under 16.7 ms at p99 while it runs. The merge base blocks for
// 500 ms and fails.
//
// The app's canvas panel in the app's real window on this Mac's screen (`deep-app --canvas <scenario>` in a
// `canvas-fixture` build, README: The surface under test), fed revisions as `follow` feeds the hub's: one at 0 ms, then
// twelve, one a second, each replacing the last one's picture. Every picture decode takes the planted 500 ms. A frame's
// time is the UI thread's CPU time from that frame's start to the next frame's start, so work the UI thread does
// between frames, a revision handed over and a decode in place among it, counts (README: Readings). "While it runs"
// is each replacement's frames, from the one after which it was handed over to the first that draws its picture, all
// twelve pooled: at least 300 frames a run at 60 Hz. Scope: until the new picture arrives, the panel shows the old one.
//
// Judged as the design judges a frame-time limit: a warm-up run, then five runs, each its p99; PASS only on a reference
// Mac (mains power, Low Power Mode off, thermal state nominal, unloaded) with all five under 16.7 ms. Anywhere else the
// five are printed and the test skips INCONCLUSIVE (reading only); off macOS it never runs. The wrong program, the
// merge base's decode in place on the UI thread, is planted with DEEP_CANVAS_PLANT=decodes_in_place.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_BUILD, arr, count, flatPng, judgeLimit, machine, num, obj, onlyOnMacos, percentile, putEvidence, scratch, useBuild,
  type JsonObject, type JsonValue, type Rgb,
} from './helpers.ts';

const app = useBuild(APP_BUILD, 'deep-app', 'release', () => process.platform === 'darwin');
const dir = scratch('panel');
const evidence = join(dir, 'evidence');

const LIMIT_MS = 16.7;
const DECODE_MS = 500;
const REPLACEMENTS = 12;
const EVERY_MS = 1_000;
/** The last replacement is handed over at 12 s; its picture has 1.5 s to arrive. */
const RUN_MS = REPLACEMENTS * EVERY_MS + 1_500;
const MIN_FRAMES = 300;
const WINDOW: [number, number] = [800, 600];

/** Picture n's color, so each revision's picture is its own file. */
const color = (n: number): Rgb => [40 + ((n * 53) % 176), 40 + ((n * 97) % 176), 40 + ((n * 29) % 176)];
/** Thirteen pictures of a retina panel's size, 1,600 × 1,200 px, in the evidence store as the panel reads it. */
const PICTURES = Array.from({ length: REPLACEMENTS + 1 }, (_, n) => putEvidence(evidence, flatPng(1_600, 1_200, color(n))));

/** One revision as the hub presents it (`canvas.drawn`, #995's shape): one agent layer with its picture. */
const revision = (rev: number, picture: string): JsonObject => ({
  doc: 'fig', rev, rect: [0, 0, WINDOW[0], WINDOW[1]],
  layers: [{ layer: 'plot', owner: { session: 's-1485' }, band: 'agent', outline: false, items: ['figure'], picture }],
});

const SCENARIO: JsonObject = {
  evidence, window: WINDOW, decode_ms: DECODE_MS, run_ms: RUN_MS,
  revisions: PICTURES.map((picture, i) => ({ at_ms: i * EVERY_MS, presented: revision(i + 1, picture) })),
};

interface Frame { frame: number; at_ms: number; cpu_ms: number; pictures: string[] }
interface Report { frames: Frame[]; handed: Map<number, number> }

/** One run of the app's window over the scenario; its report (README: `deep-app --canvas`). */
function runApp(bin: string, planted?: string): Report {
  const what = `deep-app --canvas${planted ? ` with DEEP_CANVAS_PLANT=${planted}` : ''}`;
  const home = mkdtempSync(join(tmpdir(), 'deep-1485-home-'));
  try {
    const scenario = join(home, 'scenario.json');
    writeFileSync(scenario, JSON.stringify(SCENARIO));
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
    delete env['DEEP_CANVAS_PLANT'];
    if (planted) env['DEEP_CANVAS_PLANT'] = planted;
    const r = spawnSync(bin, ['--canvas', scenario], { env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: RUN_MS + 120_000, killSignal: 'SIGKILL' });
    if (r.error) throw Error(`${what}: ${r.error.message}`);
    expect(r.status, `${what} exits 0: ${r.stderr.slice(-2000)}`).toBe(0);
    const line = r.stdout.split('\n').reverse().find((l) => l.startsWith('{'));
    const report = obj(line === undefined ? undefined : (JSON.parse(line) as JsonValue), `${what}: its report line`);
    expect(report['canvas'], `${what}: the report names #1485`).toBe(1485);
    const frames = arr(report['frames'], `${what}: frames`).map((f, k) => {
      const x = obj(f, `${what}: frames[${k}]`);
      expect(x['frame'], `${what}: frames[${k}].frame`).toBe(k);
      const pictures = arr(x['pictures'], `${what}: frames[${k}].pictures`);
      expect(pictures.every((p) => typeof p === 'string'), `${what}: frames[${k}].pictures are hashes`).toBe(true);
      return { frame: k, at_ms: num(x['at_ms'], `${what}: frames[${k}].at_ms`), cpu_ms: num(x['cpu_ms'], `${what}: frames[${k}].cpu_ms`), pictures: pictures as string[] };
    });
    const handed = new Map<number, number>();
    for (const [i, h] of arr(report['handed'], `${what}: handed`).entries()) {
      const x = obj(h, `${what}: handed[${i}]`);
      handed.set(count(x['rev'], `${what}: handed[${i}].rev`), count(x['frame'], `${what}: handed[${i}].frame`));
    }
    expect([...handed.keys()].sort((a, b) => a - b), `${what}: every revision was handed over`).toEqual(PICTURES.map((_, i) => i + 1));
    return { frames, handed };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

interface Analysis {
  /** Each frame's UI-thread time while a replacement's decode ran. */
  during: number[];
  /** The frame with the most UI-thread time among them. */
  worst: Frame | null;
  /** Ways the panel went wrong that aren't a time: a picture that never showed, the old picture gone too soon. */
  wrong: string[];
  /** Ways the run can't be judged: the planted decode didn't hold, or a replacement came before the last arrived. */
  unjudged: string[];
}

function analyze(r: Report): Analysis {
  const out: Analysis = { during: [], worst: null, wrong: [], unjudged: [] };
  for (let i = 1; i <= REPLACEMENTS; i++) {
    const rev = i + 1;
    const [old, fresh] = [PICTURES[i - 1]!, PICTURES[i]!];
    const h = r.handed.get(rev)!;
    const handedAt = r.frames[h];
    if (handedAt === undefined) { out.wrong.push(`revision ${rev} was handed over after frame ${h}, which isn't in the report`); continue; }
    if (!handedAt.pictures.includes(old)) { out.unjudged.push(`revision ${rev} was handed over at frame ${h}, before revision ${i}'s picture showed`); continue; }
    const a = r.frames.findIndex((f) => f.frame > h && f.pictures.includes(fresh));
    if (a < 0) { out.wrong.push(`revision ${rev}'s picture never showed in the ${r.frames.length - h - 1} frames after it was handed over`); continue; }
    const waited = r.frames[a]!.at_ms - handedAt.at_ms;
    if (waited < DECODE_MS) out.unjudged.push(`revision ${rev}'s picture showed ${waited.toFixed(1)} ms after frame ${h}: the planted decode of ${DECODE_MS} ms didn't hold`);
    const gone = r.frames.slice(h + 1, a).find((f) => !f.pictures.includes(old));
    if (gone) out.wrong.push(`frame ${gone.frame}, while revision ${rev}'s picture decoded, drew ${JSON.stringify(gone.pictures)} without revision ${i}'s picture (Scope: the panel shows the old picture until the new one arrives)`);
    for (const f of r.frames.slice(h, a + 1)) {
      out.during.push(f.cpu_ms);
      if (!out.worst || f.cpu_ms > out.worst.cpu_ms) out.worst = f;
    }
  }
  return out;
}

const describeRun = (a: Analysis): string =>
  `${a.during.length} frames while decodes ran, p99 ${a.during.length ? percentile(a.during, 0.99).toFixed(2) : '?'} ms, worst frame ${a.worst ? `${a.worst.frame} at ${a.worst.at_ms.toFixed(1)} ms: ${a.worst.cpu_ms.toFixed(2)} ms` : 'none'}`;

describe('AC3 a planted decode of 500 ms keeps GPUI\'s frame time under 16.7 ms at p99 while it runs', () => {
  it('AC3 twelve picture replacements, each decoded for 500 ms: the old picture stays until the new one arrives, and the UI thread\'s frame time is under 16.7 ms at p99 in five runs on a reference Mac', (ctx) => {
    onlyOnMacos(ctx, 'the app\'s window');
    const bin = app();
    const warm = analyze(runApp(bin));
    console.log(`AC3 warm-up: ${describeRun(warm)}`);
    const runs: number[] = [];
    const loads: { start: number; end: number }[] = [];
    const unjudged: string[] = [];
    let fewest = Infinity;
    for (let n = 1; n <= 5; n++) {
      const start = loadavg()[0]!;
      const a = analyze(runApp(bin));
      loads.push({ start, end: loadavg()[0]! });
      console.log(`AC3 run ${n}: ${describeRun(a)}`);
      expect(a.wrong, `run ${n}: the panel`).toEqual([]);
      unjudged.push(...a.unjudged.map((u) => `run ${n}: ${u}`));
      fewest = Math.min(fewest, a.during.length);
      runs.push(a.during.length ? percentile(a.during, 0.99) : NaN);
    }
    const held = unjudged.filter((u) => u.includes('didn\'t hold'));
    if (held.length) expect.fail(`BLOCKED: ${held.join('; ')}`);
    if (unjudged.length) ctx.skip(`INCONCLUSIVE: ${unjudged.join('; ')}`);
    if (fewest < MIN_FRAMES) ctx.skip(`INCONCLUSIVE: a frame-time limit is judged over at least ${MIN_FRAMES} frames a run; a run had ${fewest} while decodes ran`);
    const verdict = judgeLimit(LIMIT_MS, runs, machine(), loads);
    console.log(`AC3 verdict: ${JSON.stringify(verdict)}`);
    if (verdict.status === 'INCONCLUSIVE') ctx.skip(`INCONCLUSIVE (reading only): p99 ${runs.map((r) => r.toFixed(2)).join(', ')} ms; ${verdict.reason}`);
    expect(verdict.status, `the UI thread's frame time at p99 while the planted decode runs, five runs, against ${LIMIT_MS} ms: ${JSON.stringify(verdict)}`).toBe('PASS');
  }, 3_600_000);

  it('AC3 planted decodes_in_place (the merge base) blocks the UI thread for the decode and fails the check', (ctx) => {
    onlyOnMacos(ctx, 'the app\'s window');
    const a = analyze(runApp(app(), 'decodes_in_place'));
    console.log(`AC3 decodes_in_place: ${describeRun(a)}`);
    expect(a.unjudged.filter((u) => u.includes('didn\'t hold')), 'the planted decode of 500 ms held').toEqual([]);
    expect(a.during.length, 'frames were drawn while decodes ran').toBeGreaterThan(0);
    expect(percentile(a.during, 0.99), `the decode in place puts its time on the UI thread, so the frame time at p99 is over ${LIMIT_MS} ms: ${describeRun(a)}`).toBeGreaterThan(LIMIT_MS);
  }, 3_600_000);
});
