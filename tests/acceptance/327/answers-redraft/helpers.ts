// Test-side tools for the blind redraft of #327 AC2 (README): a Claude Code session as Claude Code runs it, so the
// agent's next input is read where the agent reads it, its transcript. The hub world (temp home, real hub, paired
// device, signed answers, asks seeded in a session) is the earlier #327 suite's, imported from ../helpers.ts as it is.
// What is here: the Claude Code stand-in (fixtures/claude.mjs, a copy of #25's with a transcript lag), the user
// settings entries it runs (deep-hook, as setup writes them), the session's transcript, and reading it back.
// Nothing here answers an ask, delivers an answer or records an outcome: those are the hub's.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { childEnv, CLI, DEEP_HOOK, NODE, own, REPO, tempDir, type Line } from '../../16/helpers.ts';

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
/** The newest Claude Code version the facts cover: the version the stand-in's session runs. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();
const tag = (n = 4) => randomBytes(n).toString('hex');

// ---- Claude Code's user settings: DeepBuild's entries as setup writes them (packages/hub/src/claude-settings.ts,
// ourGroups: `'<deep-hook>' claude-code <Event>` per hook, `*` on the tool hooks, and the Stop's background waiter).
// Written by hand rather than by `deep setup`, which would reach the Mac's launchctl from a test home.
export const settingsFile = (home: string) => join(home, '.claude', 'settings.json');
export function writeSettings(home: string): void {
  const q = (path: string) => `'${path.replaceAll("'", `'\\''`)}'`;
  const entry = (event: string) => ({ type: 'command', command: `${q(DEEP_HOOK)} claude-code ${event}` });
  const plain = (event: string) => [{ hooks: [entry(event)] }];
  const tool = (event: string) => [{ matcher: '*', hooks: [entry(event)] }];
  const hooks = {
    SessionStart: plain('SessionStart'), UserPromptSubmit: plain('UserPromptSubmit'), PreToolUse: tool('PreToolUse'), PostToolUse: tool('PostToolUse'),
    Stop: [...plain('Stop'), { hooks: [{ type: 'command', command: `${q(DEEP_HOOK)} claude-code waiter`, asyncRewake: true, timeout: 600 }] }],
  };
  mkdirSync(dirname(settingsFile(home)), { recursive: true });
  writeFileSync(settingsFile(home), `${JSON.stringify({ hooks }, null, 2)}\n`);
}

// ---- A session: its working folder and its transcript where Claude Code keeps it under <home>.
export interface Session { id: string; cwd: string; transcript: string; prompt?: string }
export function newSession(home: string): Session {
  const id = randomUUID();
  const cwd = join(tempDir(), 'w');
  mkdirSync(cwd, { recursive: true });
  const transcript = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd, transcript };
}
/** A hook's payload as Claude Code sends it (adapters/corpus/claude-code's shape). */
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.prompt && event !== 'SessionStart') base.prompt_id = s.prompt;
  if (event === 'SessionStart') Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' });
  return { ...base, ...extra };
}
function append(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}
/** The entry Claude Code writes for a prompt you typed; its prompt ID goes on the turn's hooks. */
export function typed(s: Session, text: string): string {
  s.prompt = randomUUID();
  append(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  return s.prompt;
}
/** The assistant's words in the transcript, as Claude Code writes them before the turn's next hook. */
export function assistantSays(s: Session, text: string): void {
  append(s, { type: 'assistant', promptId: s.prompt, message: { id: `msg_${tag(8)}`, role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
}

// ---- Reading the transcript back: what reached the agent as input.
export interface Input { line: number; kind: 'user' | 'hook_additional_context'; text: string }
/**
 * The entries from line `from` on that are input to the agent: a user entry with text (a Stop hook's block reason,
 * a wake's prompt, a typed prompt) or a hook's additional context.
 */
export function inputs(s: Session, from = 0): Input[] {
  const out: Input[] = [];
  readFileSync(s.transcript, 'utf8').split('\n').forEach((raw, line) => {
    if (line < from || !raw.trim()) return;
    let e: Line;
    try { e = JSON.parse(raw) as Line; } catch { return; }
    if (e.type === 'user' && typeof e.message?.content === 'string') out.push({ line, kind: 'user', text: e.message.content });
    else if (e.type === 'attachment' && e.attachment?.type === 'hook_additional_context') out.push({ line, kind: 'hook_additional_context', text: ([] as unknown[]).concat(e.attachment.content).map(String).join('\n') });
  });
  return out;
}
export const lineCount = (s: Session): number => readFileSync(s.transcript, 'utf8').split('\n').length - 1;

// ---- The Claude Code stand-in (fixtures/claude.mjs): one process, its hooks its children, as #25's Claude class.
export interface StopOutcome { blocked: boolean; reasons: string[]; continued: boolean; overridden: boolean; count: number }
export interface HookRun { command: string; code: number | null; stdout: string; stderr: string; timedOut: boolean }
export interface Fired { ran: HookRun[]; background: HookRun[]; stop?: StopOutcome; settingsError?: string }
/** The environment Claude Code gives its hooks: HOME the test's, CLAUDECODE set, no billing key or CLAUDE_ setting of this process's. */
function claudeEnv(home: string): NodeJS.ProcessEnv {
  const env = childEnv(home);
  for (const key of Object.keys(env)) if (key.startsWith('CLAUDE') || key.startsWith('ANTHROPIC_') || ['OPENAI_API_KEY', 'CODEX_API_KEY', 'AWS_BEARER_TOKEN_BEDROCK'].includes(key)) delete env[key];
  env.CLAUDECODE = '1';
  return env;
}
export class Claude {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private constructor(private readonly child: ChildProcess, readonly home: string) {
    child.on('exit', () => { for (const [n, done] of [...this.pending]) done({ n, failed: 'the Claude Code stand-in exited' }); });
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      let line: Line | undefined;
      try { line = JSON.parse(raw) as Line; } catch { return; }
      if (line && typeof line.n === 'number') this.pending.get(line.n)?.(line);
    });
  }
  static async start(home: string, o: { lag: number }): Promise<Claude> {
    const child = spawn(NODE, [join(FIXTURES, 'claude.mjs'), CLI, FACTS], { cwd: dirname(home), env: claudeEnv(home), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    const claude = new Claude(child, home);
    await claude.send({ op: 'configure', lag: o.lag });
    return claude;
  }
  private send(command: Line, timeoutMs = 180_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(n); reject(Error(`the Claude Code stand-in gave no answer to ${command.op} in ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(n, (line) => {
        clearTimeout(timer);
        this.pending.delete(n);
        if (line.failed) reject(Error(`the Claude Code stand-in failed ${command.op}: ${line.failed}`));
        else resolve(line);
      });
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  /** Fires one hook: every entry of the user settings for it, as Claude Code runs them. */
  async hook(event: string, body: Line): Promise<Fired> {
    const fired = (await this.send({ op: 'hook', event, payload: body, settings: settingsFile(this.home) })) as unknown as Fired;
    if (fired.settingsError) throw Error(`BLOCKED: setup: the stand-in can't read ${settingsFile(this.home)}: ${fired.settingsError}`);
    return fired;
  }
  /** A tool call as Claude Code makes it: PreToolUse, then PostToolUse with its result. */
  async tool(s: Session, name: string, input: Line, response: Line): Promise<void> {
    const id = `toolu_${tag(12)}`;
    await this.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: name, tool_input: input, tool_use_id: id }));
    await this.hook('PostToolUse', payload(s, 'PostToolUse', { tool_name: name, tool_input: input, tool_use_id: id, tool_response: response }));
  }
}
