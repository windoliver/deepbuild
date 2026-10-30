#!/usr/bin/env node
// Configuration evals (#112), on your machine: a change to instruction files, skills or hooks is replayed on real
// past tasks from your transcript archive before it lands. It spends plan usage, so it never runs on its own and never
// in hosted CI; the local preflight's gate only reads the report a run you started left.
//   node scripts/config-eval.mjs plan --cutoff <date> [--base <ref>] [--tasks 20] [--fitted 4] [--repeats 3]
//        [--agent claude-haiku-5-5] [--judge gpt-reserve] [--minutes 110] [--share 0.5] [--out <input.json>]
//   node scripts/config-eval.mjs run <input.json>
//   node scripts/config-eval.mjs gate
// plan freezes a plan: the change's files at the merge base against the working tree, the newest tasks of this repo
// from after the cutoff (and a few from before it, reported but never deciding). run replays it and keeps the report
// under ~/.deepbuild/evals/, by the digest of the two variants. gate reads that report for the change as it is now:
// none is BLOCKED, a regression FAIL with the tasks it broke. Exit codes: 0 pass, 1 held, blocked or failed, 2 usage,
// 3 refused.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/**
 * What the eval replays a change of: instruction files at any depth, skills, and the agents' settings and hooks. The
 * config eval lane in scripts/lanes.mjs runs for a change to them.
 */
export const inputs = (file) => /(^|\/)(CLAUDE|AGENTS)\.md$/.test(file) || /^(skills|\.claude|\.codex)\//.test(file);
/** Words that would tell an agent it is being evaluated: a task whose own words hold one isn't replayed. */
const MARKS = /eval|replay|judge|variant|bench|experiment/i;

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 2 ** 28, stdio: ['ignore', 'pipe', 'pipe'] });
const tryGit = (cwd, ...args) => { try { return git(cwd, ...args).trim(); } catch { return undefined; } };
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v));
const evals = () => join(homedir(), '.deepbuild', 'evals');

