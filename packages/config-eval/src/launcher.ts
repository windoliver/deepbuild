// The real agents under test and the real judge, on your plan: Claude Code for a `claude-*` model and Codex for a
// `gpt-*` one, each headless with its prompt on stdin, as the adapters' facts launch them (`launch.readOnlyJob`).
// The agent under test may edit files in its own checkout; the judge reads only what it is shown, in an empty folder.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReplayPlan } from '@deepbuild/record';
import type { AgentResult, Grade, JudgeRequest, Launcher } from './index.js';

/** One agent run may take this long, and never past the eval's deadline, before it is stopped and counted failed. */
const RUN_MS = 30 * 60_000;
type Cli = 'claude' | 'codex';
const cliOf = (model: string): Cli | undefined => (/^claude/.test(model) ? 'claude' : /^(gpt|o\d|codex)/.test(model) ? 'codex' : undefined);

/** After the CLI exits, how long its output may take to drain before what arrived is read. */
const DRAIN_MS = 2_000;
/**
 * Its stdout lines as JSON values, once it exits or its time is up. It runs in a process group of its own, so the
 * stop reaches the tools it started too; nothing else is stopped. A process outside the group that still holds its
 * output, such as a hook's helper, can't keep the run waiting: its exit and a short drain end it.
 */
function runCli(cli: Cli, args: string[], prompt: string, cwd: string, env: Record<string, string>, deadline: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, { cwd, env, stdio: ['pipe', 'pipe', 'ignore'], detached: true });
    let out = '';
    const stop = (signal: NodeJS.Signals) => { try { process.kill(-child.pid!, signal); } catch { /* the group is gone */ } };
    let hard: NodeJS.Timeout | undefined;
    let drain: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => { stop('SIGTERM'); hard = setTimeout(() => stop('SIGKILL'), 5_000); }, Math.max(0, Math.min(RUN_MS, deadline - Date.now())));
    const done = () => {
      for (const t of [timer, hard, drain]) clearTimeout(t);
      child.stdout.destroy();
      resolve(out.split('\n').flatMap((line) => { try { return [JSON.parse(line) as unknown]; } catch { return []; } }));
    };
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString('utf8'); });
    child.on('error', (error) => { for (const t of [timer, hard, drain]) clearTimeout(t); reject(error); });
    child.on('exit', () => { drain = setTimeout(done, DRAIN_MS); });
    child.on('close', done);
    child.stdin.end(prompt);
  });
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The run's final reply and the tokens it reported, read from the CLI's JSON lines. */
export function resultOf(cli: Cli, lines: unknown[]): AgentResult {
  if (cli === 'claude') {
    const end = lines.filter(isObj).findLast((l) => l.type === 'result');
    if (!end || end.is_error === true || end.subtype !== 'success') return { ok: false };
    const u = isObj(end.usage) ? end.usage : undefined;
    return {
      ok: true, result: typeof end.result === 'string' ? end.result : '',
      ...(u ? { usage: { input: num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens), output: num(u.output_tokens) } } : {}),
    };
  }
  const events = lines.filter(isObj);
  const done = events.findLast((e) => e.type === 'turn.completed');
  if (!done || events.some((e) => e.type === 'turn.failed' || e.type === 'error')) return { ok: false };
  const said = events.filter((e) => e.type === 'item.completed' && isObj(e.item) && e.item.type === 'agent_message').map((e) => String((e.item as Record<string, unknown>).text ?? ''));
  const u = isObj(done.usage) ? done.usage : undefined;
  return { ok: true, result: said.at(-1) ?? '', ...(u ? { usage: { input: num(u.input_tokens), output: num(u.output_tokens) } } : {}) };
}

/**
 * The 5-hour window a Claude Code run last reported, from its stream's `rate_limit_event`: the share used (0 to 1)
 * and when the window resets. Undefined when the run reported another limit, such as the weekly one or overage.
 */
