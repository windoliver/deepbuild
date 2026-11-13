// The world of #55 AC13's redraft (README, The world): the real hub, `deep setup`'s real entries and deep-hook, the
// real plugin, and paseo's daemon as fixtures/daemon.mjs, one process that hosts the plugin and starts the Claude Code
// stand-in it runs as its own child. Paseo's side of the plugin (fixtures/paseo-host.mjs), the agent as paseo knows it
// and the scratch homes come from the first draft (tests/acceptance/55), Claude Code's stand-in and the asking session
// from tests/acceptance/27 (same repo, same license); none of them is edited. Processes are stopped by PID and by the
// process groups this suite started, never by name or port.
// First: what you gave the suite by hand, before ../29's helpers (loaded through ../55's) delete it (../55/README.md, D1).
import '../55/env.ts';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { PassThrough, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import {
  Claude, FACTS as CLAUDE_FACTS, FIXTURES as FIXTURES27, NODE, alive, assistantSays, beginAsk, carries, childEnv, cliOf, makeRepo, newSession, own, payload, processes,
  setup, startHub, stopAfterAsking, treeOf, typedPrompt, type Asking, type Hub,
} from '../27/helpers.ts';
import { given } from '../55/env.ts';
import {
  ENTRY, HOST, Host, answer, cleanup as cleanup55, create, events, fakeAgent, makeHome, needPlugin, outcomesOf, said, sleep, turnEnds, turnStarts, waitFor, within,
  type Fake, type Line,
} from '../55/helpers.ts';

export const DAEMON = fileURLToPath(new URL('./fixtures/daemon.mjs', import.meta.url));
/** The criterion's tag: `#55.` and the first 8 hex of SHA-256 of its text (../55/README.md, Criteria). */
export const AC13 = 'AC13 #55.480a0e0c';
/** The hub's planted wrong program for this criterion (../55/README.md, Plants). */
export const PLANT = 'paseo-delivers-beside-waiter';

/** An agent process the daemon runs, as #27's Claude class drives a child: its stdin and stdout go through fd 3. */
class Agent extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stdin: Writable;
  exitCode: number | null = null;
  constructor(readonly pid: number, send: (data: string) => void) {
    super();
    this.stdin = new Writable({ write(chunk: Buffer, _encoding, done) { send(chunk.toString('utf8')); done(); } });
  }
  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    try { process.kill(this.pid, signal); return true; } catch { return false; }
  }
}

const running = new Set<Paseo>();
/** Paseo's daemon: fixtures/daemon.mjs, hosting the plugin through ../55's paseo-host.mjs and starting the agents it runs. */
export class Paseo {
  private readonly lines: Line[] = [];
  private readonly agents = new Map<string, Agent>();
  private constructor(readonly child: ChildProcess, readonly host: Host, private readonly link: Socket) {
    createInterface({ input: link }).on('line', (raw) => {
      let l: Line;
      try { l = JSON.parse(raw) as Line; } catch { return; }
      const agent = typeof l.id === 'string' ? this.agents.get(l.id) : undefined;
      if (agent && typeof l.data === 'string') agent.stdout.write(l.data);
      else if (agent && 'exit' in l) { agent.exitCode = l.exit as number | null; agent.stdout.end(); agent.emit('exit', l.exit, l.signal); }
      else this.lines.push(l);
    });
  }
  get pid(): number { return this.child.pid!; }
  /** The daemon with the plugin loaded, HOME the test's home. */
  static async start(home: string): Promise<Paseo> {
    needPlugin();
    const child = spawn(NODE, [DAEMON, HOST, ENTRY], { cwd: dirname(home), env: childEnv(home, { DEEP_PASEO_PLANT: given.DEEP_PASEO_PLANT }), stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    own(child.pid);
    const host = new (Host as unknown as new (child: ChildProcess, home: string) => Host)(child, home);
    const paseo = new Paseo(child, host, child.stdio[3] as Socket);
    running.add(paseo);
    host.hooks = (await host.send({ op: 'load' }, 60_000)).hooks as string[];
    return paseo;
  }
  private write(o: Line): void { this.link.write(`${JSON.stringify(o)}\n`); }
  /** Paseo starts Claude Code for the agent it opened: #27's stand-in, a child of the daemon, driven as #27 drives it. */
  async claude(home: string): Promise<Claude> {
    const id = randomUUID();
    this.write({ op: 'start', id, argv: [NODE, join(FIXTURES27, 'claude.mjs'), cliOf(home), CLAUDE_FACTS], cwd: dirname(home) });
    const started = await waitFor(() => this.lines.find((l) => l.id === id && typeof l.started === 'number'), 30_000, `paseo's daemon to start Claude Code; its stderr: ${this.host.stderr().slice(-1500)}`, 20);
    own(started.started as number);
    const agent = new Agent(started.started as number, (data) => this.write({ id, data }));
    this.agents.set(id, agent);
    return new (Claude as unknown as new (child: ChildProcess, home: string) => Claude)(agent as unknown as ChildProcess, home);
  }
  /** Paseo disables the plugin: the host runs the cleanup it returned and ends it; the daemon and its agents go on. */
  async unloadPlugin(): Promise<void> {
    await this.host.send({ op: 'stop' });
    await waitFor(() => this.lines.find((l) => l.plugin === 'stopped'), 10_000, 'the plugin to end');
  }
  async stop(): Promise<void> {
    if (!running.delete(this)) return;
    this.link.end();
    try { process.kill(this.pid, 'SIGTERM'); } catch { /* gone */ }
    const by = Date.now() + 5000;
    while (alive(this.pid) && Date.now() < by) await sleep(100);
    if (alive(this.pid)) try { process.kill(this.pid, 'SIGKILL'); } catch { /* gone */ }
  }
}
export async function cleanup(): Promise<void> {
  for (const p of [...running]) await p.stop();
  await cleanup55();
}

/** A Claude session paseo runs and deep-hook gates: it asked you through deep_ask, stopped, and waits idle with its waiter live. */
export interface World { home: string; hub: Hub; paseo: Paseo; f: Fake; a: Asking }
export async function idleInPaseo(): Promise<World> {
  needPlugin();
  const { home } = makeHome();
  const repo = makeRepo(home);
  const hub = await startHub(home, { noAskWait: true, shortHold: true });
  await setup(home);
  const paseo = await Paseo.start(home);
  const s = newSession(home, repo.dir);
  const f = fakeAgent('claude', repo.dir, s.id);
  await create(paseo.host, f);
  const claude = await paseo.claude(home);
  const prompt = 'Pick a header colour for the checkout page, then stop.';
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  typedPrompt(s, prompt);
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt }));
  await turnStarts(paseo.host, f, 't1', prompt);
  const a = await (await beginAsk(hub, home, { s, claude })).finish();
  const stop = await stopAfterAsking(a);
  if (stop.blocked) throw Error(`BLOCKED: nothing is answered yet, so ${s.id}'s stop goes through: ${stop.blocked}`);
  await paseo.host.settled(await turnEnds(paseo.host, f, 't1', { words: 'I asked which header colour you want; I will wait for your answer.' }));
  const waiter = await waitFor(async () => (await claude.liveWaiters(s.id))[0], 30_000, `the waiter of ${s.id}`).catch((e: Error) => { throw Error(`BLOCKED: ${e.message}`); });
  // The world's one requirement (README, The world): what Claude Code runs is in paseo's process tree.
  if (!treeOf(processes(), paseo.pid).some((p) => p.pid === waiter.pid)) throw Error(`BLOCKED: ${s.id}'s waiter (pid ${waiter.pid}) isn't in the tree of paseo's daemon (pid ${paseo.pid})`);
  return { home, hub, paseo, f, a };
}

