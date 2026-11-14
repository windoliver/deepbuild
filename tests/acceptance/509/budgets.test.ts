// #509.39975b5a: "Budgets, on the reference Mac in the local preflight, compared with the merge base: transcribing a 60 s
// narrated film's lines and mix windows takes under 60 s on the reference Mac's CPU, and the per-bus power bakes add
// 800 B/s per channel"
//
// Split as #157's budget suite is. The merge-base comparison is the perf lane's: benchmarks/budgets.json has a task whose
// reason names this criterion's ID, valid against the merge base's budgets, so the preflight compares this change's
// timing with the merge base's on the same work. The limit is judged here by the repo's `judgeLimit`
// (scripts/benchmark.mjs): five runs after a warm-up, counted only on a reference Mac in a fit state and INCONCLUSIVE
// anywhere else, never a pass. The film: 60 s, twelve lines of eight words, each your own recording spoken word by word
// by `say` and laid every 5 s from 0.5 s, over a music bed on the bus `music`. A run is one verdict on the film (BLOCKED,
// with an unrun entry per line and scope: 24 transcriptions, the lines and their mix windows) and then each entry's
// deep_job narration.transcript on whisper-cpp@1.9.5, one after another; the run's time is the sum of the calls that ran
// a job (a call held on a send ask and answered is not counted). Each run's takes are scaled by its own gain, so every
// PCM is new and no transcription is a cache hit. The power bakes: the film exported (H.264 and AAC); the receipt's
// `bakes` lists a bake for the narration and music buses, each of 6,000 sub-blocks of 10 ms, its bytes 8 per channel per
// sub-block, so 800 B/s per channel over the 60 s, and the store holds each bake by its hash at that size. Any machine
// judges the bytes.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { music } from '../1819/fixtures/synth.ts';
import {
  AC, CC0, DOC, FLICKS, FULL, RATE, REPO, SPEECH, TIMEOUT, arr, assetOf, film, filmRun, inconclusive, int, obj, openWorld, presentedRun, proof,
  putEvidence, receiptOf, recorded, referenceMacProblem, rowFrom, show, stage, take, transcribe, unrunOf, useShow, useTemp, verdictCall, wavOf, withPlugin,
  type JsonObject, type World,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const SECONDS = 60;
const LINES = [
  'The morning fog lifts slowly over the harbour', 'Small boats leave the quiet docks before dawn', 'Gulls follow them out past the stone wall',
  'Fishermen check their nets and coil the ropes', 'The wind turns cold as clouds roll inland', 'Waves break white against the northern rocks',
  'A bell rings twice from the old church tower', 'Children run along the beach with their dogs', 'The market opens with baskets of fresh bread',
  'By noon the sun has burned the mist away', 'Evening brings the boats home full of fish', 'Lamps glow warm in every window by the sea',
];

interface Benchmark {
  validateBudgets(current: unknown, base: unknown): void;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: { start: number; end: number }[] }): { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string };
}
const benchmark = () => import(join(REPO, 'scripts', 'benchmark.mjs')) as Promise<Benchmark>;

/** The 60 s film in a store: twelve lines each at its 5 s slot, their takes scaled by `gain`, and the music bed. */
function narrated(evidence: string, gain: number): JsonObject {
  const lines: Record<string, JsonObject> = {};
  const assets: Record<string, JsonObject> = {};
  LINES.forEach((text, k) => {
    const s = stage(evidence, take(text, { gain }));
    if (s.take.samples.length > 4.5 * RATE) throw Error(`BLOCKED: say speaks line ${k + 1} in ${(s.take.samples.length / RATE).toFixed(2)} s, more than its 4.5 s`);
    lines[`l${k + 1}`] = recorded(`voice_l${k + 1}`, text, 0.5 + 5 * k);
    assets[`voice_l${k + 1}`] = assetOf(s);
  });
  const bed = music(SECONDS, RATE);
  const sha = putEvidence(evidence, wavOf([bed]));
  assets['bed'] = { sha256: sha, license: CC0 };
  return film({ span: SECONDS, lines, assets, strips: { bed: { track: 1, src: sha, start: '0s', in: 0, out: bed.length * (FLICKS / RATE), rate: 1, bus: 'music' } }, buses: { music: {} } });
}
/** One run: the film's verdict, then every unrun entry transcribed; the seconds the calls that ran a job took, summed. */
async function once(w: World, gain: number, what: string): Promise<number> {
  const [v] = presentedRun(shows.bin(FULL), w.evidence, narrated(w.evidence, gain), [verdictCall], what);
  const unrun = unrunOf(rowFrom(v!, 'narration.transcript@1', what), what);
  expect(unrun.length, `${what}: an unrun entry for each of the twelve lines' two scopes`).toBe(2 * LINES.length);
  let ms = 0;
  for (const u of unrun) ms += (await transcribe(w, u, [])).run.ms;
  return ms / 1000;
}

