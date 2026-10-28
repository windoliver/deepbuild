// AC8's readings (README: Budgets): one measurement of a checkout's held stop, its background waiter and its wake of
// an idle session, through `deep setup`'s own entries run by the Claude Code stand-in, a real hub and answers given on
// the hub's socket as `deep inbox answer` gives them. The same driver measures this checkout and the merge base's
// (mergeBase), so the comparison is with the base's own routes, never a number written down.

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AC8, appendTranscript, Claude, control, CURRENT, eventsAfter, load, makeHome, newSession, ours, payload, processTable, REPO, run, setup, sleep,
  startHub, stopHub, tag, typedPrompt, waiterProcs, waitFor, type Checkout, type Conn, type Ev, type Fired, type HookRun, type Line, type Session,
} from './helpers.ts';

/** How many sessions a measurement holds at a stop, how many it leaves idle, and whether it answers the idle ones. */
export interface Plan { held: number; idle: number; wake: boolean; plant?: string }
export interface Reading {
  checkout: string;
  plant: string | undefined;
  /** Per held stop: when DeepBuild's foreground Stop entry ended with the answer, less when the answer was written to the hub. */
  heldMs: number[];
  /** Per idle session: when its waiter exited 2 with the answer, less when the answer was written to the hub. */
  wakeMs: number[];
  /** Per idle session's waiter: its processes' resident memory, the larger of two samples 30 s apart. */
  waiterRssBytes: number[];
  /** Per idle session's waiter: CPU time its processes used over those 30 s. */
  waiterCpuMs: number[];
  /** Stops that went through unheld before you could answer (deep-hook missing the hub on a loaded machine); tried again. */
  missedHolds: number;
  /** Each session a route didn't deliver to, named; its reading is left out. */
  failures: string[];
  loads: { one: number; cores: number }[];
}
const WINDOW_MS = 30_000;
/** How a measurement fails when its sessions couldn't ask, which a loaded machine can cause (budgets.test.ts). */
export const COULD_NOT_ASK = `${AC8} the sessions couldn't ask`;

/** The hub's log, read on from where the last read stopped. */
class Log {
  events: Ev[] = [];
  constructor(private readonly conn: Conn) {}
  async read(): Promise<Ev[]> {
    this.events.push(...(await eventsAfter(this.conn, this.events.at(-1)?.log_pos ?? 0)));
    return this.events;
  }
}

interface Asker { claude: Claude; s: Session; handle: string; id: string; chosen: string; waiter?: HookRun }

/** Whether a hook's output carries the answer to `a`: its ask's ID, or the chosen option's label. */
const carries = (text: string, a: Asker) => text.includes(a.id) || text.includes(a.chosen);

/**
 * A session that asks: SessionStart, a typed prompt, then `deep_ask` through its own `deep mcp`, which comes back
 * "still waiting" with the ask open, as an agent's call does once deep_ask's wait runs out (README: The sessions).
 * Resolves once the hub has filed the ask, with the wait for deep_ask to come back; sessions start one at a time so
 * a loaded machine doesn't cut their `deep mcp` off from the hub. An "unavailable" reply is called again, up to
 * three times, as its remediation says.
 */
