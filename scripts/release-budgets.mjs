#!/usr/bin/env node
// Release budgets against the last release (#41): every recorded budget task runs on the release candidate and on the
// last release, rounds alternated so both see the same load, and a task fails when its p50 rose more than the release
// margin, named with both commits. This catches what per-change merge-base margins let through, such as a projection
// rebuild that got 30% slower in steps each within its own margin.
//   node scripts/release-budgets.mjs --candidate <sha> [--last-release <sha>] [--tasks a,b] [--rounds n] [--repo <dir>]
// A task that prints a JSON object as its last stdout line is judged on the p50 of each number it reports (hook
// overhead, idle CPU); one that prints none is judged on its wall time's p50. With no --last-release the last release
// is the release/<version> tag with the highest version; with none, nothing is measured and the run fails.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureOnce, prepareCopy } from './benchmark.mjs';

const flag = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const repo = flag('repo') ?? fileURLToPath(new URL('..', import.meta.url));
const rounds = Number(flag('rounds') ?? 20);
const only = flag('tasks')?.split(',').filter(Boolean);
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).trim();

const refuse = (why) => {
  console.log(`FAIL release budgets: ${why}`);
  process.exit(1);
};
if (!flag('candidate')) refuse('usage: release-budgets.mjs --candidate <sha> [--last-release <sha>] [--tasks a,b] [--rounds n] [--repo <dir>]');
if (!(rounds >= 1)) refuse(`--rounds ${flag('rounds')} is not a number of rounds`);
const candidate = git('rev-parse', `${flag('candidate')}^{commit}`);

/** The release/<version> tag with the highest version, parts compared as numbers. */
function lastRelease() {
  const parts = (tag) => tag.slice('release/'.length).split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const newer = (a, b) => {
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === y[i]) continue;
      if (x[i] === undefined) return false;
      if (y[i] === undefined) return true;
      return typeof x[i] === 'number' && typeof y[i] === 'number' ? x[i] > y[i] : String(x[i]) > String(y[i]);
    }
    return false;
  };
  const tags = git('tag', '--list', 'release/*').split('\n').filter((t) => /^release\/\d/.test(t));
  if (!tags.length) return null;
  const tag = tags.reduce((best, t) => (newer(t, best) ? t : best));
  return { tag, sha: git('rev-parse', `${tag}^{commit}`) };
}
const last = flag('last-release') ? { tag: null, sha: git('rev-parse', `${flag('last-release')}^{commit}`) } : lastRelease();
if (!last) refuse('there is no last release: no release/<version> tag, and no --last-release; nothing was measured');

const work = mkdtempSync(join(tmpdir(), 'deep-release-budgets-'));
process.env.CARGO_TARGET_DIR ??= join(work, 'target');
mkdirSync(process.env.CARGO_TARGET_DIR, { recursive: true });
/** The commit's own tree, exported and made ready to run in as perf makes its copies. */
function tree(sha, name) {
  const dir = join(work, name);
  mkdirSync(dir);
  execFileSync('sh', ['-c', `git -C "$1" archive "$2" | tar -x -C "$3"`, 'sh', repo, sha, dir], { stdio: ['ignore', 'ignore', 'pipe'] });
  prepareCopy(dir);
  return dir;
}

/** Each number the run reported in its last stdout line that is a JSON object, or its wall time when none. */
function readings(result) {
  const lastLine = result.output.trim().split('\n').filter((l) => l.trim().startsWith('{')).at(-1);
  try {
    const reported = Object.entries(JSON.parse(lastLine ?? '')).filter(([, v]) => typeof v === 'number' && Number.isFinite(v));
    if (reported.length) return Object.fromEntries(reported);
  } catch { /* no report: judged on wall time */ }
  return { wallMs: result.elapsedMs };
}
const p50 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length / 2) - 1];

let failed = false;
try {
  const now = tree(candidate, 'candidate');
  const then = tree(last.sha, 'last-release');
  const budgets = JSON.parse(readFileSync(join(now, 'benchmarks/budgets.json'), 'utf8'));
  const margin = budgets.release?.margin;
  if (!(typeof margin === 'number' && margin >= 0)) refuse('benchmarks/budgets.json sets no release.margin');
  const before = new Map(JSON.parse(readFileSync(join(then, 'benchmarks/budgets.json'), 'utf8')).tasks.map((t) => [t.id, t]));
  const tasks = budgets.tasks.filter((t) => !only || only.includes(t.id));
  for (const id of only ?? []) if (!tasks.some((t) => t.id === id)) refuse(`no recorded budget task ${id}`);
  const names = `${candidate.slice(0, 12)} (candidate) and ${last.sha.slice(0, 12)} (last release${last.tag ? ` ${last.tag}` : ''})`;
  for (const task of tasks) {
    const old = before.get(task.id);
    if (!old) {
      console.log(`NEW ${task.id}: not in the last release, so nothing to compare with`);
      continue;
    }
    const sides = [[task.command, now], [old.command, then]];
    const samples = [[], []];
    // One untimed round, then the timed rounds, the two sides alternated.
    for (let round = 0; round <= rounds; round++) {
      sides.forEach(([command, cwd], side) => {
        const result = measureOnce(command, cwd, false, undefined, false);
        if (result.status !== 0) throw Error(`${task.id} exited ${result.status} on ${side ? last.sha : candidate}: ${result.output.slice(-2000)}`);
        if (round) samples[side].push(readings(result));
      });
    }
    const worse = Object.keys(samples[0][0]).filter((key) => key in samples[1][0]).map((key) => {
      const [c, l] = samples.map((side) => p50(side.map((s) => s[key])));
      return { key, c, l, rose: l > 0 ? c / l - 1 : 0 };
    });
    const over = worse.filter((w) => w.rose > margin);
    for (const w of over) console.log(`FAIL ${task.id}: p50 ${w.key} ${w.c.toFixed(2)} on ${candidate} rose ${(w.rose * 100).toFixed(1)}% over ${w.l.toFixed(2)} on ${last.sha}, beyond the release margin of ${(margin * 100).toFixed(0)}%`);
    if (over.length) failed = true;
    else console.log(`PASS ${task.id}: p50 within ${(margin * 100).toFixed(0)}% of the last release on ${worse.map((w) => w.key).join(', ')}, comparing ${names}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
