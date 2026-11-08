// Shared test-side tools for #1022 (README): a temp home with the hub as a process, Codex's hooks run as Codex runs
// them (`deep-hook codex <event>`, the payload on stdin), the recorded /compact run replayed from fixtures/, the record
// read over the control socket, and the one judge every test uses. Parts are adapted from tests/acceptance/39/helpers.ts
// (same repo, same license); this suite keeps its own copy so a redraft of #39's never moves these tests. Nothing here
// stands in for DeepBuild: deep-hook, the hub and the record are the real ones built at the checkout.
//
// Safety: every folder is under /tmp/dh1022-*; no network, no model, no real codex (a stub on PATH prints a version);
// a process a test starts is stopped by its PID, never by name or port.
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const HOOK = join(REPO, 'target/debug/deep-hook');
const NODE = process.execPath;
for (const f of [CLI, HOOK]) if (!existsSync(f)) throw Error(`BLOCKED: ${f} is not built (npm run build --workspaces; cargo build -p deep-hook)`);

// Criterion tags: `#1022.<first 8 hex of the SHA-256 of the criterion's text>`, as scripts/proof-change.mjs computes them.
export const AC1 = 'AC1 #1022.616badd8';
export const AC2 = 'AC2 #1022.afb0a4f3';
export const AC3 = 'AC3 #1022.77e6168c';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const parseObject = (raw: string): Line | undefined => {
  try { const v: unknown = JSON.parse(raw); return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Line) : undefined; } catch { return undefined; }
};
for (const key of Object.keys(process.env)) if (key.startsWith('DEEP_') || key.startsWith('CLAUDE')) delete process.env[key];

// ---- Temp folders under /tmp/dh1022-* (a socket path must fit in 104 bytes); processes stopped by PID only.
const made: string[] = [];
const owned = new Set<number>();
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const end = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < end) await sleep(50);
  for (const pid of owned) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
}

export interface World { tmp: string; home: string; bin: string; root: string; hub: ChildProcess; pid: number; output(): string }
function env(w: Pick<World, 'tmp' | 'home' | 'bin'>): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(DEEP_|CLAUDE|XDG_|OPENAI_|CODEX_|ANTHROPIC_|GH_|GITHUB_)/.test(k) && k !== 'NODE_OPTIONS') e[k] = v;
  return Object.assign(e, { HOME: w.home, XDG_CONFIG_HOME: join(w.home, '.config'), XDG_CACHE_HOME: join(w.home, '.cache'), SHELL: '/bin/sh', LC_ALL: 'C', PATH: `${w.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, DEEP_HUB_TEST_CONFIRM: join(w.tmp, 'confirm') });
}

/** A temp home (`<tmp>/h`) with the hub running in it as its own process. */
export async function world(): Promise<World> {
  const tmp = realpathSync(mkdtempSync('/tmp/dh1022-'));
  made.push(tmp);
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(join(home, '.codex', 'sessions'), { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(bin);
  const stub = (name: string, body: string) => { writeFileSync(join(bin, name), body); chmodSync(join(bin, name), 0o755); };
  for (const n of ['launchctl', 'systemctl', 'claude']) stub(n, '#!/bin/sh\nexit 0\n');
  stub('codex', '#!/bin/sh\n[ "$1" = --version ] && echo "codex-cli 0.144.0"\nexit 0\n');
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const hub = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: env({ tmp, home, bin }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (hub.pid) owned.add(hub.pid);
  let out = '';
  hub.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 120_000);
    let first = '';
    hub.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; first += d; if (first.includes('\n')) { clearTimeout(timer); resolve(parseObject(first.split('\n')[0]!)?.ready === true); } });
    hub.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start: ${out.slice(0, 1500)}`);
  return { tmp, home, bin, root: join(home, '.deepbuild'), hub, pid: hub.pid!, output: () => out };
}

/**
 * `deep-hook codex <event>` with the hook's JSON on stdin, as Codex runs an entry. `lost` is the request's ID when
 * deep-hook says it could neither hand the hook to the hub in time nor spool it: deep-hook fails open, so under
 * machine load such a hook may never reach the record.
 */