async function ask(a: { claude: Claude; s: Session }, log: Log, co: Checkout): Promise<() => Promise<Asker>> {
  const { claude, s } = a;
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  const prompt = 'Ask me which option to take, then stop.';
  typedPrompt(s, prompt);
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt }));
  await claude.initialize();
  const t = tag(4);
  const question = `Which option for ${t}?`;
  const options = [{ id: 'a', label: `Alpha ${t}` }, { id: 'b', label: `Bravo ${t}` }];
  let settled = false;
  const replied = (async () => {
    for (let tries = 1; ; tries++) {
      const reply = await claude.deepTool(s, 'deep_ask', { kind: 'choice', question, options, recommended: 'a', steps: null, where: null, why: null, check: null }, 180_000);
      if (tries > 3 || !/\\?"code\\?"\s*:\s*\\?"unavailable/.test(JSON.stringify(reply))) return reply;
      await sleep(1000);
    }
  })().finally(() => { settled = true; });
  const filed = () => log.events.find((e) => e.kind === 'ask.created' && e.session === s.id);
  await waitFor(async () => settled || (await log.read(), filed()), 180_000, `${s.id}'s deep_ask filed (${co.label})`, 100);
  return async () => {
    const reply = await replied;
    const created = filed() ?? (await log.read(), filed());
    if (!created || !/waiting/.test(JSON.stringify(reply))) throw Error(`BLOCKED: ${s.id}'s deep_ask (${co.label}) must come back still waiting with its ask open: ${JSON.stringify(reply).slice(0, 800)}`);
    appendTranscript(s, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `I asked which option to take for ${t}; I'll wait for your answer.` }] } });
    return { claude, s, handle: `ask:${created.id}`, id: created.id, chosen: options[1]!.label };
  };
}
const stop = (a: Asker) => a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: `I asked you which option to take (${a.handle}); waiting for your answer.` }));
/** Your answer, option b, on the hub's socket as `deep inbox answer` sends it; resolves with when its line was written. */
async function answer(conn: Conn, a: Asker): Promise<number> {
  const { sent } = await conn.call('ask.answer', { ask: a.handle, option: 'b' }, 60_000);
  return sent;
}

/**
 * One measurement of `co` (README: Budgets, The measurement). Throws only when nothing can be measured (the hub, setup
 * or the asks); a session a route didn't deliver to is named in `failures`, its reading left out.
 */
