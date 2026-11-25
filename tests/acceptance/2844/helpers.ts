// Test-side tools for the #2844 acceptance tests. The builds of the checkout's binaries, the INCONCLUSIVE rule and the
// failure lists come from ../467/helpers.ts by import, and the merge base's tree and binaries from ../2031/helpers.ts,
// as #2032's suite takes them. This file adds what criterion 2 needs: which files #2031's and #2032's suites are at the
// merge base and whether the checkout holds them byte for byte; a run of those files, unchanged, through the checkout's
// own vitest with recorder.mjs standing where they find their binaries; and the comparison of what each call drew with
// what the merge base draws for the same request. Nothing here draws a frame or stands in for the renderer.
// README: How a frame is enumerated.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO } from '../467/helpers.ts';

export { failsNaming, inconclusive, none, requireMetal, useBin } from '../467/helpers.ts';
export { useMergeBase } from '../2031/helpers.ts';

/** The two suites the criterion names, as folders from the checkout root. */
const SUITES = ['tests/acceptance/2031', 'tests/acceptance/2032'] as const;
/**
 * The wrong programs the base already holds for `deep-gpu run --planted` whose window the suites draw: #2031's four and
 * #2032's five. Each moves a pixel of a lit or shadowed group (their READMEs: Planted programs).
 */
export const PLANTS = [
  'light_linear_falloff', 'light_encoded_sum', 'light_default_ambient_zero', 'light_every_child',
  'shadow_bounding_boxes', 'sun_far_point_light', 'shadow_inside_outline', 'shadow_removes_ambient', 'shadow_edge_aliased',
] as const;
/** The two budget files: their frames count, their timing verdict is not this criterion's (README: Readings). */
const BUDGET = /\/ac8-budget\.test\.ts$/;

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------------------------------
// The suites at the merge base, and "unchanged"