export function hook(w: World, event: string, payload: Line): Promise<{ code: number | null; stdout: string; stderr: string; lost: string | undefined }> {
  return new Promise((resolve) => {
    const child = spawn(HOOK, ['codex', event], { cwd: typeof payload.cwd === 'string' && existsSync(payload.cwd) ? payload.cwd : w.tmp, env: env(w), stdio: ['pipe', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, lost: /could not spool (\S+)/.exec(stderr)?.[1] }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(payload));
  });
}

// ---- The recorded run (fixtures/, README: The recorded payloads): a live `/compact` in the Codex CLI 0.144.0 TUI.
export interface Recorded { event: string; at: number; payload: Line }
export interface Run { session: string; hooks: Recorded[]; transcript: string; rollout: { at: number; raw: string }[] }
/** The recorded hooks and rollout, their paths moved into this world: the rollout under its home, the cwd beside it. */
export function recorded(w: World): Run {
  const place = (s: string) => s.split('@T1@/home/').join(`${w.home}/`).split('@T1@').join(w.tmp);
  const hooks = readFileSync(join(FIXTURES, 'hooks.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(place(l)) as Recorded);
  const rollout = readFileSync(join(FIXTURES, 'rollout.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => place(l)).map((raw) => ({ at: Date.parse(String(parseObject(raw)?.timestamp)), raw }));
  const first = hooks[0]!.payload;
  mkdirSync(String(first.cwd), { recursive: true });
  mkdirSync(dirname(String(first.transcript_path)), { recursive: true });
  writeFileSync(String(first.transcript_path), '');
  return { session: String(first.session_id), hooks, transcript: String(first.transcript_path), rollout };
}
/**
 * Fires each hook in its recorded order, with the rollout written up to the hook's recorded time first, as Codex had
 * written it when that hook ran; `hooks` may be a part of the recorded list, or the list with a hook fired again or added.
 */
export async function replay(w: World, run: Run, hooks: Recorded[] = run.hooks): Promise<void> {
  let written = 0;
  const upTo = (at: number) => {
    const lines = run.rollout.slice(written).filter((r) => r.at <= at);
    for (const r of lines) appendFileSync(run.transcript, `${r.raw}\n`);
    written += lines.length;
  };
  for (const [i, h] of hooks.entries()) {
    upTo(h.at);
    // What Codex wrote after this hook and before the next, such as a prompt's own entry, lands as the hook returns.
    await deliver(w, run.session, h.event, h.payload, () => upTo(hooks[i + 1]?.at ?? Infinity));
  }
  upTo(Infinity);
}
/**
 * Fires one hook so that it reaches the hub, then waits for the record to settle, so a hub still busy with one hook
 * doesn't drop the next. A hook deep-hook says it lost under load (`hook`) that left the session's record unchanged is
 * fired again, up to 5 times: one that reached the hub and recorded something is never sent twice. (A copy that
 * reached the hub and recorded nothing is the one case sent again; for a duplicate PreCompact that is one more
 * duplicate, which a hub that holds the compaction once still records once, and a hub that records every copy still
 * records twice.)
 */
export async function deliver(w: World, session: string, event: string, payload: Line, fired: () => void = () => undefined): Promise<void> {
  const before = (await sessionEvents(w, session)).length;
  for (let tries = 1; ; tries++) {
    const r = await hook(w, event, payload);
    fired();
    if (r.code !== 0) throw Error(`BLOCKED: deep-hook codex ${event} exited ${r.code}: ${r.stderr.slice(-800)}`);
    const events = await settled(w, session);
    if (!r.lost || events.length !== before) return;
    if (tries >= 5) throw Error(`INCONCLUSIVE: deep-hook dropped this ${event} hook ${tries} times under machine load (load average ${loadavg()[0]!.toFixed(0)}), so the record can't show it: ${r.stderr.trim().slice(0, 300)}`);
  }
}

// ---- The record, over the control socket (#16's line protocol).
export function control(w: World, method: string, params: Line = {}, timeoutMs = 30_000): Promise<Line> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(join(w.root, 'hub.sock'));
    let buffer = ''; let stage = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${method}`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = parseObject(buffer.slice(0, i)) ?? {};
        buffer = buffer.slice(i + 1);
        if (stage === 0) { stage = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(join(w.root, 'control.token'), 'utf8').trim() })}\n`); }
        else if (stage === 1) { stage = 2; sock.write(`${JSON.stringify({ v: 1, id: 'c1', method, params })}\n`); }
        else if (line.id === 'c1') { clearTimeout(timer); sock.destroy(); if ('error' in line) reject(Error(`${method} refused: ${JSON.stringify(line.error)}`)); else resolve(line.result as Line); }
      }
    });
  });
}
export interface Ev { id: string; kind: string; log_pos: number; ts: number; session?: string; data: Line }
export async function sessionEvents(w: World, session: string): Promise<Ev[]> {
  const out: Ev[] = [];
  for (let from = 0; ;) {
    const page = ((await control(w, 'events.read', { from, limit: 1000 })).events ?? []) as Ev[];
    out.push(...page);
    if (page.length < 1000) return out.filter((e) => e.session === session);
    from = page.at(-1)!.log_pos;
  }
}
/** Whether deep-hook's spool still holds lines the hub hasn't replayed (a hook the hub was late for, under load). */
function spooling(w: World): boolean {
  const folder = join(w.root, 'spool');
  return existsSync(folder) && readdirSync(folder).some((f) => f.endsWith('.jsonl') && statSync(join(folder, f)).size > 0);
}
/**
 * The session's events once every hook fired has reached the hub, live or from deep-hook's spool, and the record has
 * held still for 4 s: readings are appended off the hook's path, and the hub holds a prompt up to 3 s to place it
 * against its transcript entry.
 */
