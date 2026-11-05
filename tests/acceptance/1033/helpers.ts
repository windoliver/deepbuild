// Shared tools for #1033's acceptance tests (README): the criterion tags, the fixture mods installed into a Claude
// Code home, the `claude` stand-in, the world the session works in (#29's, with the guard entry and the send class
// added), the hub as a process with the machine's managed settings named, and the replay of the fixture session
// through the real deep-hook into `deep hub run`. The world, the hub's socket reads and the Claude Code session are
// #29's (tests/acceptance/29/h-d.ts), imported, never copied. Nothing here stands in for the hub, deep-hook, the
// gate or the doctor; only the `claude` binary is a stand-in (fixtures/bin/claude).
//
// Safety: every folder is under /tmp/dh29-* (made by ../29/h-d.ts) and removed by `cleanup`; no network, no model, no
// real `claude`; a process a test starts is stopped by its PID only, never by name or port.

import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  allEvents, askNamed, BEHAVIOR, childEnv, CLI, decision, DEEP_HOOK, draftFor, lockedFor, makeWorld, NODE, own, parseObject, REPO, req,
  Session, settle, shown, sleep, stopHub, taskOf, type Ev, type Hub, type Line, type Ran, type World,
} from '../29/h-d.ts';

export { cleanup, type Line } from '../29/h-d.ts';
export { REPO, NODE };

// ---- Criterion tags: `#1033.<first 8 hex of the SHA-256 of the criterion's text>`, as scripts/proof-change.mjs's
// readIssue computes them (README, Criteria to tests).
export const AC1 = 'AC1 #1033.80415399';
export const AC2 = 'AC2 #1033.2e71c00e';
export const AC3 = 'AC3 #1033.a97a9989';
export const AC4 = 'AC4 #1033.3511f899';
export const AC5 = 'AC5 #1033.74a70e92';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
/** The folder holding the `claude` stand-in, put first on PATH. */
export const STUB_BIN = join(FIXTURES, 'bin');

// ---- The fixture mods (README, The mods).
/** The mod whose tool.check approves every call. */
export const APPROVER = 'approve-all';
/** The mod that draws a band and handles no tool or prompt event. */
export const BAND = 'status-band';
const MARKET = 'fixtures';

/**
 * Installs `names` into the Claude Code home `<home>/.claude` the way Claude Code installs a plugin: its folder under
 * `plugins/cache/<marketplace>/<name>/<version>/`, an entry in `plugins/installed_plugins.json`, and `enabledPlugins`
 * in `settings.json`. Each mod's code, once loaded, writes `sentinel`. `unreadable`: `registry` writes the registry as
 * text that isn't JSON; `validate` makes `claude plugin validate` fail on every installed plugin.
 */
export function installMods(home: string, names: readonly string[], sentinel: string, unreadable?: 'registry' | 'validate'): void {
  const claude = join(home, '.claude');
  const plugins: Record<string, Line[]> = {};
  for (const name of names) {
    const installPath = join(claude, 'plugins', 'cache', MARKET, name, '1.0.0');
    mkdirSync(dirname(installPath), { recursive: true });
    cpSync(join(FIXTURES, 'mods', name), installPath, { recursive: true });
    const code = join(installPath, 'mod.mjs');
    writeFileSync(code, readFileSync(code, 'utf8').replace('__SENTINEL__', sentinel));
    if (unreadable === 'validate') writeFileSync(join(installPath, 'unreadable'), 'claude plugin validate fails here\n');
    plugins[`${name}@${MARKET}`] = [{ scope: 'user', installPath, version: '1.0.0', installedAt: '2026-11-02T09:00:00.000Z', lastUpdated: '2026-11-02T09:00:00.000Z', isLocal: true }];
  }
  mkdirSync(join(claude, 'plugins'), { recursive: true });
  writeFileSync(join(claude, 'plugins', 'installed_plugins.json'), unreadable === 'registry' ? '{"version": 2, "plugins": {"approve-all@fixtures": [\n' : `${JSON.stringify({ version: 2, plugins }, null, 2)}\n`);
  const file = join(claude, 'settings.json');
  const settings = (existsSync(file) ? parseObject(readFileSync(file, 'utf8')) : undefined) ?? {};
  settings.enabledPlugins = { ...(settings.enabledPlugins ?? {}), ...Object.fromEntries(names.map((n) => [`${n}@${MARKET}`, true])) };
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  chmodSync(join(STUB_BIN, 'claude'), 0o755);
}

/** The PATH every process of a test gets: the `claude` stand-in first, then Node's folder and the system's. */
export const stubPath = (): string => `${STUB_BIN}:${dirname(NODE)}:/usr/bin:/bin`;

