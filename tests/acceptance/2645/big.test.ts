// #2645 AC1 and AC2: one claim on a 100 MB Claude Code transcript whose newest TodoWrite call is in its last megabyte,
// made in a process of its own (probe/claim.mjs): the bytes it reads of the file, a count that holds on any machine,
// and how far it raises the resident memory of the process that makes it, a memory limit, which the perf lane's judge
// (scripts/benchmark.mjs judgeLimit) reads on five claims and passes only on a reference Mac in a fit state.
//
// The transcript is #2365's 100 MB one, written by #2365's own fixture (tests/acceptance/2365/probe/fixture.mjs, seed
// 2645): turns of a typed prompt, a Read call, its 20 to 60 kB tool result and an answer, turn 50's result one line of
// 2 MB. Into it this suite writes an older TodoWrite call at about 50 MB, the newest at about 99.1 MB, and, last, a
// typed prompt that names the tool and calls nothing. The newest call's items have characters above U+00FF.
import { spawn } from 'node:child_process';
import { appendFileSync, statSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { removeTemps as removeTwentyTemps } from '../20/helpers.ts';
import { baseNewestList } from './merge-base.ts';
import { canon, factsOf, fmt, must, projection, removeTemps, REPO, show, tempDir, todoCall, todoMention, todoResult, TODOS } from './helpers.ts';

const AC1 = 'AC1 #2645.b383ad27';
const AC2 = 'AC2 #2645.027eeba7';
const FIXTURE = join(REPO, 'tests/acceptance/2365/probe/fixture.mjs');
const PROBE = fileURLToPath(new URL('./probe/claim.mjs', import.meta.url));
/** The working folder the probe's claim names, which an open item's ID is scoped to. */
const CWD = '/tmp/dh2645-work/shop';
const SESSION = 'dh2645-long-session';
const OLDER = [
  { content: 'Sketch the tax table', status: 'pending', activeForm: 'Sketching the tax table' },
  { content: 'Read the old receipts', status: 'in_progress', activeForm: 'Reading the old receipts' },
];
const LIMIT_BYTES = 2_000_000;
const LIMIT_RISE = 16_000_000;

interface Probe { items: string[]; bytes: number | null; reads: { how: string; calls: number; bytes: number }[] | null; rssStart: number; rise: number; peakRss: number; ms: number; error: string | null; blocked?: string }
interface Long { path: string; size: number; at: number; expected: string[] }
let long: Long | undefined;
let home: string | undefined;

/** A node child of this test, its output once it ends with 0; stopped by its own PID at 10 minutes. */
function node(args: readonly string[]): Promise<string> {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^(CLAUDE|CODEX|DEEP_)/.test(key) && key !== 'NODE_OPTIONS' && key !== 'AI_AGENT') env[key] = value;
  env.HOME = home ??= tempDir('home');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (err += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 600_000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`BLOCKED: node ${args.map((a) => a.replace(REPO, '')).join(' ')} ended with ${code ?? signal}: ${err.slice(-1500)}`));
    });
  });
}
/** One claim in the probe; a probe that couldn't run one is BLOCKED. */
async function probe(transcript: string, flags: readonly string[]): Promise<Probe> {
  const out = await node(['--expose-gc', PROBE, transcript, ...flags]);
  let r: Probe;
  try { r = JSON.parse(out.trim().split('\n').at(-1) ?? '') as Probe; } catch { throw new Error(`BLOCKED: the probe printed no result: ${out.slice(-1500)}`); }
  if (r.blocked) throw new Error(`BLOCKED: ${r.blocked}`);
  return r;
}
const need = (): Long => {
  if (!long) throw new Error('BLOCKED: the 100 MB transcript was not written');
  return long;
};
const readsText = (r: Probe): string => (r.reads ?? []).map((x) => `${x.calls} ${x.how} of ${fmt(x.bytes)} bytes`).join(', ') || 'no read seen';

