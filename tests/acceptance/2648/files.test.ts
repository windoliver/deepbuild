// #2648 AC1: "An idle hub with 30 days of history and no session, after 15 s to settle, opens none of the files these
// four timers read over the next 60 s, and makes at most two file-system calls a second on them (drafted), counted by
// the test. On the merge base it reads them on every beat, and the test fails, naming the file read most."
//
// One hub on a home set up with 30 days of history (helpers.ts, setUpWorld), started with the test's counter in every
// thread (fixtures/fs-calls.mjs). The files are the ones the four timers read on a beat at the merge base (README, The
// files the four timers read); a call is counted whichever code makes it. The wrong program is the merge base.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC1, cleanup, FIXTURES, REPO, running, setUpWorld, sleep, startHub, stopHub, type World } from './helpers.ts';

afterAll(cleanup, 120_000);

const SETTLE_MS = 15_000;
const WINDOW_MS = 60_000;
/** "at most two file-system calls a second on them (drafted)". */
const CALLS_A_SECOND = 2;
const COUNTER = join(FIXTURES, 'fs-calls.mjs');
/** The agents whose program the Agents page looks for along the login PATH: each facts file's `agent`. */
const BINARIES = ['claude', 'codex', 'pi', 'opencode', 'cursor-agent'];
const SETTINGS = "Claude Code's settings.json";

interface Call { t: number; pid: number; thread: number; fn: string; path: string; open?: true; every?: number; loaded?: true; main?: boolean }

/**
 * The files the four timers read on a beat at the merge base, each by the name a failure gives it (README): gates.json
 * (gates); extensions/notices.json (the extension host's tick); the job pool's pipe (heavy); and the agents' reach:
 * the hub's config.json for the login PATH, each agent's program along that PATH, Claude Code's settings and local
 * settings and its managed settings, setup's records of Claude Code's and Codex's entries, Codex's trust and config,
 * deep-hook as setup recorded it, and the `.git` each folder above the home would hold.
 */
function timerFiles(w: World): (path: string) => string | undefined {
  const config = JSON.parse(readFileSync(join(w.root, 'config.json'), 'utf8')) as { runner?: { login_path?: string }; hook?: { binary?: string } };
  const named = new Map<string, string>([
    [join(w.root, 'gates.json'), 'gates.json'],
    [join(w.root, 'extensions', 'notices.json'), 'extensions/notices.json'],
    [join(w.root, 'jobserver'), "the job pool's pipe (jobserver)"],
    [join(w.root, 'config.json'), 'config.json (the login PATH)'],
    [join(w.root, 'claude-hooks.json'), 'claude-hooks.json'],
    [join(w.root, 'codex-hooks.json'), 'codex-hooks.json'],
    [join(w.root, 'codex-trust.json'), 'codex-trust.json'],
    [join(w.home, '.claude', 'settings.json'), SETTINGS],
    [join(w.home, '.claude', 'settings.local.json'), "Claude Code's settings.local.json"],
    [w.managed, "Claude Code's managed settings"],
    [join(w.home, '.codex', 'config.toml'), "Codex's config.toml"],
    [join(w.home, '.codex', 'hooks.json'), "Codex's hooks.json"],
    [config.hook?.binary ?? join(REPO, 'target/debug/deep-hook'), 'deep-hook, as setup recorded it'],
  ]);
  for (let dir = w.home; ; dir = dirname(dir)) {
    named.set(join(dir, '.git'), `${join(dir, '.git')} (the repo above the home)`);
    if (dirname(dir) === dir) break;
  }
  for (const dir of (config.runner?.login_path ?? '').split(':').filter(Boolean)) {
    for (const binary of BINARIES) named.set(join(dir, binary), `${binary} along the login PATH`);
  }
  return (path) => named.get(path);
}

interface Tally { opens: number; calls: number; fns: Map<string, number> }
const rate = (n: number, seconds: number) => `${(n / seconds).toFixed(1)} a second`;
const said = (name: string, t: Tally, seconds: number) => `${name}: ${t.opens} opens (${rate(t.opens, seconds)}) and ${t.calls} calls (${rate(t.calls, seconds)}), by ${[...t.fns].map(([fn, n]) => `${fn}×${n}`).join(', ')}`;

/**
 * The criterion's two counts over the window, per file. A file's open counts as a call too. Claude Code's settings.json
 * counts its opens only: a fifth timer, outside the issue, checks its size and time twice a second at the merge base
 * (README, Readings 3). A watchFile counts one call per interval it polls inside the window.
 */