// ---- The world (README, The world).
/** The guard entry that denies the session's force push. */
export const GUARD = 'no-force-push';
export const PUSH = 'git push --force origin main';
/** The send, an MCP tool rules.json counts as a send. */
export const SEND_TOOL = 'mcp__chat__post_message';
const CHECK = '.deepbuild/checks/expired-token.sh';
const CHECK_BODY = '#!/bin/sh\n# Drafted check: an expired token is rejected.\nnode --test .deepbuild/checks/expired-token.test.mjs\n';
const TEST_FILE = '.deepbuild/checks/expired-token.test.mjs';
const TEST_BODY = [
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { readFileSync } from 'node:fs';",
  "test('an expired token is rejected: src/auth.ts compares the expiry with Date.now()', () => {",
  "  assert.ok(readFileSync('src/auth.ts', 'utf8').includes('Date.now()'), 'src/auth.ts does not compare with Date.now()');",
  '});',
  '',
].join('\n');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: cwd, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  }).trim();
}

export interface Machine extends World {
  /** The file a mod's code writes when it is loaded. */
  sentinel: string;
  /** Claude Code's managed settings on this machine: the file, present or not. */
  managed: string;
}
/**
 * #29's world (its home, guards, ask settings, confirmation stub and repo), with: the fix check for BEHAVIOR committed
 * as the repo's HEAD (a node:test file whose assertion fails until src/auth.ts compares with Date.now()); the guard
 * entry GUARD (block, `run:git push --force`) and the class `send` for SEND_TOOL in rules.json; the fixture mod
 * APPROVER installed in the home's Claude Code; and, with `managed`, Claude Code's managed settings present.
 */
export function machine(o: { managed: boolean }): Machine {
  const made = makeWorld({ drafts: [draftFor(BEHAVIOR, { requirements: [req('R1', 'An expired token is rejected', { check: CHECK, asserts: [`${TEST_FILE}:5`] })] })] });
  writeFileSync(join(made.repo, CHECK), CHECK_BODY, { mode: 0o755 });
  writeFileSync(join(made.repo, TEST_FILE), TEST_BODY);
  git(made.repo, ['add', '-A']);
  git(made.repo, ['commit', '-q', '-m', 'the drafted check']);
  const w: World = { ...made, base: git(made.repo, ['rev-parse', 'HEAD']) };
  const rules = JSON.parse(readFileSync(join(w.root, 'rules.json'), 'utf8')) as Line;
  rules.entries[GUARD] = {
    match: 'run:git push --force', scope: 'all_repos', mode: 'block',
    reason: 'A force push rewrites the remote branch for everyone who works on it.', next_step: 'Push without --force, or ask the person to.', fail_closed: false,
  };
  rules.classes = { ...(rules.classes ?? {}), [SEND_TOOL]: 'send' };
  writeFileSync(join(w.root, 'rules.json'), `${JSON.stringify(rules, null, 2)}\n`);
  const sentinel = join(w.tmp, 'mod-was-loaded');
  installMods(w.home, [APPROVER], sentinel);
  const managed = join(w.tmp, 'managed-settings.json');
  if (o.managed) writeFileSync(managed, `${JSON.stringify({ permissions: { deny: [] } }, null, 2)}\n`);
  return { ...w, sentinel, managed };
}

/**
 * `deep hub run` as ../29/h-d.ts starts it, with PATH the stand-in's and DEEP_HUB_TEST_MANAGED_SETTINGS naming the
 * machine's managed settings file (absent when the machine has none). A hub that doesn't start is BLOCKED.
 */
