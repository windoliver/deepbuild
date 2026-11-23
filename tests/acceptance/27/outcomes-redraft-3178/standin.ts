// This folder's Claude Code stand-in (fixtures/claude.mjs) and the session steps that drive it. The class is copied
// from ../helpers.ts (same repo, same license) with one change: it runs this folder's copy of the stand-in, and the
// process groups it starts for hook entries are stopped here at cleanup. Everything else comes from ../helpers.ts as
// it is. `setupHere` runs `deep setup` as ../helpers.ts's `setup` does, but never builds deep-hook: an entry naming a
// binary that isn't there is BLOCKED (README: How to run).
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  FACTS, NODE, allEvents, appendTranscript, assistantSays, callId, childEnv, cleanup as cleanupShared, cliOf, deep, deepEntries, groupOf, isDeepBuild,
  newSession, own, parseObject, payload, processes, readLines, readSettings, settingsFile, shown, sleep, tag, typedPrompt, waitFor,
  type Ev, type Fired, type HookRun, type Line, type Hub, type Option, type Session, type Wake,
} from '../helpers.ts';

const STANDIN = fileURLToPath(new URL('./fixtures/claude.mjs', import.meta.url));
const groups = new Set<number>();

/** Stops the process groups this folder's stand-ins started for hook entries, then the shared cleanup. */
export async function cleanup(): Promise<void> {
  for (const pgid of groups) try { process.kill(-pgid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...groups].some((g) => groupOf(g).length) && Date.now() < deadline) await sleep(100);
  for (const pgid of groups) try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ }
  groups.clear();
  await cleanupShared();
}

/** `deep setup` with HOME the test's home, a hub already answering; BLOCKED unless it exits 0 and every deep-hook its entries name is built. */
export async function setupHere(home: string): Promise<void> {
  const r = await deep(home, ['setup']);
  if (r.code !== 0) throw Error(`BLOCKED: deep setup must exit 0 and install DeepBuild into Claude Code's user settings: ${shown(r)}`);
  if (!existsSync(settingsFile(home))) throw Error(`BLOCKED: deep setup exited 0 but wrote no ${settingsFile(home)}: ${shown(r)}`);
  for (const { hook } of deepEntries(readSettings(home))) {
    for (const path of String(hook.command).match(/\/[^\s'"]*deep-hook\b/g) ?? []) {
      if (!existsSync(path)) throw Error(`BLOCKED: DeepBuild's entry runs ${path}, which isn't built (cargo build --locked -p deep-hook): ${hook.command}`);
    }
  }
}

export class Claude {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private rpc = 0;
  readonly wakes: Wake[] = [];
  exited = false;
  private constructor(private readonly child: ChildProcess, readonly home: string) {
    child.on('exit', () => { this.exited = true; for (const [n, done] of [...this.pending]) done({ n, failed: 'the Claude Code stand-in exited' }); });
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      const line = parseObject(raw);
      if (!line) return;
      if (typeof line.n === 'number') this.pending.get(line.n)?.(line);
      else if (line.wake) this.wakes.push(line.wake as Wake);
    });
  }
  get pid(): number { return this.child.pid!; }
  static start(home: string): Claude {
    const child = spawn(NODE, [STANDIN, cliOf(home), FACTS], { cwd: join(home, '..'), env: childEnv(home), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Claude(child, home);
  }
  private send(command: Line, timeoutMs = 900_000): Promise<Line> {
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
  async hook(event: string, body: Line): Promise<Fired> {
    const fired = (await this.send({ op: 'hook', event, payload: body, settings: settingsFile(this.home) })) as unknown as Fired;
    for (const r of [...fired.background, ...fired.ran]) groups.add(r.pid);
    return fired;
  }
  async background(): Promise<(HookRun & { event: string })[]> { return (await this.send({ op: 'background' })).background as (HookRun & { event: string })[]; }
  /** wake:false is a Claude Code that starts no turn when the waiter exits 2 (as the desktop app may not). */
  async configure(o: { wake: boolean }): Promise<void> { await this.send({ op: 'configure', ...o }); }
  /** Claude Code killed (SIGKILL): nothing of it runs on, no SessionEnd fires, and nothing it started is stopped. */
  async kill(): Promise<void> {
    const gone = new Promise<void>((resolve) => { if (this.exited) resolve(); else this.child.once('exit', () => resolve()); });
    this.child.kill('SIGKILL');
    await gone;
  }
  async request(method: string, params: Line = {}, timeoutMs = 120_000): Promise<Line> {
    const id = `${method}#${++this.rpc}`;
    const r = await this.send({ op: 'mcp', line: { jsonrpc: '2.0', id, method, params }, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return r.reply as Line;
  }
  private initialized = false;
  private async initialize(): Promise<void> {
    if (this.initialized) return;
    const reply = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-27-outcomes-3178', version: '0' } });
    if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
    await this.send({ op: 'mcp', line: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} } });
    this.initialized = true;
  }
  /** One of DeepBuild's tools called as the agent calls it: PreToolUse, the call through deep mcp, its transcript entries, PostToolUse. */
  async tool(s: Session, name: string, args: Line, timeoutMs = 120_000): Promise<Line> {
    await this.initialize();
    const call = callId();
    const tool = `mcp__deep__${name}`;
    appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${call.slice(6, 18)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: call, name: tool, input: args }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } });
    await this.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: tool, tool_input: args, tool_use_id: call }));
    const reply = await this.request('tools/call', { name, arguments: args }, timeoutMs).catch((error: Error): Line => ({ error: error.message }));
    appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content: JSON.stringify(reply.result?.content ?? reply.error ?? reply) }] } });
    await this.hook('PostToolUse', payload(s, 'PostToolUse', { tool_name: tool, tool_input: args, tool_use_id: call, tool_response: reply.result ?? {} }));
    return reply;
  }
  /** The live asyncRewake runs of DeepBuild's waiter for a session. */
  async liveWaiters(session: string): Promise<(HookRun & { event: string })[]> {
    const table = processes();
    return (await this.background()).filter((r) => r.asyncRewake && isDeepBuild(r.command) && r.session === session && r.ended === null && groupOf(r.pid, table).length > 0);
  }
}

