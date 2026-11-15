// Test-side tools for #2120's acceptance tests on sessions DeepBuild starts (README): #1330's world, approvals and
// `deep start` (imported by path), with #1325's Claude Code stand-in (read by path, its two placeholders filled as
// those suites fill them) behind a gate this suite adds; the hub stopped and started again on the same home; and two
// start.session requests written on one connection, the second without waiting for the first. Nothing here stands in
// for the hub, deep-hook, git or the worktree; only the agent is played.
//
// Safety: every folder is #1330's test home under /Users/Shared/dh1330-*, removed by #1330's own afterAll. Processes
// are stopped by PID only: a hub started again here becomes the world's, which #1330's closeWorld stops; a gated agent
// still running at the end is stopped here, only while its command line still names its test home. No model, no
// sign-in, nothing beyond 127.0.0.1.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import { CLI, Client, NODE, alive, envFor, newestClaude, realOr, sh, shown, sleep, waitFor, type Hub, type Line, type Ran, type World } from '../1330/helpers.ts';

/** #1325's Claude Code stand-in: #1330's, with `[standin:bash:<base64url>]` turns. */
const STAND_IN = fileURLToPath(new URL('../1325/fixtures/claude.mjs', import.meta.url));

/** A step a criterion's reading stands on: any failure in it reads BLOCKED, never as the criterion's own failure. */
export async function blocked<T>(what: string, step: () => Promise<T> | T): Promise<T> {
  try {
    return await step();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw Error(message.startsWith('BLOCKED') ? message : `BLOCKED: ${what}: ${message}`);
  }
}

/** What `deep start --json` reported for a start it made; BLOCKED when it made none. */
export function started(r: Ran, what: string): { run: string; worktree: string; branch: string } {
  if (r.code !== 0 || r.out?.status !== 'started' || typeof r.out.run !== 'string' || typeof r.out.worktree !== 'string') throw Error(`BLOCKED: ${what} must start: ${shown(r)}`);
  return { run: r.out.run, worktree: r.out.worktree, branch: String(r.out.branch ?? '') };
}

/** A prompt whose one turn runs `command` with the Bash tool (#1325's stand-in). */
export const bashTurn = (words: string, command: string): string => `${words} [standin:bash:${Buffer.from(command, 'utf8').toString('base64url')}]`;

// ---- The agent: #1325's stand-in, as `claude` on the world's login PATH, behind a gate.
const gated: { pid: number; home: string }[] = [];
const commandOf = (pid: number): string => {
  try { return execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim(); } catch { return ''; }
};

export interface Gate {
  /** Lets every waiting agent go on: each becomes the stand-in, under the PID it waited with. */
  open(): void;
  /** The PID of the agent waiting at the gate in `worktree`, once it waits there. */
  waiting(worktree: string, ms: number): Promise<number>;
}
/**
 * Installs the stand-in as the world's `claude`: `bin/claude` is a shell script that answers `--version` at once and,
 * for anything else, waits while the gate file is missing (noting its PID and folder in `~/.gated/<pid>`), then execs
 * the stand-in (`bin/claude.mjs`), which keeps its PID. Ungated, the gate is open from the start. A gated agent gives up
 * after 300 s.
 */
