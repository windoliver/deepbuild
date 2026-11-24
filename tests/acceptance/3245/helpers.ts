// Test-side tools for the #3245 acceptance tests: the surface README declares (types only), a fixture repo, an archive
// of past Claude Code sessions, and the launcher the eval is given: scripted agents and a scripted judge, which stand
// in for the only thing the eval doesn't own. The eval, the comparison rule, the archive reader, the plan makers, the
// record and the evidence store are the repo's own. Nothing here calls a model, the network or a sign-in.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { runEval } from '../../../packages/config-eval/src/index.ts';
import type { AgentResult, AgentRun, EvalOptions, EvalReport, Grade, JudgeRequest, Launcher, ReplayTask } from '../../../packages/config-eval/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord, ulid } from '../../../packages/record/src/index.ts';
import type { ReplayPlan } from '../../../packages/record/src/index.ts';

// The eval and the archive reader run git with this process's environment: none of it may name another repo.
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete process.env[key];

// ---- Criterion IDs: `#3245.` and the first 8 hex of SHA-256 of the criterion's text, trimmed, whitespace collapsed.
export const AC1 = '#3245.8d415edc';
export const AC2 = '#3245.89bedf9f';
export const AC3 = '#3245.f49a2718';
export const AC4 = '#3245.03f250e0';
export const AC5 = '#3245.ee666719';
export const AC6 = '#3245.e9a302e8';
export const AC7 = '#3245.3e193e65';
export const AC8 = '#3245.fb376f22';

// ---- The surface README declares, over the base's shapes.
export type Side = 'base' | 'change';
export type Plan = ReplayPlan & { words?: string[] };
export interface Oversize { task: string; side: Side; repeat: number; size: number; cap: number }
export interface Control { request: JudgeRequest; right: number | null; none: number | null }
export type Report = EvalReport & { words?: string[]; oversize?: Oversize[]; control?: Control };
/** runEval, or a planted wrong program around it. */
export type Eval = (options: EvalOptions) => Promise<EvalReport>;
/** A fact of the base: the most of an output's text, in characters, a judge is shown. */
export const CAP = 20_000;
export const JUDGE = 'gpt-reserve';

// ---- A fixture repo.
const HOUR = 3_600_000;
/** Monday 2026-10-05 09:00 UTC. */
export const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);
export const CUTOFF = T0 + 240 * HOUR;
const roots: string[] = [];
export function removeRoots(): void {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
}
/** Before every session of the archive. */
const DATE = '2026-09-01T10:00:00Z';
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=Shop Dev', '-c', 'user.email=dev@shop.test', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
    cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_DATE: DATE, GIT_COMMITTER_DATE: DATE }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 2 ** 26,
  });
/** The instruction file of each side, told apart by one word. */
const GUIDE: Record<Side, string> = { base: '# Shop\n\nAnswer in the kestrel style.\n', change: '# Shop\n\nAnswer in the osprey style.\n' };

export interface World { dir: string; repo: string; commit: string; root: string; home: string }
export function world(): World {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dh3245-')));
  roots.push(dir);
  const repo = join(dir, 'repos', 'shop');
  const files: Record<string, string> = { 'CLAUDE.md': GUIDE.base, 'src/cart.js': 'export const total = (items) => items.reduce((s, i) => s + i.price, 0);\n' };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), text);
  }
  git(repo, 'init', '-q');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'A shop');
  const [root, home] = [join(dir, 'work'), join(dir, 'home')];
  for (const d of [root, home]) mkdirSync(d);
  return { dir, repo, commit: git(repo, 'rev-parse', 'HEAD').trim(), root, home };
}
/** `n` tasks after the cutoff, each asked in words no other task uses. */
export const tasksOf = (w: World, n: number): ReplayTask[] => Array.from({ length: n }, (_, i) => {
  const id = `t${String(i + 1).padStart(2, '0')}`;
  return { id, at: CUTOFF + (i + 1) * HOUR, repo: w.repo, commit: w.commit, prompt: `Ticket ${id.toUpperCase()}: make total() count each item's qty.` };
});
export const planOf = (tasks: ReplayTask[], over: Partial<Plan> = {}): Plan => ({
  id: 'trial-3245', cutoff: CUTOFF, tasks: tasks.map((t) => t.id), fitted: [],
  variants: { base: { name: 'as it is', files: { 'CLAUDE.md': GUIDE.base } }, change: { name: 'as it would be', files: { 'CLAUDE.md': GUIDE.change } } },
  models: { agent: 'claude-haiku-5-5', judge: JUDGE }, repeats: 1, measures: [{ name: 'grade', better: 'higher' }],
  rule: 'paired-mean-one-sided-95', budget: { ms: 2 * HOUR, plan_share: 0.5 }, ...over,
});