/**
 * A choice that waits on you: two header colours and no recommendation, so nothing goes on provisionally (design: Work
 * goes on while you decide, "proceeds on the recommended option"; A question holds the send-back, "a taste call or
 * choice that isn't provisional leaves the agent waiting on you").
 */
export interface Choice { question: string; options: Option[] }
export function choice(): Choice {
  const t = tag(4);
  return { question: `Which header colour for the checkout page (${t})? Both pass the contrast check; it is your call.`, options: [{ id: 'blue', label: `Blue header ${t}` }, { id: 'green', label: `Green header ${t}` }] };
}
/** deep_ask's arguments for the choice, every nullable field given as the tool's schema lists it, and no recommendation. */
export const choiceArgs = (q: Choice): Line => ({ kind: 'choice', question: q.question, options: q.options, recommended: null, steps: null, where: null, why: null, check: null, subject: null });

export interface Asking { s: Session; claude: Claude; handle: string; id: string; q: Choice; green: Option; reply: Line; created: Ev }
/**
 * A session of this folder's Claude Code asks: SessionStart, a prompt you typed, then `deep_ask` with the choice in
 * that turn. BLOCKED unless the hub filed it as an ask that waits on you (not provisional, still open).
 */
export async function asks(hub: Hub, home: string, o: { claude: Claude; cwd: string; before?: (s: Session) => Promise<void> }): Promise<Asking> {
  const s = newSession(home, o.cwd);
  const { claude } = o;
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  const words = 'Pick a header colour for the checkout page with me, then stop.';
  typedPrompt(s, words);
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: words }));
  await o.before?.(s);
  const q = choice();
  const reply = await claude.tool(s, 'deep_ask', choiceArgs(q), 120_000);
  const created = await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'ask.created' && e.session === s.id && e.data?.question === q.question), 30_000, `the deep_ask "${q.question}" filed under ${s.id}`)
    .catch((error: Error) => { throw Error(`BLOCKED: ${error.message}; deep_ask replied ${JSON.stringify(reply).slice(0, 1500)}`); });
  const said = JSON.stringify(reply);
  if (created.data?.provisional === true || /"status\\?"\s*:\s*\\?"provisional/.test(said)) {
    throw Error(`BLOCKED: a choice with no recommendation must wait on you, but ask:${created.id} went on provisionally: ${said.slice(0, 1500)}`);
  }
  assistantSays(s, 'I asked which header colour you want; I will wait for your answer.');
  return { s, claude, handle: `ask:${created.id}`, id: created.id, q, green: q.options[1]!, reply, created };
}
/** The session's Stop after it asked. */
export const stopAfterAsking = (a: Asking): Promise<Fired> => a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: 'I asked which header colour you want; I will wait for your answer.' }));

/** The hook_additional_context attachments the session's transcript holds: what Claude Code wrote for hooks' replies. */
export const contextEntries = (s: Session): string[] => readLines(s.transcript)
  .filter((l) => l.type === 'attachment' && l.attachment?.type === 'hook_additional_context')
  .map((l) => (Array.isArray(l.attachment.content) ? l.attachment.content.join('\n') : String(l.attachment.content)));