export function installStandIn(w: World, o: { gated?: boolean } = {}): Gate {
  const program = readFileSync(STAND_IN, 'utf8').replace(/^#!.*\n/, `#!${NODE}\n`)
    .replace("'__VERSION__'", JSON.stringify(newestClaude())).replace("'__LOGDIR__'", JSON.stringify(join(w.home, '.standin')));
  writeFileSync(join(w.bin, 'claude.mjs'), program, { mode: 0o755 });
  const gate = join(w.home, 'gate');
  const marks = join(w.home, '.gated');
  mkdirSync(marks, { recursive: true });
  if (!o.gated) writeFileSync(gate, 'open\n');
  writeFileSync(join(w.bin, 'claude'), [
    '#!/bin/sh',
    "# #2120's stand-in for Claude Code: #1325's (claude.mjs beside this file), once the gate file exists.",
    'case " $* " in *" --version "*) ;; *)',
    `  if [ ! -e ${sh(gate)} ]; then`,
    `    pwd -P > ${sh(marks)}/$$`,
    '    n=0',
    `    while [ ! -e ${sh(gate)} ] && [ "$n" -lt 3000 ]; do sleep 0.1; n=$((n + 1)); done`,
    `    [ -e ${sh(gate)} ] || exit 3`,
    '  fi ;;',
    'esac',
    `exec ${sh(NODE)} ${sh(join(w.bin, 'claude.mjs'))} "$@"`,
    '',
  ].join('\n'), { mode: 0o755 });
  return {
    open: () => writeFileSync(gate, 'open\n'),
    waiting: (worktree, ms) => waitFor(() => {
      const want = realOr(worktree);
      for (const name of existsSync(marks) ? readdirSync(marks) : []) {
        const pid = Number(name);
        if (!Number.isSafeInteger(pid) || readFileSync(join(marks, name), 'utf8').trim() !== want) continue;
        if (!gated.some((g) => g.pid === pid)) gated.push({ pid, home: w.home });
        if (alive(pid)) return pid;
      }
      return undefined;
    }, ms, `an agent waiting at the gate in ${worktree}`),
  };
}

// ---- The hub stopped and started again: SIGTERM by its PID, then `deep hub run` on the same home, as #1330 starts it.
async function hubOn(w: World): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], {
    cwd: w.home, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    env: envFor(w, { DEEP_HUB_PLANT: w.plant, DEEP_HUB_TEST_CONFIRM: join(w.home, 'confirm'), DEEP_HUB_TEST_FORGE: 'http://127.0.0.1:9' }),
  });
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise((resolve) => child.on('exit', resolve));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        out += d;
        if (out.includes('\n')) { try { resolve(JSON.parse(out.split('\n')[0]!) as Line); } catch { resolve(undefined); } }
      });
    }),
    exit.then(() => undefined),
    sleep(120_000).then(() => undefined),
  ]);
  if (ready?.ready !== true) {
    if (child.pid && alive(child.pid)) try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ }
    throw Error(`BLOCKED: the hub didn't start again on ${w.home}: ${err.slice(-800)}`);
  }
  return { pid: child.pid!, socket: String(ready.socket), child, exit, stderr: () => err };
}
/** The world's hub stopped (SIGTERM, by its PID) and started again on the same home; the world's client is the new hub's. */
export async function restartHub(w: World): Promise<void> {
  w.client.close();
  try { process.kill(w.hub.pid, 'SIGTERM'); } catch { /* gone */ }
  const stopped = await Promise.race([w.hub.exit.then(() => true), sleep(60_000).then(() => false)]);
  if (!stopped) throw Error(`BLOCKED: the hub (PID ${w.hub.pid}) didn't stop within 60 s of SIGTERM`);
  w.hub = await hubOn(w);
  w.client = await Client.open(w.hub.socket, w.root);
}

// ---- Two starts at once: start.session, the request `deep start` sends, twice on one cli connection.
/**
 * One cli connection whose hello names this process as its peer, as `deep start` names its own; then one start.session
 * request per issue, all in one write, so none waits for another. Each reply's result, or `{ error }`, in issue order.
 */
export async function startsAtOnce(w: World, issues: number[], prompt = 'Say ready.'): Promise<Line[]> {
  const token = readFileSync(join(w.root, 'control.token'), 'utf8').trim();
  const peer = { pid: process.pid, start: execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim() };
  const sock = net.connect(w.hub.socket);
  const lines: Line[] = [];
  let buffer = '';
  sock.setEncoding('utf8');
  sock.on('data', (chunk: string) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      try { lines.push(JSON.parse(buffer.slice(0, i)) as Line); } catch { /* not a line */ }
      buffer = buffer.slice(i + 1);
    }
  });
  sock.on('error', () => undefined);
  try {
    await new Promise<void>((resolve, reject) => { sock.once('connect', resolve); sock.once('error', reject); });
    await waitFor(() => lines.length > 0, 5000, "the hub's hello");
    sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token, peer })}\n`);
    await waitFor(() => lines.some((l) => l.role === 'cli'), 5000, 'the cli role');
    const ids = issues.map((issue) => `start.session#${issue}`);
    sock.write(issues.map((issue, i) => `${JSON.stringify({ v: 1, id: ids[i], method: 'start.session', params: { repo: w.repo, issue, agent: 'claude-code', prompt } })}\n`).join(''));
    return await waitFor(() => {
      const replies = ids.map((id) => lines.find((l) => l.id === id));
      return replies.every(Boolean) ? replies.map((r) => ('error' in r! ? { error: r!.error } : r!.result) as Line) : undefined;
    }, 180_000, `the replies to ${ids.join(' and ')}`);
  } finally {
    sock.destroy();
  }
}

/** Gated agents still running at the end, by PID, while their command line names their test home. */
afterAll(async () => {
  const left = gated.splice(0).filter((g) => alive(g.pid) && commandOf(g.pid).includes(g.home)).map((g) => g.pid);
  for (const pid of left) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while (left.some(alive) && Date.now() < deadline) await sleep(100);
  for (const pid of left) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}, 30_000);
