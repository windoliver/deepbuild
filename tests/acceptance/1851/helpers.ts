// Test-side tools for the #1851 acceptance tests. The hub in a temporary home, `deep setup`'s real entries, the Claude
// Code stand-in that runs them (each a child of its own agent process, through `/bin/sh -c`, as Claude Code runs a
// command hook), idle asking sessions and `deep inbox answer` all come from #25's delivery suite
// (../25/routes/helpers.ts). This file adds what #1851 needs on top: the control token held in this test's memory, so
// the file can be removed while the test still reads the record and you still answer; the real waiter run under the
// wrong session or from outside every agent's process tree; and where a refusal can be read. No hub, CLI or deep-hook
// module is imported; processes are stopped by PID or by the process group this suite started (`kill(-pgid)`).

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  childEnv, Conn, deep, own, readSettings, shown, waiterEntries, type Claude, type Ev, type Hub, type HookRun, type Line, type Ran, type Session, payload,
} from '../25/routes/helpers.ts';

/** The control token the hub wrote at launch, read once into this test's memory, as a `deep` command reads it. */
export const heldToken = (hub: Hub): string => readFileSync(join(hub.root, 'control.token'), 'utf8').trim();

/** Every event in the log through `events.read`, on a cli connection holding `token` (no file read). */
export async function eventsWith(hub: Hub, token: string): Promise<Ev[]> {
  const conn = await Conn.open(hub.socket);
  try {
    await conn.hello(token);
    const out: Ev[] = [];
    for (let after = 0; ;) {
      const page = (await conn.call('events.read', { after, limit: 1000 })).events as Ev[];
      if (!page.length) return out;
      out.push(...page);
      after = page[page.length - 1]!.log_pos;
    }
  } finally {
    conn.close();
  }
}
export const headWith = async (hub: Hub, token: string): Promise<number> => Math.max(0, ...(await eventsWith(hub, token)).map((e) => e.log_pos));

/**
 * `deep inbox answer <ask> <option>` run by you from a shell of your own whose home holds the token you read while the
 * file existed, and your settings' `hub.address` naming this hub's socket. Your answer, the OS confirmation stubbed as in
 * #25's suite; resolves once the command has exited 0.
 */
export async function answerAsYou(hub: Hub, token: string, handle: string, option: string): Promise<Ran> {
  const you = join(dirname(hub.home), 'y');
  mkdirSync(join(you, '.deepbuild'), { recursive: true, mode: 0o700 });
  writeFileSync(join(you, '.deepbuild', 'control.token'), `${token}\n`, { mode: 0o600 });
  writeFileSync(join(you, '.deepbuild', 'config.json'), `${JSON.stringify({ hub: { address: `unix:${hub.socket}` } })}\n`);
  const r = await deep(you, ['inbox', 'answer', handle, option]);
  if (r.code !== 0) throw Error(`BLOCKED: deep inbox answer ${handle} ${option} must exit 0: ${shown(r)}`);
  return r;
}

/** The command of DeepBuild's waiter entry, as `deep setup` wrote it (Stop's; StopFailure's is the same). */
export const waiterCommand = (home: string): string => String(waiterEntries(readSettings(home)).stop.hook.command);

/**
 * The real waiter entry run by `claude`'s Claude Code stand-in (its child, through `/bin/sh -c`, in a process group of
 * its own) for a Stop whose payload names `as`: a settings file holding DeepBuild's waiter entry alone, so nothing else
 * of DeepBuild's runs for that payload. Its pid is its process group's.
 */
