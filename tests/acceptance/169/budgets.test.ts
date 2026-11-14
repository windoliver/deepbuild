// AC5 #169.e6c2fc38: "Budgets, on the reference Mac in the local preflight, compared with the merge base: the 24-state
// walkthrough, with 3 s states and about 120 edges of 1 s, exports at 1080p30 in under 4 minutes and under 250 MB, and
// the player is under 100 KB"
//
// Split as #162's and #501's budget suites are: the merge-base comparison is the perf lane's (benchmarks/budgets.json
// has a task naming this criterion, in its `criteria` or its reason, valid against the merge base's budgets); the
// limits are judged here. The walkthrough is criterion 1's with its 3 s loop on (helpers.ts `walkthrough({loop:
// true})`: the transport wraps every 3 s while a fan turns once, so each state is a 3 s loop; the explode edges take
// about 1 s and the stage glides 0.8 s).
//
// asserts:
//   - the perf lane's task, as above;
//   - on any machine: the walkthrough exported at 320 × 180 writes a player (every file under `player/`, plus any
//     script or style written inline in index.html: README: The page's folder) of under 100,000 bytes;
//   - on a reference Mac on mains power with Low Power Mode off and the thermal state nominal, five runs after a
//     warm-up, each a fresh `deep-show run` exporting the walkthrough at 1920 × 1080 and 30 fps: 24 states and between
//     100 and 150 edges ("about 120"), and the repo's `judgeLimit` finds the receipt's `timing.wall` under 240 s and the
//     bytes the export wrote under 250,000,000 in all five. Anywhere else, INCONCLUSIVE, never a pass.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, REPO, TIMEOUT, WALK_RATE, filesUnder, inconclusive, obj, pageExport, pageReceiptOf, present, presented, referenceMacProblem,
  runShow, scenarioOf, show, useShow, useTemp, walkthrough, type PageReceipt, type Size,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const CRITERION = '#169.e6c2fc38';

interface Benchmark {
  validateBudgets(current: unknown, base: unknown): void;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: { start: number; end: number }[] }): { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string };
}
const benchmark = () => import(join(REPO, 'scripts', 'benchmark.mjs')) as Promise<Benchmark>;

/** One export of the looping walkthrough at `size`: its receipt, the folder and the bytes it wrote. */
function exportWalk(size: Size, what: string): { receipt: PageReceipt; out: string; bytes: number } {
  const out = join(temp(), 'page');
  const r = runShow(shows(FULL), scenarioOf({ evidence: temp(), docs: [DOC.walk], calls: [present(DOC.walk, walkthrough({ loop: true })), pageExport(DOC.walk, out, { size, rate: WALK_RATE })] }), what);
  presented(r[0], `${what}: the walkthrough`);
  const receipt = pageReceiptOf(r[1], what);
  let bytes = 0;
  for (const b of filesUnder(out).values()) bytes += b.length;
  return { receipt, out, bytes };
}
/** The player's bytes: every file under `player/`, and the text of any script or style written inline in index.html. */
function playerBytes(out: string): { bytes: number; files: number } {
  let bytes = 0; let files = 0;
  for (const [path, b] of filesUnder(out)) if (path.startsWith('player/')) { bytes += b.length; files++; }
  const index = readFileSync(join(out, 'index.html'), 'utf8');
  for (const m of index.matchAll(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/gi)) bytes += Buffer.byteLength(m[2] ?? '', 'utf8');
  return { bytes, files };
}
async function judged(what: string, limit: number, runs: number[], loads: { start: number; end: number }[], unit: string): Promise<void> {
  const { fingerprint, judgeLimit } = await benchmark();
  const machine = fingerprint();
  const result = judgeLimit({ limit, runs, fingerprint: machine, loads });
  const reading = `${what}: ${runs.map((x) => x.toFixed(3)).join(', ')} ${unit} against ${limit} ${unit} on ${String(machine['model'])}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
  console.log(`${AC[5]} ${reading}`);
  expect(result.status, reading).not.toBe('BLOCKED');
  expect(result.status, reading).not.toBe('FAIL');
  if (result.status === 'INCONCLUSIVE') inconclusive(reading);
}

describe(`${AC[5]} budgets: the 24-state walkthrough at 1080p30 under 4 minutes and 250 MB, the player under 100 KB`, () => {
  it(`${AC[5]} the perf lane has a task naming ${CRITERION}, and the budgets are valid against the merge base's`, async () => {
    const { validateBudgets } = await benchmark();
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: { id: string; criteria?: string[]; initialReason?: string; changeReason?: string }[] };
    expect(current.tasks.some((t) => (t.criteria ?? []).includes(CRITERION) || `${t.initialReason ?? ''} ${t.changeReason ?? ''}`.includes(CRITERION)), `benchmarks/budgets.json has a task naming ${CRITERION}`).toBe(true);
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
  }, TIMEOUT);

  it(`${AC[5]} the walkthrough's page carries a player under 100 KB (on any machine)`, () => {
    const { out } = exportWalk([320, 180], 'the walkthrough page at 320 × 180');
    const p = playerBytes(out);
    console.log(`${AC[5]} the player: ${p.bytes} bytes in ${p.files} files under player/ and inline`);
    expect(p.files, 'the page holds its player under player/').toBeGreaterThan(0);
    expect(p.bytes, `the player is under 100,000 bytes: ${p.bytes}`).toBeLessThan(100_000);
  }, TIMEOUT);

  it(`${AC[5]} on the reference Mac the walkthrough exports at 1080p30 in under 240 s and under 250,000,000 bytes (five runs after a warm-up)`, async () => {
    const problem = await referenceMacProblem(true);
    if (problem) inconclusive(`the budgets count only on a reference Mac in a fit state, so the runs aren't made here: ${problem}`);
    const once = (k: number): { wall: number; bytes: number } => {
      const what = `the walkthrough page at 1080p30, run ${k}`;
      const { receipt, bytes } = exportWalk([1920, 1080], what);
      expect(receipt.states, `${what}: 24 states`).toBe(24);
      expect(receipt.edges >= 100 && receipt.edges <= 150, `${what}: about 120 edges (100 to 150): ${receipt.edges}`).toBe(true);
      const timing = obj(receipt.raw['timing'], `${what}: receipt.timing`);
      const wall = timing['wall'];
      expect(typeof wall === 'number' && Number.isFinite(wall), `${what}: the receipt times the export: timing.wall ${show(wall ?? null)}`).toBe(true);
      return { wall: wall as number, bytes };
    };
    once(0);
    const walls: number[] = []; const bytes: number[] = []; const loads: { start: number; end: number }[] = [];
    for (let k = 1; k <= 5; k++) {
      const start = loadavg()[0]!;
      const r = once(k);
      walls.push(r.wall); bytes.push(r.bytes); loads.push({ start, end: loadavg()[0]! });
    }
    await judged('the walkthrough page at 1080p30, from the command to the folder', 240, walls, loads, 's');
    await judged('the bytes the walkthrough page wrote', 250, bytes.map((b) => b / 1e6), loads, 'MB');
  }, TIMEOUT);
});