// ---- The scripted launcher.
/** What one run does: the files it writes, or a change of exactly this many characters, a commit of it, and its words. */
export interface Act { files?: Record<string, string>; chars?: number; commits?: true; reply: string }
export type Script = (task: string, side: Side) => Act;
/** One run: its reply, which opens with a marker no other run has, and, when its change was sized, the diff git prints. */
export interface Ran { task: string; side: Side; reply: string; marker: string; diff: string }
/** One judge request, and the task it is about; none is the control. */
export interface Judged { task?: string; request: JudgeRequest }
export interface Judge {
  /** The score of one output of a task's request. */
  score(text: string, task: string): number;
  /** The scores of the control: a side left out gets none; 'fails' is a judge that answers with an error. */
  control?: { right?: number; none?: number } | 'fails';
}
/** A judge that tells a change from none, and scores every run alike. */
export const PLAIN: Judge = { score: () => 0.5 };
export interface Stub { launcher: Launcher; ran: Ran[]; judged: Judged[]; trace: string[] }

/** Whether an output shows a change: a line of a git diff's header or hunk, or an added line. */
export const showsChange = (text: string): boolean => /^(?:diff --git |@@ |\+)/m.test(text);

/** Writes a file so that the run's diff, as git prints it, is exactly `chars` characters, and returns that diff. */
function sized(cwd: string, chars: number, marker: string): string {
  const start = git(cwd, 'rev-parse', 'HEAD').trim();
  const rows = Math.floor((chars - 1_000) / 100);
  const diff = (pad: number): string => {
    writeFileSync(join(cwd, 'src', 'prices.js'), `// ${marker}\n${`${'x'.repeat(98)}\n`.repeat(rows)}${'y'.repeat(pad)}\n`);
    git(cwd, 'add', '-A');
    return git(cwd, 'diff', '--cached', '--no-color', '--no-ext-diff', start);
  };
  return diff(1 + chars - diff(1).length);
}