export async function settled(w: World, session: string): Promise<Ev[]> {
  let last = -1; let still = Date.now();
  for (const end = Date.now() + 60_000; ;) {
    const events = await sessionEvents(w, session);
    const top = events.at(-1)?.log_pos ?? 0;
    if (top !== last || spooling(w)) { last = top; still = Date.now(); }
    else if (Date.now() - still >= 4000) return events;
    if (Date.now() > end) throw Error(`BLOCKED: the record didn't settle within 60 s (spool still holding lines: ${spooling(w)})`);
    await sleep(250);
  }
}
export const readings = (events: readonly Ev[]) => events.filter((e) => e.kind === 'session.reading');
export const asks = (events: readonly Ev[]) => events.filter((e) => e.kind === 'user.ask');
export const said = (e: Ev) => `log ${e.log_pos} ${e.kind} ${JSON.stringify(e.data)}`;

/**
 * For one `/compact` in the session: a PreCompact or PostCompact reading recorded more or fewer times than once, each
 * named by its log position and content. A reading is the hook's when its text names the hook, as the issue's record
 * does ("PreCompact: the context compacts (manual)").
 */
export function compactionReadings(events: readonly Ev[]): string[] {
  const out: string[] = [];
  for (const hookName of ['PreCompact', 'PostCompact']) {
    const found = readings(events).filter((e) => String(e.data.reading).includes(hookName));
    if (found.length !== 1) out.push(`${found.length} ${hookName} readings for one /compact (want exactly 1)${found.length ? `: ${found.map(said).join(' | ')}` : ''}`);
  }
  return out;
}
/** Every user.ask that isn't one of the prompts typed (`typed`), such as one for the command, named by its log position. */
export function commandAsks(events: readonly Ev[], typed: readonly string[]): string[] {
  const extra = asks(events).filter((e) => !typed.includes(String(e.data.text)));
  return extra.length ? [`a user.ask for the command, which is no prompt you typed: ${extra.map(said).join(' | ')}`] : [];
}
/** The judge (AC3): every duplicate the record holds for one `/compact`; empty when it holds the compaction once. */
export const duplicates = (events: readonly Ev[], typed: readonly string[]): string[] => [...compactionReadings(events), ...commandAsks(events, typed)];