export function windowOf(lines: unknown[]): { used: number; resets: number | null } | undefined {
  const info = lines.filter(isObj).filter((l) => l.type === 'rate_limit_event' && isObj(l.rate_limit_info)).map((l) => l.rate_limit_info as Record<string, unknown>)
    .findLast((i) => i.rateLimitType === 'five_hour' && typeof i.utilization === 'number' && Number.isFinite(i.utilization));
  return info ? { used: info.utilization as number, resets: typeof info.resetsAt === 'number' ? info.resetsAt : null } : undefined;
}

/**
 * The launcher for a plan's models: the agents' runs stop at `deadlines.work`, the judge's at `deadlines.judge` (ms
 * since the epoch). It reads the agents' 5-hour
 * window from what their runs report, and before the first run from one short probe; a reading of another window
 * than the first, or none, leaves the window unread.
 */
export function defaultLauncher(plan: ReplayPlan, env: Record<string, string>, deadlines: { work: number; judge: number }): Launcher {
  const agent = cliOf(plan.models.agent);
  const judge = cliOf(plan.models.judge);
  if (!agent) throw Error(`no agent CLI runs ${plan.models.agent}: the eval runs claude-* models on Claude Code and gpt-* ones on Codex`);
  if (!judge) throw Error(`no CLI runs the judge ${plan.models.judge}: the eval runs claude-* models on Claude Code and gpt-* ones on Codex`);
  // The agent under test edits its own checkout and nothing else; the judge only reads.
  const work: Record<Cli, (model: string) => string[]> = {
    claude: (model) => ['-p', '--output-format', 'stream-json', '--verbose', '--model', model, '--permission-mode', 'acceptEdits'],
    codex: (model) => ['exec', '--json', '-s', 'workspace-write', '--skip-git-repo-check', '-m', model, '-'],
  };
  const read: Record<Cli, (model: string) => string[]> = {
    claude: (model) => ['-p', '--output-format', 'stream-json', '--verbose', '--model', model, '--strict-mcp-config', '--setting-sources', 'user', '--permission-mode', 'dontAsk'],
    codex: (model) => ['exec', '--json', '-s', 'read-only', '--skip-git-repo-check', '--ignore-user-config', '-m', model, '-'],
  };
  /** In an empty folder of its own, removed after. */
  const inEmpty = async <T>(work: (dir: string) => Promise<T>): Promise<T> => {
    const dir = mkdtempSync(join(tmpdir(), 'dj-'));
    try { return await work(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  let probed = false;
  let first: { used: number; resets: number | null } | undefined;
  let last: { used: number; resets: number | null } | undefined;
  const note = (lines: unknown[]): unknown[] => {
    const w = windowOf(lines);
    // Runs end out of order, and a window's use only grows: the fullest reading of it is the latest.
    if (w) { first ??= w; if (!last || w.resets !== last.resets || w.used > last.used) last = w; }
    return lines;
  };
  return {
    async work(run) {
      return resultOf(agent, note(await runCli(agent, work[agent](run.model), run.prompt, run.cwd, run.env, deadlines.work)));
    },
    async judge(request: JudgeRequest): Promise<Grade[]> {
      const prompt = `${request.prompt}\n\n${request.outputs.map((o) => `=== Output ${o.label} ===\n${o.text}`).join('\n\n')}\n\n`
        + `Answer with one line of JSON and nothing after it: {"grades":[{"label":"<label>","score":<0 to 1>}]}, one entry per output.`;
      const answer = resultOf(judge, await inEmpty((dir) => runCli(judge, read[judge](request.model), prompt, dir, env, deadlines.judge)));
      const lastLine = (answer.result ?? '').trim().split('\n').at(-1) ?? '';
      const parsed = JSON.parse(lastLine.slice(lastLine.indexOf('{'))) as unknown;
      const grades = isObj(parsed) && Array.isArray(parsed.grades) ? parsed.grades : [];
      return grades.filter(isObj).map((g) => ({ label: String(g.label), score: Number(g.score) }));
    },
    async planUsed() {
      if (agent !== 'claude') return null;
      if (!first && !probed) await inEmpty((dir) => runCli(agent, read[agent](plan.models.agent), 'Reply with the single word ok.', dir, env, deadlines.work)).then(note).finally(() => { probed = true; });
      return last && first && last.resets === first.resets ? last.used : null;
    },
  };
}