/** The change's configuration files at the merge base and now, or why they can't be replayed. */
function variantsOf(cwd, base) {
  const top = git(cwd, 'rev-parse', '--show-toplevel').trim();
  const from = base ?? tryGit(top, 'merge-base', 'HEAD', 'origin/main');
  if (!from) return { why: 'no merge base with origin/main; name one with --base' };
  const changed = [...git(top, 'diff', '--name-only', '-z', '--no-renames', from).split('\0'), ...git(top, 'ls-files', '-z', '--others', '--exclude-standard').split('\0')]
    .filter((f) => f && inputs(f)).sort();
  const files = { base: {}, change: {} };
  for (const file of new Set(changed)) {
    const now = join(top, file);
    if (!existsSync(now)) return { why: `${file} is deleted, and a replay writes files over a checkout, so it can't take one away` };
    const was = tryGit(top, 'cat-file', '-e', `${from}:${file}`) === undefined ? undefined : git(top, 'show', `${from}:${file}`);
    if (was !== undefined) files.base[file] = was;
    files.change[file] = readFileSync(now, 'utf8');
  }
  const digest = createHash('sha256').update(canonical(files)).digest('hex');
  return { top, from, changed: [...new Set(changed)], files, digest };
}
const commonDir = (cwd) => { const d = tryGit(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'); return d ? resolve(d) : undefined; };

async function plan(args) {
  const { values } = parseArgs({ args, options: {
    cutoff: { type: 'string' }, base: { type: 'string' }, tasks: { type: 'string', default: '20' }, fitted: { type: 'string', default: '4' }, repeats: { type: 'string', default: '3' },
    agent: { type: 'string', default: 'claude-haiku-5-5' }, judge: { type: 'string', default: 'gpt-reserve' }, minutes: { type: 'string', default: '110' }, share: { type: 'string', default: '0.5' }, out: { type: 'string' },
  } });
  const cutoff = Date.parse(values.cutoff ?? '');
  if (!Number.isFinite(cutoff)) return usage('plan needs --cutoff <date>: when the sessions the change was learned from end');
  const v = variantsOf(process.cwd(), values.base);
  if (v.why) { console.log(`BLOCKED config eval: ${v.why}`); return 1; }
  if (!v.changed.length) { console.log('PASS config eval: the change touches no instruction file, skill or hook'); return 0; }
  const { openEvidenceStore } = await import('@deepbuild/evidence');
  const { openRecordReader } = await import('@deepbuild/record');
  const { archivedTasks } = await import('@deepbuild/config-eval');
  const root = join(homedir(), '.deepbuild');
  const evidence = await openEvidenceStore({ root: join(root, 'evidence'), readOnly: true });
  const reader = openRecordReader({ path: join(root, 'ledger.db'), evidence });
  const ours = commonDir(v.top);
  // A removed worktree's sessions are read in the repo's main checkout, the folder that holds its .git.
  const main = ours && basename(ours) === '.git' ? dirname(ours) : v.top;
  let found;
  try { found = await archivedTasks(reader, (sha) => evidence.read(sha), main); } finally { reader.close(); }
  const left = [];
  const mine = found.tasks.filter((t) => {
    if (commonDir(t.repo) !== ours) return false;
    if (MARKS.test(t.prompt)) { left.push(`${t.id}: its words would tell its agent it is in an eval`); return false; }
    return true;
  });
  const after = mine.filter((t) => t.at > cutoff).sort((a, b) => b.at - a.at).slice(0, Number(values.tasks));
  const before = mine.filter((t) => t.at <= cutoff).sort((a, b) => b.at - a.at).slice(0, Number(values.fitted));
  for (const line of left) console.log(`left out ${line}`);
  if (after.length < Number(values.tasks)) {
    console.log(`BLOCKED config eval: the archive holds ${after.length} tasks of this repo from after ${new Date(cutoff).toISOString()}, and the plan asks for ${values.tasks}\n  Fix: Pick an earlier --cutoff, or fewer --tasks (20 to 50).`);
    return 1;
  }
  const input = {
    plan: {
      id: `config-${v.digest.slice(0, 12)}`, cutoff, tasks: after.map((t) => t.id), fitted: before.map((t) => t.id),
      variants: { base: { name: `at ${v.from.slice(0, 12)}`, files: v.files.base }, change: { name: 'working tree', files: v.files.change } },
      models: { agent: values.agent, judge: values.judge }, repeats: Number(values.repeats), measures: [{ name: 'grade', better: 'higher' }],
      rule: 'paired-mean-one-sided-95', budget: { ms: Number(values.minutes) * 60_000, plan_share: Number(values.share) },
    },
    tasks: [...after, ...before],
  };
  const out = values.out ?? join(evals(), `${v.digest}.input.json`);
  mkdirSync(join(out, '..'), { recursive: true });
  writeFileSync(out, `${JSON.stringify(input, null, 2)}\n`);
  console.log(`plan ${input.plan.id}: ${after.length} tasks after the cutoff, ${before.length} before it, ${input.plan.repeats} repeats a side, over ${v.changed.join(', ')}\n${out}`);
  return 0;
}

async function run(args) {
  if (args.length !== 1) return usage('run takes the input file plan wrote');
  const input = JSON.parse(readFileSync(args[0], 'utf8'));
  const { runEval } = await import('@deepbuild/config-eval');
  const root = mkdtempSync(join(tmpdir(), 'dce-'));
  let report;
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEEP_EVAL_')));
    report = await runEval({ plan: input.plan, tasks: input.tasks, root, env });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const digest = createHash('sha256').update(canonical({ base: input.plan.variants.base.files, change: input.plan.variants.change.files })).digest('hex');
  mkdirSync(evals(), { recursive: true });
  const kept = join(evals(), `${digest}.json`);
  writeFileSync(kept, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.after.outcome} config eval: ${report.after.reason}\n  before the cutoff: ${report.before.outcome}; ${report.runs.length} runs in ${(report.usage.ms / 60_000).toFixed(1)} min, plan share ${report.usage.plan_share ?? 'unread'}\n${kept}`);
  return report.after.outcome === 'refused' ? 3 : report.held ? 1 : 0;
}

function gate() {
  const v = variantsOf(process.cwd());
  if (v.why) { console.log(`BLOCKED config eval: ${v.why}`); return 1; }
  if (!v.changed.length) { console.log('PASS config eval: the change touches no instruction file, skill or hook'); return 0; }
  const kept = join(evals(), `${v.digest}.json`);
  if (!existsSync(kept)) {
    console.log(`BLOCKED config eval: no replay of ${v.changed.join(', ')} as they are now (${kept})\n  Fix: node scripts/config-eval.mjs plan --cutoff <date> && node scripts/config-eval.mjs run ${join(evals(), `${v.digest}.input.json`)}`);
    return 1;
  }
  const report = JSON.parse(readFileSync(kept, 'utf8'));
  if (report.after.outcome === 'refused') { console.log(`BLOCKED config eval: its replay was refused: ${report.after.reason}`); return 1; }
  if (report.held) { console.log(`FAIL config eval: held, it broke ${report.after.broke.join(', ')}: ${report.after.reason}`); return 1; }
  console.log(`PASS config eval: ${report.after.outcome} on ${report.after.n} replayed tasks (${report.after.reason})`);
  return 0;
}

function usage(message) {
  console.error(`config-eval: ${message}\n  node scripts/config-eval.mjs plan --cutoff <date> [options] | run <input.json> | gate`);
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  process.exitCode = command === 'plan' ? await plan(rest) : command === 'run' ? await run(rest) : command === 'gate' ? gate() : usage(`unknown command ${command ?? '(none)'}`);
}