export async function waiterUnder(claude: Claude, home: string, as: Session): Promise<HookRun> {
  const entry = waiterEntries(readSettings(home)).stop.hook;
  const file = join(dirname(home), `waiter-only-${as.id}.json`);
  writeFileSync(file, `${JSON.stringify({ hooks: { Stop: [{ hooks: [entry] }] } })}\n`);
  // The stand-in's own `hook` op with that settings file (helpers' `Claude.hook` always names the user settings file).
  const send = (claude as unknown as { send(command: Line): Promise<Line> }).send.bind(claude);
  const fired = (await send({ op: 'hook', event: 'Stop', payload: payload(as, 'Stop', { last_assistant_message: 'Done.' }), settings: file })) as unknown as { background: HookRun[] };
  const run = fired.background.find((r) => r.asyncRewake);
  if (!run) throw Error(`BLOCKED: the stand-in started no waiter for ${as.id}: ${JSON.stringify(fired)}`);
  groups.add(run.pid);
  return run;
}
/** The stand-in's record of one background run, by its pid: exit code, stderr, whether it ended. */
export async function runOf(claude: Claude, pid: number): Promise<HookRun | undefined> {
  return (await claude.background()).find((r) => r.pid === pid);
}

/** A process this test started directly, its stdout and stderr kept, and its exit. */
export interface Outsider { pid: number; stderr(): string; stdout(): string; exited(): { code: number | null; at: number } | undefined }
/**
 * The real waiter entry started by this test process itself (`/bin/sh -c 'exec <command>'`, or the command as it is when it already execs, so the waiter is the
 * shell's own process and its parent is this test's), with `as`'s Stop payload on stdin: a process outside every
 * agent's process tree, saying hello as that session's waiter. It runs in a process group of its own.
 */
export function outsiderWaiter(home: string, as: Session): Outsider {
  // setup's command may already exec deep-hook; either way the shell becomes the waiter.
  const command = waiterCommand(home);
  const child = spawn('/bin/sh', ['-c', /^\s*exec\s/.test(command) ? command : `exec ${command}`], { cwd: as.cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  groups.add(child.pid!);
  let out = '';
  let err = '';
  let exit: { code: number | null; at: number } | undefined;
  child.stdout!.setEncoding('utf8').on('data', (d: string) => (out += d));
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  child.on('close', (code) => { exit = { code, at: Date.now() }; });
  child.stdin!.on('error', () => undefined);
  child.stdin!.end(JSON.stringify(payload(as, 'Stop', { last_assistant_message: 'Done.' })));
  return { pid: child.pid!, stderr: () => err, stdout: () => out, exited: () => exit };
}

/** Process groups this file started; stopped with `kill(-pgid)` (the group's ID, never a name or a port). */
const groups = new Set<number>();
export function stopGroups(): void {
  for (const pgid of groups) {
    try { process.kill(-pgid, 'SIGTERM'); } catch { /* gone */ }
    setTimeout(() => { try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ } }, 1000).unref();
  }
  groups.clear();
}

/** Whether `text` names `needle` as a whole token (a PID inside a longer number, or a UUID inside a longer word, doesn't count). */
export function names(text: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9A-Za-z_-])${escaped}($|[^0-9A-Za-z_-])`).test(text);
}
/**
 * Where a refusal of the waiter can be read (README, Where a refusal is read): the waiter's own stderr, what the hub
 * wrote to its output since the waiter started, and the record's events appended since then. Returns the first place
 * that names one of `needles`, or undefined. A record event counts only when it also names every one of `alsoInEvent`
 * (so an ordinary event of the bound session, appended meanwhile, isn't taken for a refusal).
 */
export function refusalNaming(o: { waiterStderr: string; hubOutput: string; events: readonly Ev[]; needles: readonly string[]; alsoInEvent?: readonly string[] }): string | undefined {
  for (const n of o.needles) if (names(o.waiterStderr, n)) return `the waiter's stderr names ${n}: ${JSON.stringify(o.waiterStderr.slice(0, 600))}`;
  for (const n of o.needles) {
    const line = o.hubOutput.split('\n').find((l) => names(l, n));
    if (line !== undefined) return `the hub's output names ${n}: ${JSON.stringify(line.slice(0, 600))}`;
  }
  for (const e of o.events) {
    const json = JSON.stringify(e);
    const n = o.needles.find((x) => names(json, x));
    if (n && (o.alsoInEvent ?? []).every((x) => names(json, x))) return `event ${e.kind} ${e.id} names ${n}: ${json.slice(0, 600)}`;
  }
  return undefined;
}