export function stub(tasks: ReplayTask[], script: Script, judge: Judge = PLAIN): Stub {
  const s: Stub = { launcher: undefined as unknown as Launcher, ran: [], judged: [], trace: [] };
  s.launcher = {
    async work(run: AgentRun): Promise<AgentResult> {
      const task = tasks.find((t) => t.prompt === run.prompt)?.id ?? `(no task asked in ${JSON.stringify(run.prompt)})`;
      const side: Side = readFileSync(join(run.cwd, 'CLAUDE.md'), 'utf8').includes('osprey') ? 'change' : 'base';
      s.trace.push(`${task}'s ${side} run`);
      const act = script(task, side);
      const marker = `mark${randomBytes(8).toString('hex')}`;
      for (const [file, text] of Object.entries(act.files ?? {})) writeFileSync(join(run.cwd, file), text);
      const diff = act.chars === undefined ? '' : sized(run.cwd, act.chars, marker);
      if (act.commits) {
        git(run.cwd, 'add', '-A');
        git(run.cwd, 'commit', '-q', '-m', `Count each item's qty, all verified: ${marker}`);
      }
      const reply = `${marker}: ${act.reply}`;
      s.ran.push({ task, side, reply, marker, diff });
      return { ok: true, result: reply, usage: { input: 1_000, output: 200 } };
    },
    async judge(request: JudgeRequest): Promise<Grade[]> {
      // A task's request holds the words it was asked in; the control, the package's own, holds no task's.
      const task = tasks.find((t) => request.prompt.includes(t.prompt))?.id;
      s.judged.push({ ...(task ? { task } : {}), request: structuredClone(request) });
      s.trace.push(task ? `${task}'s judge request` : 'the control');
      if (task) return request.outputs.map((o) => ({ label: o.label, score: judge.score(o.text, task) }));
      const control = judge.control ?? { right: 0.9, none: 0.1 };
      if (control === 'fails') throw Error('the judge stopped with no answer');
      return request.outputs.flatMap((o) => {
        const score = showsChange(o.text) ? control.right : control.none;
        return score === undefined ? [] : [{ label: o.label, score }];
      });
    },
  };
  return s;
}
export async function evaluate(w: World, plan: Plan, tasks: ReplayTask[], s: Stub, evalOf: Eval = runEval): Promise<Report> {
  return await evalOf({ plan, tasks, root: w.root, env: { HOME: w.home, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' }, launcher: s.launcher }) as Report;
}
export const outputsFor = (s: Stub, task: string): string[] => s.judged.filter((j) => j.task === task).flatMap((j) => j.request.outputs.map((o) => o.text));
export const gradeOf = (r: Report, task: string, side: Side): number | null | undefined => r.runs.find((x) => x.task === task && x.side === side)?.metrics.grade;

// ---- What a wrong program gets wrong, one line each.
/** Each judge request that shows the words of a run of these tasks. */
export const repliesShown = (s: Stub, tasks: string[]): string[] => s.judged.flatMap((j, i) => s.ran
  .filter((r) => tasks.includes(r.task) && JSON.stringify(j.request).includes(r.marker))
  .map((r) => `judge request ${i + 1} (${j.task ?? 'the control'}) shows what ${r.task}'s ${r.side} run said`));
/** Each of these tasks one of whose runs' replies the judge wasn't shown. */
export const repliesHidden = (s: Stub, tasks: string[]): string[] => tasks.filter((t) => {
  const said = s.ran.filter((r) => r.task === t);
  return said.length < 2 || !said.every((r) => outputsFor(s, t).some((text) => text.includes(r.reply)));
}).map((t) => `${t} is graded on words, and the judge was shown ${JSON.stringify(outputsFor(s, t).map((x) => x.slice(0, 80)))}, not its replies`);
/** Why the eval's first judge request isn't a control that ran before any agent. */
export function controlProblems(s: Stub): string[] {
  const at = s.judged.findIndex((j) => !j.task);
  if (at === -1) return ['no judge request is the control'];
  const { outputs } = s.judged[at]!.request;
  const early = s.trace.slice(0, s.trace.indexOf('the control')).find((t) => t.endsWith(' run'));
  return [
    ...(early ? [`${early} started before the control`] : []),
    ...(at > 0 ? [`the control is judge request ${at + 1}, not the first`] : []),
    ...(outputs.length !== 2 || outputs.filter((o) => showsChange(o.text)).length !== 1 ? [`the control's outputs aren't a change and no change: ${JSON.stringify(outputs)}`] : []),
  ];
}

// ---- The planted wrong programs: each is the real eval, with one thing done wrong between it and its judge.
/** An eval that shows its judge each run's final reply over its change, as the merge base's does. */
export const showsTheReply: Eval = (o) => {
  const said = new Map<string, string[]>();
  return runEval({ ...o, launcher: {
    async work(run) {
      const result = await o.launcher!.work(run);
      said.set(run.prompt, [...(said.get(run.prompt) ?? []), result.result ?? '']);
      return result;
    },
    judge(request) {
      const replies = [...said].find(([asked]) => request.prompt.includes(asked))?.[1];
      return o.launcher!.judge(replies ? { ...request, outputs: request.outputs.map((x, k) => ({ ...x, text: `Final reply:\n${replies[k]}\n\nChanges:\n${x.text}` })) } : request);
    },
  } });
};
/** An eval that starts its agents on a control it hasn't asked for, and asks for it after them. */
export const controlsLast: Eval = async (o) => {
  let held: JudgeRequest | undefined;
  const report = await runEval({ ...o, launcher: {
    work: (run) => o.launcher!.work(run),
    async judge(request) {
      if (o.tasks.some((t) => request.prompt.includes(t.prompt))) return o.launcher!.judge(request);
      held = request;
      return request.outputs.map((x) => ({ label: x.label, score: showsChange(x.text) ? 0.9 : 0.1 }));
    },
  } });
  if (held) await o.launcher!.judge(held);
  return report;
};

// ---- An archive of past sessions, and the plan `config-eval.mjs plan` makes of it.
interface Call { tool: string; input: Record<string, unknown>; result: string; error?: true; detail?: unknown }
const bash = (command: string, stdout: string): Call => ({ tool: 'Bash', input: { command, description: 'Run it' }, result: stdout, detail: { stdout, stderr: '', interrupted: false, isImage: false, noOutputExpected: !stdout } });
/** What a past session did, by kind: its tool calls with their results as its transcript holds them. */
const KINDS: Record<string, { work: boolean; calls(repo: string): Call[] }> = {
  edit: { work: true, calls: (repo) => [
    { tool: 'Read', input: { file_path: `${repo}/src/cart.js` }, result: '1\texport const total' },
    { tool: 'Edit', input: { file_path: `${repo}/src/cart.js`, old_string: 'i.price', new_string: 'i.price * i.qty', replace_all: false }, result: `The file ${repo}/src/cart.js has been updated successfully.`, detail: { filePath: `${repo}/src/cart.js`, oldString: 'i.price', newString: 'i.price * i.qty', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }], userModified: false, replaceAll: false } },
  ] },
  read: { work: false, calls: (repo) => [
    { tool: 'Read', input: { file_path: `${repo}/src/cart.js` }, result: '1\texport const total' },
    { tool: 'Grep', input: { pattern: 'total', path: repo, output_mode: 'files_with_matches' }, result: 'Found 1 file\nsrc/cart.js' },
  ] },
  write: { work: true, calls: (repo) => [
    { tool: 'Write', input: { file_path: `${repo}/src/tax.js`, content: 'export const tax = 0.1;\n' }, result: `File created successfully at: ${repo}/src/tax.js`, detail: { type: 'create', filePath: `${repo}/src/tax.js`, content: 'export const tax = 0.1;\n', structuredPatch: [], originalFile: null, userModified: false } },
  ] },
  failed: { work: false, calls: (repo) => [
    { tool: 'Edit', input: { file_path: `${repo}/src/cart.js`, old_string: 'i.cost', new_string: 'i.price', replace_all: false }, result: '<tool_use_error>String to replace not found in file.\nString: i.cost</tool_use_error>', error: true, detail: 'Error: String to replace not found in file.\nString: i.cost' },
  ] },
  heredoc: { work: true, calls: () => [bash("cat > src/x.js <<'EOF'\nexport const x = 1;\nEOF", '')] },
  tests: { work: false, calls: () => [bash('npm test 2>&1 | tail -20', 'ok 1 - total'), bash('git log --oneline -5', 'abc1234 A shop')] },
  sed: { work: true, calls: () => [bash("sed -i '' 's/price/cost/' src/cart.js", '')] },
  none: { work: false, calls: () => [] },
};
/** One session's transcript, as Claude Code writes one: your message, each call with its result, and the last reply. */
function transcript(session: string, uuid: string, prompt: string, at: number, cwd: string, calls: Call[]): string {
  const common = { isSidechain: false, userType: 'external', cwd, sessionId: session, version: '2.1.308', gitBranch: 'main', timestamp: new Date(at).toISOString() };
  const said = (content: object[], stop_reason: string) => ({ ...common, type: 'assistant', uuid: randomBytes(8).toString('hex'), message: { model: 'claude-haiku-5-5', id: `msg_${uuid}`, type: 'message', role: 'assistant', content, stop_reason } });
  const lines: object[] = [{ parentUuid: null, ...common, type: 'user', uuid, promptSource: 'typed', message: { role: 'user', content: prompt } }];
  calls.forEach((call, i) => {
    const id = `toolu_${uuid}${i}`;
    lines.push(said([{ type: 'tool_use', id, name: call.tool, input: call.input }], 'tool_use'));
    lines.push({ ...common, type: 'user', uuid: randomBytes(8).toString('hex'), message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: call.result, ...(call.error ? { is_error: true } : {}) }] }, toolUseResult: call.detail ?? call.result });
  });
  lines.push(said([{ type: 'text', text: 'Done.' }], 'end_turn'));
  return lines.map((l) => `${JSON.stringify(l)}\n`).join('');
}
export interface Archived { id: string; kind: string; work: boolean; at: number }
/** Three rounds of one session of each kind, oldest first, in the home's own record and evidence store. */
export async function archive(w: World): Promise<Archived[]> {
  const store = join(w.home, '.deepbuild');
  mkdirSync(store);
  const evidence = await openEvidenceStore({ root: join(store, 'evidence') });
  const record = await openRecord({ path: join(store, 'ledger.db'), evidence, now: Date.now });
  const out: Archived[] = [];
  try {
    const kinds = Object.entries(KINDS);
    for (let i = 0; i < 3 * kinds.length; i++) {
      const [kind, { work, calls }] = kinds[i % kinds.length]!;
      const at = T0 + (i + 1) * HOUR, session = ulid(at), message = `m${i}`;
      const text = transcript(session, message, `Ticket S${i}: the cart total is wrong for order ${i}.`, at, w.repo, calls(w.repo));
      const kept = await record.keep({ writer: 'app', actor: 'you', scope: 'you' }, { bytes: Buffer.from(text), kind: 'transcript', source: 'claude-code' });
      await record.append({ writer: 'app', actor: 'you', scope: 'you' }, { v: 1, id: ulid(at), ts: at, kind: 'transcript.archived', data: { session: `session:${session}`, evidence: kept.slice(3) } });
      out.push({ id: `session:${session}#${message}`, kind, work, at });
    }
  } finally {
    await record.close();
  }
  return out;
}
/** The guide's change in the working tree, and the plan `config-eval.mjs plan` makes of it: the newest 8 sessions decide. */
export function plannedByScript(w: World, sessions: Archived[]): { plan: Plan; tasks: ReplayTask[] } {
  writeFileSync(join(w.repo, 'CLAUDE.md'), GUIDE.change);
  const out = join(w.dir, 'input.json');
  const script = fileURLToPath(new URL('../../../scripts/config-eval.mjs', import.meta.url));
  const cutoff = new Date(sessions.at(-9)!.at).toISOString();
  const r = spawnSync(process.execPath, [script, 'plan', '--cutoff', cutoff, '--base', 'HEAD', '--tasks', '8', '--fitted', '2', '--repeats', '1', '--out', out], {
    cwd: w.repo, encoding: 'utf8', env: { HOME: w.home, PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  expect(r.status, `config-eval.mjs plan makes a plan (${r.stdout}${r.stderr})`).toBe(0);
  return JSON.parse(readFileSync(out, 'utf8')) as { plan: Plan; tasks: ReplayTask[] };
}
export const sorted = (xs: readonly string[]): string[] => [...xs].sort();
