
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  childEnv, Conn, deep, own, readSettings, shown, waiterEntries, type Claude, type Ev, type Hub, type HookRun, type Line, type Ran, type Session, payload,
} from '../25/routes/helpers.ts';

export const heldToken = (hub: Hub): string => readFileSync(join(hub.root, 'control.token'), 'utf8').trim();

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

export async function answerAsYou(hub: Hub, token: string, handle: string, option: string): Promise<Ran> {
  const you = join(dirname(hub.home), 'y');
  mkdirSync(join(you, '.deepbuild'), { recursive: true, mode: 0o700 });
  writeFileSync(join(you, '.deepbuild', 'control.token'), `${token}\n`, { mode: 0o600 });
  writeFileSync(join(you, '.deepbuild', 'config.json'), `${JSON.stringify({ hub: { address: `unix:${hub.socket}` } })}\n`);
  const r = await deep(you, ['inbox', 'answer', handle, option]);
  if (r.code !== 0) throw Error(`BLOCKED: deep inbox answer ${handle} ${option} must exit 0: ${shown(r)}`);
  return r;
}

export const waiterCommand = (home: string): string => String(waiterEntries(readSettings(home)).stop.hook.command);

export async function waiterUnder(claude: Claude, home: string, as: Session): Promise<HookRun> {
  const entry = waiterEntries(readSettings(home)).stop.hook;
  const file = join(dirname(home), `waiter-only-${as.id}.json`);
  writeFileSync(file, `${JSON.stringify({ hooks: { Stop: [{ hooks: [entry] }] } })}\n`);
  const send = (claude as unknown as { send(command: Line): Promise<Line> }).send.bind(claude);
  const fired = (await send({ op: 'hook', event: 'Stop', payload: payload(as, 'Stop', { last_assistant_message: 'Done.' }), settings: file })) as unknown as { background: HookRun[] };
  const run = fired.background.find((r) => r.asyncRewake);
  if (!run) throw Error(`BLOCKED: the stand-in started no waiter for ${as.id}: ${JSON.stringify(fired)}`);
  groups.add(run.pid);
  return run;
}
export async function runOf(claude: Claude, pid: number): Promise<HookRun | undefined> {
  return (await claude.background()).find((r) => r.pid === pid);
}

export interface Outsider { pid: number; stderr(): string; stdout(): string; exited(): { code: number | null; at: number } | undefined }
export function outsiderWaiter(home: string, as: Session): Outsider {
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

const groups = new Set<number>();
export function stopGroups(): void {
  for (const pgid of groups) {
    try { process.kill(-pgid, 'SIGTERM'); } catch {}
    setTimeout(() => { try { process.kill(-pgid, 'SIGKILL'); } catch {} }, 1000).unref();
  }
  groups.clear();
}

export function names(text: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9A-Za-z_-])${escaped}($|[^0-9A-Za-z_-])`).test(text);
}
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