/** deep-hook's waiter for the session, stopped before it ever fires: in this session the wake route never fired. */
export async function stopWaiter(a: Asking): Promise<void> {
  for (const w of await a.claude.liveWaiters(a.s.id)) try { process.kill(-w.pid, 'SIGKILL'); } catch { /* gone */ }
  await waitFor(async () => (await a.claude.liveWaiters(a.s.id)).length === 0, 10_000, `${a.s.id}'s waiter to be gone`);
}
/** The record's `delivered` outcomes for the ask. */
export const delivered = async (home: string, a: Asking) => outcomesOf(await events(home), a.handle).filter((e) => e.data?.outcome === 'delivered');
/** The wakes deep-hook's waiter gave the session. */
export const wakesOf = (a: Asking) => a.claude.wakes.filter((w) => w.session === a.s.id && !w.dropped);

/**
 * The wake route, which the wrong program's run shares: you answer the idle session while deep-hook's waiter is live;
 * the waiter wakes Claude Code, whose turn paseo reads like any other, and the answer goes in once, by that wake, with
 * nothing sent by the plugin. Every failure names the ask.
 */
export async function answeredByWake({ home, paseo, f, a }: World): Promise<void> {
  const host = paseo.host;
  await answer(home, a.handle, a.green.id);
  const words = `Going with ${a.green.label}.`;
  const wake = await within(30_000, () => wakesOf(a)[0]);
  if (wake) {
    await turnStarts(host, f, 't2', String(wake.prompt ?? ''));
    assistantSays(a.s, words);
    await a.claude.hook('Stop', payload(a.s, 'Stop', { stop_hook_active: true, prompt_id: wake.promptId, last_assistant_message: words }));
    await host.settled(await turnEnds(host, f, 't2', { words }));
  }
  await within(20_000, async () => (await delivered(home, a)).length > 0);
  await sleep(5000);
  const sends = host.callsOf(f, 'send');
  const routes = { wakes: wakesOf(a).length, sends: sends.length };
  const twice = routes.wakes + sends.filter((c) => carries(String(c.args?.text ?? ''), a.green)).length > 1 ? 'the answer went in twice: ' : '';
  expect(routes, `${AC13} ${a.handle}'s answer goes into ${a.s.id} once, by deep-hook's waiter, and the plugin sends nothing: ${twice}${routes.wakes} wake(s) by the waiter, and the plugin sent ${JSON.stringify(sends.map((c) => String(c.args?.text).slice(0, 300)))}`).toEqual({ wakes: 1, sends: 0 });
  expect((await delivered(home, a)).map(said), `${AC13} ${a.handle} is delivered once`).toHaveLength(1);
}