export async function startHub(m: Machine): Promise<Hub> {
  const env = childEnv(m.home, { DEEP_HUB_TEST_CONFIRM: m.confirm, DEEP_HUB_TEST_DRAFTS: m.drafts, DEEP_HUB_TEST_WORK: m.work, DEEP_HUB_TEST_MANAGED_SETTINGS: m.managed, PATH: stubPath() });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        out += d;
        if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!));
      });
    }),
    exit.then(() => undefined),
    sleep(120_000).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub did not start: ${err.slice(-1500)}`);
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: m.home, root: m.root, child, exit, readyAt: Date.now(), clock: undefined, plant: undefined, stderr: () => err };
}

/** The deep CLI and deep-hook, built; either missing is BLOCKED. */
export function built(): void {
  for (const [what, path] of [['the deep CLI (npm run build --workspaces)', CLI], ['deep-hook (cargo build -p deep-hook)', DEEP_HOOK]] as const) {
    if (!existsSync(path)) throw Error(`BLOCKED: ${what} is not built at ${path}`);
  }
}

// ---- The fixture session (README, The session) and its replay.
export interface Case { payload: Line; entry?: Line; effect?: { edit: string; from: string; to: string }; wait?: 'locked'; tag?: string }
/** The fixture session's hook calls, in order: fixtures/session/events.jsonl. */
export const recorded = (): Case[] => readFileSync(join(FIXTURES, 'session', 'events.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Case);
const caseTagged = (tag: string): Case => {
  const found = recorded().find((c) => c.tag === tag);
  if (!found) throw Error(`BLOCKED: the fixture session has no case tagged ${tag}`);
  return found;
};
/** The force push's tool-use ID, and the repeated send's, as the fixture session holds them. */
export const PUSH_CALL = String(caseTagged('force push').payload.tool_use_id);
export const SEND_CALL = String(caseTagged('send').payload.tool_use_id);
export const RESEND_CALL = String(caseTagged('repeated send').payload.tool_use_id);

const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${randomUUID().replaceAll('-', '')}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });

export interface Replay {
  machine: Machine;
  session: string;
  /** deep-hook's reply to each hook call, by its case's tag or tool-use ID and event. */
  replies: Map<string, Ran>;
  /** The task BEHAVIOR opened. */
  task: string;
  /** The claim the stop made for it, `claim:<id>`, or undefined. */
  claim: string | undefined;
  events: Ev[];
  stderr: string;
}
const key = (c: Case): string => `${String(c.payload.hook_event_name)} ${String(c.payload.tool_use_id ?? c.tag ?? '')}`;

/**
 * Replays the fixture session into a hub on `m`, each hook through `deep-hook claude-code <event>` as a child of the
 * session's own Claude Code process (#29's Session), its transcript written as Claude Code writes it, `{repo}` read
 * as the world's repo. After the prompt it waits for the task's definition to lock. A call deep-hook denied runs anyway
 * (its PostToolUse is sent, as the mod approved it) unless `denyHolds`, when, as Claude Code does with the deny
 * holding, the call's result is the denial and no PostToolUse fires. After the Stop it waits for the claim's verdict,
 * then for the record to stay quiet for 3 s, and stops the hub.
 */
export async function replay(m: Machine, o: { denyHolds: boolean }): Promise<Replay> {
  built();
  const hub = await startHub(m);
  try {
    const s = new Session(m);
    const replies = new Map<string, Ran>();
    const denied = new Set<string>();
    let task: string | undefined;
    for (const c of recorded()) {
      const fields = JSON.parse(JSON.stringify(c.payload).replaceAll('{repo}', m.repo)) as Line;
      const event = String(fields.hook_event_name);
      delete fields.hook_event_name;
      const id = typeof fields.tool_use_id === 'string' ? fields.tool_use_id : undefined;
      if (event === 'SessionStart') s.prompt = undefined;
      if (event === 'UserPromptSubmit') {
        s.prompt = randomUUID();
        s.entry({ promptId: s.prompt, type: 'user', message: { role: 'user', content: fields.prompt }, ...(c.entry ?? {}) });
      }
      if (event === 'PreToolUse') s.entry(assistant([{ type: 'tool_use', id, name: fields.tool_name, input: fields.tool_input }], 'tool_use'));
      if (event === 'PostToolUse' && id && denied.has(id) && o.denyHolds) {
        const why = replies.get(`PreToolUse ${id}`);
        s.entry({ promptId: s.prompt, type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', is_error: true, content: (why?.stderr || why?.stdout || 'denied').trim() }] } });
        continue;
      }
      if (c.effect) writeFileSync(join(m.repo, c.effect.edit), readFileSync(join(m.repo, c.effect.edit), 'utf8').replace(c.effect.from, c.effect.to));
      if (event === 'PostToolUse') s.entry({ promptId: s.prompt, type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: JSON.stringify(fields.tool_response) }] }, toolUseResult: fields.tool_response });
      if (event === 'Stop') s.entry(assistant([{ type: 'text', text: fields.last_assistant_message }], 'end_turn'));
      const ran = await s.hook(event, fields);
      replies.set(key(c), ran);
      if (event === 'PreToolUse' && id && decision(ran) === 'deny') denied.add(id);
      if (c.wait === 'locked') {
        const opened = await settle(hub, (e) => { const ref = taskOf(askNamed(e, s, String(fields.prompt))); return ref !== undefined && lockedFor(e, ref).length > 0; }, 180_000);
        task = taskOf(askNamed(opened, s, String(fields.prompt)));
        if (!task || !lockedFor(opened, task).length) throw Error(`BLOCKED: the prompt "${String(fields.prompt)}" opened no task with a locked definition (hub stderr ${JSON.stringify(hub.stderr().slice(-800))})`);
      }
    }
    if (!task) throw Error('BLOCKED: the fixture session has no prompt that waits for its task');
    const claimOf = (events: readonly Ev[]): string | undefined => {
      const made = events.filter((e) => e.kind === 'claim.made' && e.session === s.id && e.data.task_ref === task).at(-1);
      return made ? `claim:${made.id}` : undefined;
    };
    let events = await settle(hub, (e) => { const claim = claimOf(e); return claim !== undefined && e.some((x) => x.kind === 'verdict.made' && x.subject === claim); }, 300_000);
    // What lands after the verdict (an ask raised, a verdict made again): read until the record is quiet for 3 s.
    for (let last = events.length; ;) {
      await sleep(3000);
      events = await allEvents(hub);
      if (events.length === last) break;
      last = events.length;
    }
    return { machine: m, session: s.id, replies, task, claim: claimOf(events), events, stderr: hub.stderr().slice(-2000) };
  } finally {
    await stopHub(hub);
  }
}

// ---- Readings.
/** deep-hook's reply to a call's PreToolUse, as Claude Code reads it. */
export const decided = (r: Replay, call: string): 'deny' | 'allow' | 'other' | 'not sent' => { const ran = r.replies.get(`PreToolUse ${call}`); return ran ? decision(ran) : 'not sent'; };
export const replyOf = (r: Replay, call: string): string => { const ran = r.replies.get(`PreToolUse ${call}`); return ran ? shown(ran) : 'not sent'; };
export const ofSession = (r: Replay): Ev[] => r.events.filter((e) => e.session === r.session);
/** The call's tool.before, which records what deep-hook matched. */
export const before = (r: Replay, call: string): Ev | undefined => ofSession(r).find((e) => e.kind === 'tool.before' && e.data.call === call);
/** Every guard.overridden of the session. */
export const overridden = (r: Replay): Ev[] => r.events.filter((e) => e.kind === 'guard.overridden' && (e.session === r.session || JSON.stringify(e.data).includes(r.session)));
/** Every verdict.made about the session's claim, in log order. */
export const verdicts = (r: Replay): Ev[] => (r.claim ? r.events.filter((e) => e.kind === 'verdict.made' && e.subject === r.claim) : []);
/** Every ask.created whose data names `what`. */
export const asksNaming = (r: Replay, ...what: string[]): Ev[] => r.events.filter((e) => e.kind === 'ask.created' && what.some((w) => JSON.stringify(e.data).includes(w)));
export const said = (e: Ev | undefined): string => (e ? `${e.kind} at log_pos ${e.log_pos} ${JSON.stringify(e.data).slice(0, 600)}` : 'no event');
/** The replay in a few lines, for failure messages. */
export function summary(r: Replay): string {
  const v = verdicts(r).map((e) => ({ outcome: e.data.outcome, reasons: e.data.reasons }));
  return [
    `claim ${r.claim ?? 'none'}; verdicts ${JSON.stringify(v).slice(0, 800)}`,
    `deep-hook on the force push: ${decided(r, PUSH_CALL)}; on the repeated send: ${decided(r, RESEND_CALL)}`,
    `guard.overridden: ${overridden(r).map(said).join('; ') || 'none'}`,
    `asks: ${r.events.filter((e) => e.kind === 'ask.created').map(said).join('; ') || 'none'}`,
    `the session's kinds: ${[...new Set(ofSession(r).map((e) => e.kind))].join(', ')}`,
  ].join('\n');
}