export async function measure(co: Checkout, plan: Plan): Promise<Reading> {
  const env = plan.plant ? { DEEP_HUB_PLANT: plan.plant } : {};
  const loads = [await load()];
  const h = makeHome(co);
  const hub = await startHub(h, plan.plant);
  const conn = await control(hub);
  const log = new Log(conn);
  const all: { claude: Claude; s: Session }[] = [];
  const reading: Reading = { checkout: co.label, plant: plan.plant, heldMs: [], wakeMs: [], waiterRssBytes: [], waiterCpuMs: [], missedHolds: 0, failures: [], loads };
  const failed = (message: string) => { reading.failures.push(`${AC8} ${message} (${co.label})`); };
  try {
    await setup(h, env);
    for (let i = 0; i < plan.held + plan.idle; i++) all.push({ claude: Claude.start(h, env), s: newSession(h) });
    const asking: (() => Promise<Asker>)[] = [];
    let askers: Asker[];
    try {
      for (const a of all) asking.push(await ask(a, log, co));
      askers = await Promise.all(asking.map((done) => done()));
    } catch (error) {
      throw Error(`${COULD_NOT_ASK} (${co.label}): ${(error as Error).message}`);
    }
    const held = askers.slice(0, plan.held);
    const idle = askers.slice(plan.held);

    // The idle sessions stop together; each stop is held while its ask is open, then let through, and the waiter
    // Claude Code started at it waits on in the background. Settled quietly: a measurement that doesn't answer them
    // tears the sessions down while they still hold.
    const idleStops = idle.map((a) => stop(a).catch(() => undefined));
    const waiting: Asker[] = [];
    for (const a of idle) {
      try {
        a.waiter = await waitFor(async () => (await a.claude.background()).find((r) => r.asyncRewake && r.ended === null), 30_000, 'the waiter', 100);
        waiting.push(a);
      } catch {
        failed(`no waiter of DeepBuild's ran for ${a.s.id} after its Stop`);
      }
    }
    await sleep(3000);
    const windowStart = Date.now();
    const before = processTable();

    // The held sessions, one at a time: the stop reaches the hub, then you answer while it holds. A stop that went
    // through before you could answer wasn't held (deep-hook missed the hub): it is counted, and the session stops again.
    for (const a of held) {
      let fired: Fired | undefined, sent = 0, missed = 0;
      for (let tries = 1; tries <= 3 && !fired; tries++) {
        const from = log.events.length;
        let settled = false;
        const stopping = stop(a).finally(() => { settled = true; });
        const recorded = await waitFor(async () => settled || (await log.read()).slice(from).some((e) => e.kind === 'agent.stop' && e.session === a.s.id), 30_000, 'the stop', 50).catch(() => false);
        if (!recorded) { failed(`the hub never recorded ${a.s.id}'s Stop, still running after 30 s`); break; }
        await sleep(300);
        if (settled) { reading.missedHolds++; missed++; continue; }
        sent = await answer(conn, a);
        fired = await stopping;
      }
      if (!fired) { if (missed === 3) failed(`${a.s.id}'s Stop went through unheld three times, its ask ${a.handle} open, before you could answer`); continue; }
      const continued = ours(fired.ran).find((r) => !r.async && /"decision"\s*:\s*"block"/.test(r.stdout) && carries(r.stdout, a));
      if (continued?.ended) reading.heldMs.push(continued.ended - sent);
      else failed(`${a.s.id}'s held stop didn't continue with your answer to ${a.handle}: ${JSON.stringify(ours(fired.ran).map((r) => ({ code: r.code, stdout: r.stdout.slice(0, 300), stderr: r.stderr.slice(0, 200) })))}`);
    }

    const sampled: Asker[] = [];
    if (waiting.length) {
      await sleep(Math.max(0, windowStart + WINDOW_MS - Date.now()));
      const after = processTable();
      for (const a of waiting) {
        const was = new Map(waiterProcs(before, a.waiter!.pid).map((p) => [p.pid, p]));
        const is = waiterProcs(after, a.waiter!.pid);
        const now = (await a.claude.background()).find((r) => r.pid === a.waiter!.pid)!;
        if (now.ended !== null) { failed(`DeepBuild's waiter for ${a.s.id} ended while it waited, exit ${now.code}: ${now.stderr.slice(0, 300)}`); continue; }
        if (!was.size) { failed(`found no process of DeepBuild's waiter for ${a.s.id} under the shell Claude Code started it with (${a.waiter!.pid}): ${a.waiter!.command}`); continue; }
        const rss = (ps: { rssBytes: number }[]) => ps.reduce((sum, p) => sum + p.rssBytes, 0);
        reading.waiterRssBytes.push(Math.max(rss([...was.values()]), rss(is)));
        reading.waiterCpuMs.push(is.reduce((sum, p) => sum + p.cpuMs - (was.get(p.pid)?.cpuMs ?? 0), 0));
        sampled.push(a);
      }
    }

    // The idle sessions, one at a time: you answer, and the waiter wakes the session by exiting 2 with the answer.
    if (plan.wake) {
      await Promise.all(idleStops);
      for (const a of sampled) {
        await sleep(500);
        const sent = await answer(conn, a);
        const woke = await waitFor(async () => (await a.claude.background()).find((r) => r.pid === a.waiter!.pid && r.ended !== null), 30_000, 'the waiter', 50).catch(() => undefined);
        if (!woke) failed(`DeepBuild's waiter didn't wake idle session ${a.s.id} within 30 s of your answer to ${a.handle}`);
        else if (woke.code !== 2 || !carries(woke.stderr, a)) failed(`DeepBuild's waiter for ${a.s.id} ended without waking it with your answer to ${a.handle}: exit ${woke.code}, stderr ${JSON.stringify(woke.stderr.slice(0, 300))}`);
        else reading.wakeMs.push(woke.ended! - sent);
      }
    }
    loads.push(await load());
    return reading;
  } finally {
    for (const a of all) a.claude.quit();
    conn.close();
    await stopHub(hub);
  }
}

export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
export const shownReading = (r: Reading): string => [
  `${r.checkout}${r.plant ? ` with ${r.plant}` : ''}:`,
  `held stop beyond the answer ${r.heldMs.map((x) => x.toFixed(0)).join('/')} ms;`,
  `wake ${r.wakeMs.map((x) => x.toFixed(0)).join('/')} ms;`,
  `waiter RSS ${r.waiterRssBytes.map((x) => (x / 1e6).toFixed(2)).join('/')} MB;`,
  `waiter CPU over 30 s ${r.waiterCpuMs.join('/')} ms;`,
  `${r.missedHolds} stop(s) unheld and tried again;`,
  `${r.failures.length} route failure(s)${r.failures.length ? `: ${r.failures.join('; ').slice(0, 1500)}` : ''};`,
  `load ${r.loads.map((l) => l.one.toFixed(1)).join(' to ')} on ${r.loads[0]?.cores} cores`,
].join(' ');