describe(`${AC[10]} budgets: transcribing a 60 s film under 60 s on the reference Mac's CPU; power bakes at 800 B/s per channel`, () => {
  it(`${AC[10]} the perf lane has a task whose reason names #509.39975b5a, and the budgets are valid against the merge base's`, async () => {
    const { validateBudgets } = await benchmark();
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: { id: string; initialReason?: string; changeReason?: string }[] };
    expect(current.tasks.some((t) => /#509\.39975b5a\b/.test(`${t.initialReason ?? ''} ${t.changeReason ?? ''}`)), 'benchmarks/budgets.json has a task whose reason names #509.39975b5a').toBe(true);
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
  }, TIMEOUT);

  it(`${AC[10]} on the reference Mac, transcribing the 60 s film's 12 lines and 12 mix windows takes under 60 s (five runs after a warm-up)`, async () => {
    const problem = await referenceMacProblem(true);
    if (problem) inconclusive(`the budget counts only on a reference Mac in a fit state, so the runs aren't made here: ${problem}`);
    const w = await openWorld([]);
    await withPlugin(w, SPEECH);
    await once(w, 0.5, 'the warm-up');
    const runs: number[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const start = loadavg()[0]!;
      runs.push(await once(w, 0.5 + 0.01 * (i + 1), `run ${i + 1}`));
      loads.push({ start, end: loadavg()[0]! });
    }
    const { fingerprint, judgeLimit } = await benchmark();
    const machine = fingerprint();
    const result = judgeLimit({ limit: SECONDS, runs, fingerprint: machine, loads });
    const reading = `transcribing the 60 s film's lines and mix windows: ${runs.map((r) => r.toFixed(2)).join(', ')} s against ${SECONDS} s on ${String(machine['model'])} macOS ${String(machine['macosBuild'])}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
    console.log(`${AC[10]} ${reading}`);
    proof('ac10-transcribe.json', { runs, loads, machine, result });
    expect(result.status, reading).not.toBe('BLOCKED');
    expect(result.status, reading).not.toBe('FAIL');
    if (result.status === 'INCONCLUSIVE') inconclusive(reading);
  }, TIMEOUT);

  it(`${AC[10]} the export's per-bus power bakes are 800 B/s per channel: 6,000 sub-blocks of 8 bytes per channel each over 60 s, kept by hash`, () => {
    const evidence = temp();
    const dir = temp();
    const [presented, reply] = filmRun(shows.bin(FULL), evidence, narrated(evidence, 0.5), [{ call: 'export', doc: DOC.a, out: join(dir, 'film.mp4'), video: { codec: 'h264' }, audio: { codec: 'aac' } }], 'the 60 s film');
    expect(presented!['outcome'], `the film is presented: ${show(presented)}`).toBe('presented');
    const r = receiptOf(reply!, 'the 60 s film\'s export').raw;
    const bakes = arr(r['bakes'], 'receipt.bakes').map((b, i) => obj(b, `receipt.bakes[${i}]`));
    proof('ac10-power-bakes.json', bakes);
    const failures: string[] = [];
    for (const want of ['narration', 'music']) if (!bakes.some((b) => b['bus'] === want)) failures.push(`receipt.bakes has no power bake for the bus ${want}: ${show(bakes)}`);
    for (const b of bakes) {
      const at = `the power bake of ${String(b['bus'])}`;
      const channels = int(b['channels'], `${at}: channels`);
      const subblocks = int(b['subblocks'], `${at}: subblocks`);
      const bytes = int(b['bytes'], `${at}: bytes`);
      const sha = typeof b['sha256'] === 'string' ? b['sha256'] : '';
      if (subblocks !== SECONDS * 100) failures.push(`${at}: ${subblocks} sub-blocks of 10 ms over ${SECONDS} s, not ${SECONDS * 100}`);
      if (bytes !== 800 * SECONDS * channels) failures.push(`${at}: ${bytes} bytes for ${channels} channel(s) over ${SECONDS} s, not 800 B/s per channel (${800 * SECONDS * channels})`);
      if (bytes !== 8 * channels * subblocks) failures.push(`${at}: ${bytes} bytes, not one f64 per channel per sub-block (${8 * channels * subblocks})`);
      let size = -1;
      try { size = statSync(join(evidence, sha.slice(0, 2), sha.slice(2))).size; } catch { /* missing */ }
      if (size !== bytes) failures.push(`${at}: the store holds ${size < 0 ? 'no file' : `${size} bytes`} under its hash ${JSON.stringify(b['sha256'] ?? null)}, not its ${bytes} bytes`);
    }
    expect(failures, failures.join('\n')).toEqual([]);
  }, TIMEOUT);
});