/** Every file under `dir` of the tree at `root`, as paths from `root`; what a tool leaves in `node_modules` is no suite file. */
function filesUnder(root: string, dir: string): string[] {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const path = `${dir}/${e.name}`;
    if (e.name === 'node_modules') return [];
    return e.isDirectory() ? filesUnder(root, path) : [path];
  });
}
/** The paths under `tests/` a TypeScript file imports by a relative path. */
function imported(path: string, source: string): string[] {
  return [...source.matchAll(/(?:\bfrom|\bimport\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)]
    .map((m) => posix.normalize(posix.join(posix.dirname(path), m[1]!))).filter((p) => p.startsWith('tests/'));
}
/**
 * The suites as the merge base's tree `src` holds them: their test files, and every file a run of them reads from the
 * tree (each file of the two folders, and the helpers their TypeScript imports from other suites, followed to the end).
 */
function suiteFiles(src: string): { tests: string[]; held: string[] } {
  const own = SUITES.flatMap((s) => filesUnder(src, s));
  const held = new Set(own);
  const queue = own.filter((p) => p.endsWith('.ts'));
  for (let i = 0; i < queue.length; i++) {
    for (const p of imported(queue[i]!, readFileSync(join(src, queue[i]!), 'utf8'))) {
      if (held.has(p) || !existsSync(join(src, p)) || !statSync(join(src, p)).isFile()) continue;
      held.add(p);
      if (p.endsWith('.ts')) queue.push(p);
    }
  }
  return { tests: own.filter((p) => p.endsWith('.test.ts')).sort(), held: [...held].sort() };
}
/** Each way the checkout's suites differ from the merge base's: a held file gone or with other bytes, or a file added. */
function changedFiles(src: string, held: string[]): string[] {
  const changed: string[] = [];
  for (const path of held) {
    const there = readFileSync(join(src, path));
    if (!existsSync(join(REPO, path))) changed.push(`${path} is gone; the merge base holds it (SHA-256 ${sha256(there)})`);
    else if (!readFileSync(join(REPO, path)).equals(there)) changed.push(`${path} changed: its SHA-256 is ${sha256(readFileSync(join(REPO, path)))}, the merge base's ${sha256(there)}`);
  }
  for (const path of SUITES.flatMap((s) => filesUnder(REPO, s))) if (!held.includes(path)) changed.push(`${path} is new: the merge base's suite doesn't hold it`);
  return changed;
}

// ---------------------------------------------------------------------------------------------------
// The run of the suites under the recorder

/** Frames by name: `png <SHA-256>`, `pixel_hash <hash>`, `code <code> <path>` or `failed: …` (recorder.mjs). */
type Frames = Record<string, string>;
/** One call of `deep-gpu` or `deep-canvas-render` a suite file made, as recorder.mjs wrote it down. */
export interface Call {
  file: string; seq: number; role: 'head' | 'base'; bin: string; sub: string; planted: string | null; draws: boolean; exit: string; ms: number;
  /** For a call that draws: each request's verb, what this call drew, and for the checkout's binary what the merge base draws. */
  verbs?: string[]; frames?: Frames; base?: Frames; baseMs?: number; error?: string;
}
/** One test of a suite as its run reported it. */
interface Ran { file: string; name: string; status: string; message: string }
export interface Run {
  rev: string;
  /** The suites' test files at the merge base. */
  files: string[];
  /** Each way the checkout's suites differ from the merge base's. */
  changed: string[];
  tests: Ran[];
  calls: Call[];
  /** What kept the run from being a run of every file with every call recorded. */
  problems: string[];
  seconds: number;
}
interface Report { testResults?: { name: string; status: string; message?: string; assertionResults?: { ancestorTitles: string[]; title: string; status: string; failureMessages?: string[] }[] }[] }
interface Bins { canvas: string; gpu: string }

const VITEST = join(REPO, 'node_modules', 'vitest', 'vitest.mjs');
const RECORDER = fileURLToPath(new URL('./recorder.mjs', import.meta.url));
const quoted = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;
/** What a failure says: its message's first lines, without the stack under it. */
function said(failure: string): string {
  const lines = failure.split('\n');
  const stack = lines.findIndex((l) => /^\s+at /.test(l));
  return lines.slice(0, stack < 0 ? lines.length : stack).filter(Boolean).slice(0, 6).join(' / ');
}

/**
 * Runs each test file of the two suites with the checkout's own vitest, one file a process, as the file is: its own
 * timeouts and its own judgements. Two things differ from a run by hand, and neither is in the suites' files. `cargo` on
 * the run's PATH is recorder.mjs, which builds nothing: `head` and `base` are already built, by the suites' own command.
 * And the binaries each file copies out of its target folder are recorder.mjs, which runs the real one, hands its
 * answer on untouched and writes down what was drawn, with what the merge base draws for the same request.
 * The merge base's tree `src` stands where #2031's `useMergeBase` keeps it, so the two AC7 files export nothing again.
 */
export function runSuites(o: { rev: string; src: string; head: Bins; base: Bins }): Run {
  const { tests: files, held } = suiteFiles(o.src);
  const run: Run = { rev: o.rev, files, changed: changedFiles(o.src, held), tests: [], calls: [], problems: [], seconds: 0 };
  for (const s of SUITES) if (!files.some((f) => f.startsWith(`${s}/`))) run.problems.push(`the merge base ${o.rev.slice(0, 12)} holds no test file under ${s}/`);
  const state = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2844-suites-')));
  const started = Date.now();
  try {
    const real = { head: { 'deep-gpu': o.head.gpu, 'deep-canvas-render': o.head.canvas }, base: { 'deep-gpu': o.base.gpu, 'deep-canvas-render': o.base.canvas } };
    writeFileSync(join(state, 'config.json'), JSON.stringify({ node: process.execPath, recorder: RECORDER, real }));
    for (const d of ['path', 'scratch', 'base-frames']) mkdirSync(join(state, d));
    writeFileSync(join(state, 'path', 'cargo'), `#!/bin/sh\nexec ${quoted(process.execPath)} ${quoted(RECORDER)} cargo ${quoted(state)} "$@"\n`, { mode: 0o755 });
    // The inner run is a run of its own: none of this run's vitest variables, nor the proof lanes' reporter.
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST') && k !== 'DEEP_PROOF_VITEST_REPORT'));
    files.forEach((file, k) => {
      const own = join(state, 'files', String(k));
      const kept = join(own, 'target', 'acceptance-2031-base');
      mkdirSync(kept, { recursive: true });
      mkdirSync(join(own, 'calls'));
      symlinkSync(o.src, join(kept, `src-${o.rev.slice(0, 12)}`));
      const report = join(own, 'report.json');
      const env: NodeJS.ProcessEnv = { ...inherited, PATH: `${join(state, 'path')}${delimiter}${process.env['PATH'] ?? ''}`, CARGO_TARGET_DIR: join(own, 'target') };
      const done = spawnSync(process.execPath, [VITEST, 'run', '--no-file-parallelism', '--reporter=json', `--outputFile.json=${report}`, file], {
        cwd: REPO, env, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 2 * 3_600_000, killSignal: 'SIGKILL',
      });
      if (done.error) run.problems.push(`${file}: its run ${(done.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? 'did not finish within 2 hours' : `could not start: ${done.error.message}`}`);
      const reported = (existsSync(report) ? (JSON.parse(readFileSync(report, 'utf8')) as Report).testResults ?? [] : []).map((f) => ({ ...f, path: relative(realpathSync(REPO), realpathSync(f.name)) }));
      const mine = reported.filter((f) => f.path === file);
      if (!mine.length) run.problems.push(`${file} did not run: vitest reports nothing of it (exit ${String(done.status)}); its output ends:\n${`${done.stdout ?? ''}\n${done.stderr ?? ''}`.trim().slice(-1500)}`);
      // vitest takes the path as a filter: a file of the same name elsewhere, were the runner's config to take one in, would run too.
      for (const f of reported) if (f.path !== file) run.problems.push(`${file}: its run also ran ${f.path}, whose calls can't be told from its own`);
      for (const f of mine) {
        const results = f.assertionResults ?? [];
        if (f.status === 'failed' && !results.some((t) => t.status === 'failed')) run.problems.push(`${file} failed outside its tests: ${(f.message ?? '').split('\n')[0] ?? ''}`);
        for (const t of results) run.tests.push({ file, name: [...t.ancestorTitles, t.title].join(' › '), status: t.status, message: said(t.failureMessages?.[0] ?? '') });
      }
      const made = readdirSync(join(own, 'calls')).sort().map((name, i): Call => ({ ...(JSON.parse(readFileSync(join(own, 'calls', name), 'utf8')) as Omit<Call, 'file' | 'seq'>), file, seq: i + 1 }));
      if (!made.length) run.problems.push(`${file}: no call of deep-gpu or deep-canvas-render reached the recorder, so the frames it draws can't be listed`);
      for (const c of made) if (c.error !== undefined) run.problems.push(`${file}: the recorder could not read call ${c.seq} (${c.bin} ${c.sub}): ${c.error.slice(0, 600)}`);
      run.calls.push(...made);
    });
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
  run.seconds = Math.round((Date.now() - started) / 1000);
  return run;
}

// ---------------------------------------------------------------------------------------------------
// Judging

/** The frames of a call that are not the merge base's, each naming its file, its request and what differs. */
export function differences(c: Call): string[] {
  const here = c.frames ?? {}; const there = c.base ?? {};
  const under = c.planted === null ? '' : `, drawn under --planted ${c.planted}`;
  return [...new Set([...Object.keys(here), ...Object.keys(there)])].flatMap((name) => (here[name] === there[name] ? []
    : [`${c.file}: ${name}${under}: ${here[name] ?? 'nothing'} where the merge base has ${there[name] ?? 'nothing'}`]));
}
/** Whether a frame is a picture or a frame's hash, not a refusal or a failed run. */
export const isPicture = (frame: string): boolean => !/^(code|failed)\b/.test(frame);
/**
 * The suites' tests by outcome. A test of theirs that can't be judged here (its own `INCONCLUSIVE:`) is `unjudged`,
 * any other that didn't pass is `failed`, and the tests of the two budget files are `aside` whatever they say.
 */
export function outcomes(tests: Ran[]): { passed: number; failed: string[]; unjudged: string[]; aside: string[] } {
  const failed: string[] = []; const unjudged: string[] = []; const aside: string[] = []; let passed = 0;
  for (const t of tests) {
    const at = `${t.file} › ${t.name.slice(0, 200)}`;
    if (BUDGET.test(t.file)) aside.push(`${at}: ${t.status}${t.message ? ` (${t.message.slice(0, 300)})` : ''}`);
    else if (t.status === 'passed') passed++;
    else if (t.status === 'failed' && /^\S*Error: INCONCLUSIVE:/.test(t.message)) unjudged.push(`${at}: ${t.message.slice(0, 400)}`);
    else if (t.status === 'failed') failed.push(`${at} fails: ${t.message.slice(0, 900)}`);
    else failed.push(`${at} did not run (${t.status})`);
  }
  return { passed, failed, unjudged, aside };
}