function tally(calls: readonly Call[], label: (path: string) => string | undefined, from: number, to: number): Map<string, Tally> {
  const per = new Map<string, Tally>();
  const add = (name: string, fn: string, open: boolean, n = 1) => {
    const t = per.get(name) ?? { opens: 0, calls: 0, fns: new Map() };
    if (open) t.opens += n;
    if (open || name !== SETTINGS) {
      t.calls += n;
      t.fns.set(fn, (t.fns.get(fn) ?? 0) + n);
    }
    per.set(name, t);
  };
  for (const c of calls) {
    const name = label(c.path);
    if (!name || c.t >= to) continue;
    if (c.fn === 'watchFile' && c.every) add(name, 'watchFile polls', false, Math.floor((to - Math.max(from, c.t)) / c.every));
    else if (c.t >= from) add(name, c.fn, c.open === true);
  }
  return per;
}

describe(`AC1 ${AC1} an idle hub with 30 days of history opens none of the four timers' files over 60 s and makes at most two calls a second on them`, () => {
  it(`AC1 ${AC1} after 15 s to settle, 60 s with no open of gates.json, notices.json, the pipe or the agents' settings and at most 2 calls a second on them`, async () => {
    const w = await setUpWorld(30);
    const log = join(w.tmp, 'fs-calls.jsonl');
    const hub = await startHub(w, { env: { NODE_OPTIONS: `--import=${COUNTER}`, DH2648_FS_LOG: log } });
    let from: number;
    let to: number;
    try {
      await sleep(SETTLE_MS);
      from = Date.now();
      await sleep(WINDOW_MS);
      to = Date.now();
      // A hub that ended in the window makes no calls: that's no reading.
      if (!running(hub.child)) throw Error(`BLOCKED: the hub ended during the window: ${hub.stderr().slice(-800)}`);
    } finally {
      await stopHub(hub);
    }
    const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Call).filter((c) => c.pid === hub.pid);
    const label = timerFiles(w);
    // The counter ran in the hub's main thread and its core's, and saw the hub read these files at its start: a count of
    // nothing in the window is the hub's, not a counter that saw nothing.
    const threads = lines.filter((c) => c.loaded).length;
    if (threads < 2) throw Error(`BLOCKED: the test's counter loaded in ${threads} of the hub's threads, not its main thread and its core's: ${hub.stderr().slice(-800)}`);
    const atStart = lines.filter((c) => !c.loaded && c.t < from && c.open && label(c.path));
    if (!atStart.length) throw Error(`BLOCKED: the counter saw the hub open none of the four timers' files at its start, so it can't count their reads: ${lines.length} calls recorded`);
    const seconds = (to - from) / 1000;
    const per = tally(lines.filter((c) => !c.loaded), label, from, to);
    const ranked = [...per].sort((a, b) => b[1].opens - a[1].opens || b[1].calls - a[1].calls);
    const opens = ranked.reduce((n, [, t]) => n + t.opens, 0);
    const calls = ranked.reduce((n, [, t]) => n + t.calls, 0);
    console.log(`AC1 reading over ${seconds.toFixed(1)} s after ${SETTLE_MS / 1000} s to settle: ${opens} opens and ${calls} calls on the four timers' files (${rate(calls, seconds)})\n  ${ranked.map(([name, t]) => said(name, t, seconds)).join('\n  ') || 'none'}`);
    const [most] = ranked;
    expect(opens, `AC1 ${AC1}: over ${seconds.toFixed(0)} s after ${SETTLE_MS / 1000} s to settle, the idle hub opened the files the four timers read ${opens} times; read most, ${most ? said(most[0], most[1], seconds) : 'none'}. Then ${ranked.slice(1, 6).filter(([, t]) => t.opens).map(([name, t]) => `${name} ${t.opens}`).join(', ') || 'no other'}`).toBe(0);
    const busiest = [...per].sort((a, b) => b[1].calls - a[1].calls)[0];
    expect(calls, `AC1 ${AC1}: over ${seconds.toFixed(0)} s the idle hub made ${calls} file-system calls on the four timers' files, ${rate(calls, seconds)}, over ${CALLS_A_SECOND} a second; most on ${busiest ? said(busiest[0], busiest[1], seconds) : 'none'}`).toBeLessThanOrEqual(CALLS_A_SECOND * seconds);
  }, 900_000);
});