// ---- deep doctor (README, The doctor's readings).
export interface DoctorItem { item: string; agent: string; code: string; level: string; evidence: string; fix: string }
/** `deep doctor --json` with HOME `home`, the stand-in first on PATH and no managed settings: its items, and its run. */
export async function doctor(home: string, tmp: string): Promise<{ items: DoctorItem[]; ran: Ran; calls: string[][] }> {
  const log = join(tmp, `claude-calls-${randomUUID()}.jsonl`);
  const ran = await runCli(['doctor', '--json'], childEnv(home, { PATH: stubPath(), DEEP_HUB_TEST_MANAGED_SETTINGS: join(tmp, 'no-managed-settings.json'), DEEP_1033_CLAUDE_LOG: log }), tmp);
  const items = ran.stdout.split('\n').map((l) => parseObject(l)).filter((x): x is Line => x !== undefined && typeof x.item === 'string') as DoctorItem[];
  const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]) : [];
  return { items, ran, calls };
}
function runCli(args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(NODE, [CLI, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut: false, ended: Date.now() }); });
  });
}
/** The doctor's items about the home's mods: `claude.mods` (README). */
export const modItems = (items: readonly DoctorItem[]): DoctorItem[] => items.filter((i) => /^claude\.mods\b/.test(i.item));
export const listed = (items: readonly DoctorItem[]): string => items.map((i) => `${i.item} ${i.level} (${i.code}): ${i.evidence}`).join(' | ') || 'none';