beforeAll(async () => {
  const path = join(tempDir('long'), `${SESSION}.jsonl`);
  await node([FIXTURE, 'write', path, '50000000', '2645']);
  appendFileSync(path, `${todoCall(SESSION, 'toolu_dh2645_older', OLDER)}\n${todoResult(SESSION, 'toolu_dh2645_older', OLDER)}\n`);
  await node([FIXTURE, 'append', path, String(99_100_000 - statSync(path).size)]);
  const at = statSync(path).size;
  appendFileSync(path, `${todoCall(SESSION, 'toolu_dh2645_newest', TODOS)}\n${todoResult(SESSION, 'toolu_dh2645_newest', TODOS)}\n`);
  const mention = `${todoMention(SESSION)}\n`;
  await node([FIXTURE, 'append', path, String(100_000_000 - statSync(path).size - Buffer.byteLength(mention))]);
  appendFileSync(path, mention);
  const size = statSync(path).size;
  if (size < 100_000_000 || size - at > 1_000_000) throw new Error(`BLOCKED: the transcript must be 100 MB with its newest call in its last megabyte: ${fmt(size)} bytes, the call ${fmt(size - at)} from the end`);
  // The merge base's list, read by the merge base's reader.
  const facts = factsOf('claude-code');
  const list = await baseNewestList(facts, path);
  if (canon(list) !== canon({ todos: TODOS })) throw new Error(`BLOCKED: the merge base's newest list in the transcript is not the planted call's: ${show(list)}`);
  long = { path, size, at, expected: projection(facts, list, CWD) };
}, 900_000);

afterAll(() => {
  removeTemps();
  removeTwentyTemps();
});

describe(`${AC1} ${AC2} a claim on a 100 MB Claude Code transcript whose newest task-list call is in its last megabyte`, () => {
  it(`${AC1} the claim reads at most 2,000,000 bytes of the transcript, counted in the process that makes it, and returns the merge base's list`, async () => {
    const fx = need();
    const r = await probe(fx.path, ['--reads']);
    if (r.error) throw new Error(`${AC1} the claim failed: ${r.error}`);
    must(canon(r.items) === canon(fx.expected), `${AC1} the claim's open items are not those of the merge base's list, the TodoWrite call ${fmt(fx.size - fx.at)} bytes from the end: the merge base's ${show(fx.expected)}; the claim's ${show(r.items)}`);
    const bytes = r.bytes ?? 0;
    must(bytes <= LIMIT_BYTES, `${AC1} the claim read ${fmt(bytes)} bytes of the ${fmt(fx.size)}-byte transcript (${readsText(r)}), whose newest TodoWrite call starts ${fmt(fx.size - fx.at)} bytes from its end: at most ${fmt(LIMIT_BYTES)} may be read`);
    if (bytes < fx.size - fx.at) throw new Error(`INCONCLUSIVE: ${AC1} the read counter saw ${fmt(bytes)} bytes (${readsText(r)}), fewer than the ${fmt(fx.size - fx.at)} from the newest call to the end that a reader returning its list must read: the claim read where the counter can't see, another thread or process, or a native addon`);
  }, 900_000);

  it(`${AC2} the same claim raises the resident memory of the process that makes it by under 16,000,000 bytes, five claims judged by the perf lane's judge`, async () => {
    const fx = need();
    const rises: number[] = [];
    const loads: { start: number; end: number }[] = [];
    const shown: string[] = [];
    for (let run = 0; run < 5; run++) {
      const start = loadavg()[0]!;
      const r = await probe(fx.path, []);
      const end = loadavg()[0]!;
      if (r.error) throw new Error(`${AC2} the claim failed: ${r.error}`);
      must(canon(r.items) === canon(fx.expected), `${AC2} the claim's open items are not those of the merge base's list: the merge base's ${show(fx.expected)}; the claim's ${show(r.items)}`);
      rises.push(r.rise);
      loads.push({ start, end });
      shown.push(`${fmt(r.rise)} (${fmt(r.rssStart)} to ${fmt(r.peakRss)} in ${fmt(Math.round(r.ms))} ms)`);
    }
    // A memory budget counts only on a reference Mac in a fit state (design: The reference Macs): the perf lane's judge.
    const bench = (await import(pathToFileURL(join(REPO, 'scripts/benchmark.mjs')).href)) as { fingerprint: () => unknown; judgeLimit: (o: { limit: number; runs: number[]; fingerprint: unknown; loads: { start: number; end: number }[] }) => { status: string; reason?: string } };
    const judged = bench.judgeLimit({ limit: LIMIT_RISE, runs: rises, fingerprint: bench.fingerprint(), loads });
    const said = `five claims on the ${fmt(fx.size)}-byte transcript, each in a process of its own, raised its resident memory by ${shown.join(', ')} bytes`;
    must(judged.status !== 'FAIL', `${AC2} ${said}: all five over ${fmt(LIMIT_RISE)} (${judged.reason ?? ''})`);
    if (judged.status !== 'PASS') throw new Error(`${judged.status}: ${AC2} ${said}; ${judged.reason ?? ''}. This is not a pass`);
  }, 1_800_000);
});