// ---- The merge base's side (README: The merge base).

const git = (...args: string[]) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
/** Whether the working tree's `paths` are the merge base's, uncommitted and untracked files included. */
const sameAs = (sha: string, paths: string[]) => spawnSync('git', ['diff', '--quiet', sha, '--', ...paths], { cwd: REPO }).status === 0
  && git('ls-files', '--others', '--exclude-standard', '--', ...paths) === '';

/**
 * The merge base with origin/main, built: this checkout when its code is the base's, else a copy from `git archive`
 * at /tmp/dh25l-base-<sha>, kept between runs, with its workspaces built (its node_modules linked to this checkout's
 * when the lockfiles match, else `npm ci`) and its deep-hook (copied when crates/ is the base's, else built).
 */
export async function mergeBase(): Promise<Checkout> {
  let sha: string;
  try { sha = git('merge-base', 'HEAD', 'origin/main'); } catch (e) { throw Error(`BLOCKED: no merge base with origin/main to compare with: ${(e as Error).message.split('\n')[0]}`); }
  const label = `the merge base ${sha.slice(0, 12)}`;
  if (sameAs(sha, ['packages', 'crates', 'Cargo.toml', 'Cargo.lock', 'package.json', 'package-lock.json'])) return { label: `${label} (this checkout's own code)`, root: REPO, cli: CURRENT.cli };
  const dir = `/tmp/dh25l-base-${sha.slice(0, 12)}`;
  const co = { label, root: dir, cli: join(dir, 'packages/cli/dist/main.js') };
  if (existsSync(join(dir, '.built'))) return co;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync('/bin/sh', ['-c', `git -C '${REPO}' archive ${sha} | tar -x -C '${dir}'`], { stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  const step = async (what: string, command: string, args: string[], env: NodeJS.ProcessEnv = process.env) => {
    const r = await run(command, args, { cwd: dir, env, timeoutMs: 1_800_000 });
    if (r.code !== 0) throw Error(`BLOCKED: building ${label} for the comparison: ${what} failed: ${r.stderr.slice(-2000)}`);
  };
  if (git('show', `${sha}:package-lock.json`) === readFileSync(join(REPO, 'package-lock.json'), 'utf8').trim()) {
    // Same lockfile: the base's own workspaces, everything else this checkout's installed packages.
    mkdirSync(join(dir, 'node_modules/@deepbuild'), { recursive: true });
    for (const entry of readdirSync(join(REPO, 'node_modules'))) if (entry !== '@deepbuild') symlinkSync(join(REPO, 'node_modules', entry), join(dir, 'node_modules', entry));
    for (const pkg of readdirSync(join(dir, 'packages'))) {
      const file = join(dir, 'packages', pkg, 'package.json');
      const name = existsSync(file) ? String((JSON.parse(readFileSync(file, 'utf8')) as Line).name ?? '') : '';
      if (name.startsWith('@deepbuild/')) symlinkSync(join(dir, 'packages', pkg), join(dir, 'node_modules/@deepbuild', name.slice('@deepbuild/'.length)));
    }
  } else {
    await step('npm ci', 'npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund']);
  }
  await step('npm run build --workspaces', 'npm', ['run', 'build', '--workspaces']);
  if (sameAs(sha, ['crates', 'Cargo.toml', 'Cargo.lock']) && existsSync(join(REPO, 'target/debug/deep-hook'))) {
    mkdirSync(join(dir, 'target/debug'), { recursive: true });
    copyFileSync(join(REPO, 'target/debug/deep-hook'), join(dir, 'target/debug/deep-hook'));
    chmodSync(join(dir, 'target/debug/deep-hook'), 0o755);
  } else {
    await step('cargo build -p deep-hook', 'cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { ...process.env, CARGO_TARGET_DIR: join(dir, 'target') });
  }
  writeFileSync(join(dir, '.built'), `${sha}\n`);
  return co;
}
