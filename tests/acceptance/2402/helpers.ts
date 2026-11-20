// What #2402's acceptance tests add to the worlds they import (README): the test packages, their install under a
// hub's root before it starts, the hub with this issue's settings, the calls and what each reply and wait says, the
// readings the criteria judge, and the judges. The hub world (a home, a repo, Claude Code sessions driven through the
// real deep-hook binary, the record read back with `events.read`, cleanup by PID) is #29's (`../29/h-d.ts`), and the
// stand-in agent CLIs and the "unheard" reading are #2118's (`../2118/helpers.ts`), imported unchanged. Nothing here
// stands in for DeepBuild: every reply, record and doctor item comes from the real hub, deep-hook and CLI.
//
// No criterion's ID is kept here: each test file binds its own.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { join } from 'node:path';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openExtensionHost, openTrust, packageDigest, type ReleaseEntry } from '../../../packages/extension-host/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { openSupervisor } from '../../../packages/supervisor/src/index.ts';
import {
  childEnv, CLI, control, DEEP_HOOK, decision, Inconclusive, makeWorld, NODE, own, parseObject, REPO, run, Session, shown, sleep,
  type Ev, type Hub, type Line, type Ran, type World,
} from '../29/h-d.ts';
import { standInAgents, unheard } from '../2118/helpers.ts';

export { allEvents, askNamed, BEHAVIOR, cleanup, decision, failureOf, Inconclusive, lockedFor, Session, settle, shown, sleep, stopHub, taskOf, verdict, type Ev, type Hub, type World } from '../29/h-d.ts';

// ---- The issue's numbers, as it writes them.
/** "An extension's tool.before handler has 500 ms to reply" (EXTENSION_HOOK_MS). */
export const DEADLINE_MS = 500;
/** A held PreToolUse is answered at its hold, the deadline plus 500 ms (EXTENSION_HOLD_MS), whatever the extensions said by then. */
export const HOLD_MS = 1000;
/** AC1: "within 20 ms of a host with no such extension (drafted)". */
export const WITHIN_MS = 20;
/** AC5: "gains under 0.1 ms (drafted)". */
export const GAIN_MS = 0.1;

// ---- The surface this suite chose where the issue leaves a name open (README, The surface under test).
/** The planted host AC2 names: it counts a handler's failures and never clears them (chosen). */
export const PLANT = 'failures-never-cleared';
/** A file listing release entries the hub's extension host takes as DeepBuild's signed release (chosen). */
export const RELEASE_ENV = 'DEEP_HUB_TEST_RELEASE';
/** The socket method, cli role, that restarts one extension: `{ id }` (chosen). */
export const RESTART = 'extension.restart';

// ---- The test packages (README, The packages).
export const HANG = 'acme/hang';
export const DENY = 'acme/deny';
export const FLAKY = 'acme/flaky';
export const GATE = 'deepbuild/done-gate';
/** The command word acme/deny denies, and the one acme/flaky hangs on. */
export const DENIED = './deploy.sh';
export const FLAKY_HANG = 'flaky-hang';

/**
 * Each handler that keeps notes appends one task.created per call it is asked about, titled
 * "<id> asked <call> pid <pid>", before it does anything else: the record shows every call it was asked about and the
 * process it ran in. The append is not awaited, so a reply in time never waits on it.
 */
const NOTES = (id: string) => `import { randomBytes } from 'node:crypto';

const ID = ${JSON.stringify(id)};
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const base32 = (value: bigint, length: number): string => {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
};
const ulid = (ms: number): string => base32(BigInt(ms), 10) + base32(BigInt('0x' + randomBytes(10).toString('hex')), 16);
function note(deep: any, call: string): void {
  const ts = Date.now();
  void Promise.resolve()
    .then(() => deep.record.append({ v: 1, id: ulid(ts), kind: 'task.created', ts, data: { task_ref: 'task:' + ulid(ts), thread: ulid(ts), owner: 'you', title: ID + ' asked ' + call + ' pid ' + process.pid } }))
    .catch(() => undefined);
}
const callOf = (request: any): string => String(request?.data?.call ?? '');
const commandOf = (request: any): string => String(request?.data?.command ?? '');
`;
/** A tool.before handler that never replies. */
const HANGS = (id: string) => `${NOTES(id)}
export default function (deep: any): void {
  deep.on('tool.before', (request: any) => {
    note(deep, callOf(request));
    return new Promise(() => undefined);
  });
}
`;
/** A tool.before handler that never replies to a command naming FLAKY_HANG, and replies at once, adding nothing, to any other. */
const FLAKES = `${NOTES(FLAKY)}
export default function (deep: any): void {
  deep.on('tool.before', (request: any) => {
    note(deep, callOf(request));
    return commandOf(request).includes(${JSON.stringify(FLAKY_HANG)}) ? new Promise(() => undefined) : null;
  });
}
`;
/** A tool.before handler that denies, in time, every command naming DENIED, with its declared template. */
const DENIES = `export default function (deep: any): void {
  deep.on('tool.before', (request: any) => String(request?.data?.command ?? '').includes(${JSON.stringify(DENIED)})
    ? { deny: { template: 'why', values: { handle: 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H' } } }
    : null);
}
`;
const WHY = [{ name: 'why', hook: 'tool.before', text: 'held until {handle} passes', fields: { handle: { type: 'handle' } } }];

export interface Package { id: string; folder: string; entry: ReleaseEntry }
/** A TypeScript package from a folder, built by no agent: its index.ts and its manifest, sealed with the host's own packageDigest. */
export function writePackage(dir: string, id: string, code: string, templates?: unknown[]): Package {
  const folder = join(dir, 'packages', id.replace('/', '-'));
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'index.ts'), code);
  const manifest: Line = {
    id, version: '1.0.0', digest: 'd1:0000000000000000000000000000000000000000000000000000000000000000',
    access: { words: ['record'] }, requires: { preview: ['deep.on', 'deep.record.append'] }, ...(templates ? { templates } : {}),
  };
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  manifest.digest = packageDigest(folder);
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  return { id, folder, entry: { id, version: '1.0.0', digest: String(manifest.digest) } };
}
export const hangPackage = (dir: string, id = HANG): Package => writePackage(dir, id, HANGS(id));
export const flakyPackage = (dir: string): Package => writePackage(dir, FLAKY, FLAKES);
export const denyPackage = (dir: string): Package => writePackage(dir, DENY, DENIES, WHY);

/**
 * Installs each package under the hub's root, through the extension host's public entry, with no hub running (as
 * #2118's AC7 installs one), and checks it: a package that fails its conformance is BLOCKED. `release` lists the ones
 * inside DeepBuild's signed release, which the host loads in the hub.
 */
export async function installAll(w: World, packages: readonly Package[], release: readonly Package[] = []): Promise<void> {
  const pre = join(w.tmp, `pre-${Date.now()}`);
  const evidence = await openEvidenceStore({ root: join(pre, 'evidence') });
  const record = await openRecord({ path: join(pre, 'ledger.db'), now: Date.now, evidence });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  const trust = await openTrust({ record, now: Date.now });
  const host = await openExtensionHost({ record, supervisor: sup, trust, home: w.root, release: release.map((p) => p.entry), now: Date.now });
  try {
    await host.ready();
    for (const p of packages) {
      const installed = await host.install({ from: p.folder, builtBy: null, grant: { record: ['tool.before'] } });
      const checked = await host.check(installed);
      if (!checked.passed) throw Error(`BLOCKED: the test package ${p.id} must pass its conformance: ${checked.reasons.join('; ')}`);
    }
  } finally {
    await host.close();
    await sup.close();
    await record.close();
  }
}

/** A world of #29's: a home, a repo with src/auth.ts, and the definitions the kernel is handed for its prompts. */
export const world = (): World => makeWorld();

export interface HubSettings { plant?: string; release?: readonly Package[] }
/**
 * `deep hub run` on the world's home, as #29's startHub starts it (DEEP_HUB_TEST_CONFIRM, DEEP_HUB_TEST_DRAFTS,
 * DEEP_HUB_TEST_WORK), plus DEEP_HUB_PLANT when given and, with `release`, the release file (RELEASE_ENV) listing
 * those packages. The agents' own CLIs are #2118's stand-ins on the hub's PATH. A hub that doesn't start is BLOCKED.
 */
export async function startHub(w: World, o: HubSettings = {}): Promise<Hub> {
  let releaseFile: string | undefined;
  if (o.release) {
    releaseFile = join(w.tmp, 'release.json');
    writeFileSync(releaseFile, `${JSON.stringify(o.release.map((p) => p.entry), null, 2)}\n`);
  }
  const restorePath = standInAgents(w.tmp);
  let env: NodeJS.ProcessEnv;
  try {
    env = childEnv(w.home, {
      DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_TEST_WORK: w.work,
      DEEP_HUB_PLANT: o.plant, [RELEASE_ENV]: releaseFile,
    });
  } finally {
    restorePath();
  }
  const child: ChildProcess = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
    sleep(240_000).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub${o.plant ? ` with DEEP_HUB_PLANT=${o.plant}` : ''} did not start: ${err.slice(-1500)}`);
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, readyAt: Date.now(), clock: undefined, plant: o.plant, stderr: () => err };
}

/** A new Claude Code session of the world, started, with a moment for the hub's work on its start (as #23's sessionStart waits). */
export async function session(w: World): Promise<Session> {
  const s = new Session(w);
  await s.start();
  await sleep(1500);
  return s;
}

// ---- One tool call and what its reply and its wait say.
export interface Call { label: string; session: Session; command: string; id: string; ran: Ran }
/** A Bash call through deep-hook as the session's Claude Code runs it: its PreToolUse, and when allowed its PostToolUse. */
export async function bash(s: Session, label: string, command: string): Promise<Call> {
  const r = await s.call('Bash', { command, description: command });
  return { label, session: s, command, id: r.id, ran: r.before };
}
/** deep-hook's run time for the call: from its start to its exit, all a tool call waits for its PreToolUse. */
export const waitOf = (c: Call): number => c.ran.ms;
/** A reply that denies with acme/deny's words: Claude Code's exit 2, the block labelled with the extension. */
export const deniedBy = (c: Call, id: string): boolean => decision(c.ran) === 'deny' && c.ran.stderr.includes(`[${id}]`);

/** The call's own tool.before, as the hub recorded it from the hook. */
export const toolBefore = (events: readonly Ev[], c: Call): Ev | undefined => events.find((e) => e.kind === 'tool.before' && e.data?.call === c.id);
/**
 * Whether the hub may never have decided the call (README, Load): deep-hook says it spooled it or denied it on the floor
 * that holds while the hub doesn't answer (#2118's `unheard`), or the record marks its tool.before late. A reading that
 * stands on such a call is INCONCLUSIVE, never a pass and never the criterion's failure.
 */
export const late = (events: readonly Ev[], c: Call): boolean => unheard(c.ran.stderr) || toolBefore(events, c)?.data?.late === true;

/** One handler's note: a call it was asked about, and the process it ran in. */
export interface Note { call: string; pid: number; log_pos: number }
/** The notes a handler appended (README, The packages): one per call it was asked about. */
export function notesOf(events: readonly Ev[], id: string): Note[] {
  const prefix = `${id} asked `;
  return events.flatMap((e) => {
    const title = e.kind === 'task.created' && typeof e.data?.title === 'string' ? e.data.title as string : '';
    const m = title.startsWith(prefix) ? /^(\S*) pid (\d+)$/.exec(title.slice(prefix.length)) : null;
    return m ? [{ call: m[1]!, pid: Number(m[2]), log_pos: e.log_pos }] : [];
  });
}
export const asked = (events: readonly Ev[], id: string, c: Call): boolean => notesOf(events, id).some((n) => n.call === c.id);
const isNote = (e: Ev): boolean => e.kind === 'task.created' && typeof e.data?.title === 'string' && / asked \S* pid \d+$/.test(e.data.title as string);

/**
 * What the record says of an extension's tool.before handler (README, Readings): every event after `after` other than
 * the hook's own (writer `hook`) and the handlers' notes whose kind, subject or data names the extension and the hook
 * kind `tool.before`. The issue leaves the kinds to the implementer, so none is named here.
 */
export function recordOf(events: readonly Ev[], id: string, after: number): Ev[] {
  return events.filter((e) => e.log_pos > after && e.writer !== 'hook' && !isNote(e) && (() => {
    const text = JSON.stringify({ kind: e.kind, subject: e.subject ?? null, data: e.data ?? null });
    return text.includes(id) && text.includes('tool.before');
  })());
}
/** Whether an event names the call: its tool_use_id, or the ULID of the call's own tool.before. */
export function namesCall(e: Ev, events: readonly Ev[], c: Call): boolean {
  const text = JSON.stringify({ kind: e.kind, subject: e.subject ?? null, data: e.data ?? null });
  const own = toolBefore(events, c)?.id;
  return text.includes(c.id) || (own !== undefined && text.includes(own));
}
export const said = (e: Ev): string => `${e.kind} by ${e.writer ?? '?'} at log_pos ${e.log_pos} ${JSON.stringify(e.data).slice(0, 400)}`;

/** The session.reading events on a session, as the record holds them. */
export const readingsOn = (events: readonly Ev[], s: Session): Ev[] => events.filter((e) => e.kind === 'session.reading' && e.session === s.id);

// ---- deep doctor.
export interface Item { item: string; agent: string; code: string; level: string; evidence: string; fix: string }
/**
 * `deep doctor --json` in the hub's home, from a folder outside any repo, with no agent on PATH (as #909's suite runs
 * it): its doctor.item@1 objects, one per line. A doctor that couldn't reach the hub is BLOCKED.
 */
export async function doctor(w: World): Promise<Item[]> {
  const cwd = join(w.tmp, 'outside');
  mkdirSync(cwd, { recursive: true });
  const r = await run(NODE, [CLI, 'doctor', '--json'], { env: childEnv(w.home, { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }), cwd, timeoutMs: 120_000 });
  const items = r.stdout.split('\n').flatMap((raw) => { const o = parseObject(raw); return o ? [o as Item] : []; });
  const socket = items.find((i) => i.item === 'hub.socket');
  if (socket?.level !== 'ok') throw Error(`BLOCKED: deep doctor must reach the hub (${shown(r)}): ${JSON.stringify(socket ?? null)}`);
  return items;
}
/** The doctor's items that report a problem with the extension: any item at a level other than ok whose text names it. */
export const itemsNaming = (items: readonly Item[], id: string): Item[] => items.filter((i) => i.level !== 'ok' && JSON.stringify(i).includes(id));

/** The socket method this suite chose for restarting one extension, as the CLI calls the hub: its result, or the refusal's words. */
export async function restart(hub: Hub, id: string): Promise<{ ok: true; result: Line } | { ok: false; error: string }> {
  try {
    return { ok: true, result: await control(hub, RESTART, { id }, 120_000) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ---- Load and the machine.
export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;

// ---- AC1's waits: each later call against the control's call of the same number (README, AC1's comparison).
/** One call of the story and the control's call of the same number; `late` when either may never have been decided by its hub. */
export interface Pair { n: number; call: Call; control: Call; asked: boolean; late: boolean }
export interface WaitVerdict { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; problems: string[]; table: string }
/**
 * The first three calls each wait at least the deadline; each later call is within WITHIN_MS of the control's call of
 * the same number. A later call fails when its handler was asked about it (its note) and it waited at least half the
 * deadline more than the control's, so load can't make that failure; when every later call is over WITHIN_MS by more
 * than the margin (the larger of 5% and the readings' spread, the design's timing rule); and otherwise one over it is
 * INCONCLUSIVE, as is a call the hub may never have decided. Every failure names the tenth call's wait first.
 */
export function judgeWaits(pairs: readonly Pair[]): WaitVerdict {
  const table = pairs.map((p) => `call ${p.n}: ${waitOf(p.call).toFixed(0)} ms (control ${waitOf(p.control).toFixed(0)} ms, ${(waitOf(p.call) - waitOf(p.control)).toFixed(0)} ms more)${p.asked ? `, ${HANG} asked` : ''}${p.late ? ', unheard or late' : ''}`).join('; ');
  const tenth = pairs.find((p) => p.n === 10);
  const first = pairs.find((p) => p.n === 1);
  const lead = tenth && first ? `the tenth call waited ${waitOf(tenth.call).toFixed(0)} ms against the control's ${waitOf(tenth.control).toFixed(0)} ms, and the first ${waitOf(first.call).toFixed(0)} ms` : 'there was no tenth call';
  const fails: string[] = [];
  const unclear: string[] = [];
  for (const p of pairs.filter((x) => x.n <= 3)) {
    if (p.late) unclear.push(`call ${p.n} may never have been decided by the hub`);
    else if (waitOf(p.call) < DEADLINE_MS) fails.push(`call ${p.n} was answered after ${waitOf(p.call).toFixed(0)} ms, before ${HANG}'s ${DEADLINE_MS} ms deadline: it didn't wait for its handler`);
  }
  const later = pairs.filter((x) => x.n >= 4);
  const over: number[] = [];
  for (const p of later) {
    const more = waitOf(p.call) - waitOf(p.control);
    over.push(more);
    if (p.late) { unclear.push(`call ${p.n} or its control may never have been decided by its hub`); continue; }
    if (more <= WITHIN_MS) continue;
    if (p.asked && more >= DEADLINE_MS / 2) fails.push(`call ${p.n} waited ${waitOf(p.call).toFixed(0)} ms, ${more.toFixed(0)} ms more than the control's, and ${HANG}'s handler was asked about it`);
    else unclear.push(`call ${p.n} took ${more.toFixed(0)} ms more than the control's though ${HANG}'s handler wasn't asked about it`);
  }
  const margin = Math.max(0.05, (Math.max(...over) - Math.min(...over)) / WITHIN_MS);
  if (later.length === 7 && over.every((m) => m > WITHIN_MS * (1 + margin))) fails.push(`every call from the fourth on took more than ${WITHIN_MS} ms over the control's, by more than the ${(margin * 100).toFixed(0)}% margin`);
  if (later.length !== 7) fails.push(`there must be seven calls from the fourth to the tenth, not ${later.length}`);
  if (fails.length) return { status: 'FAIL', problems: [lead, ...fails], table };
  if (unclear.length) return { status: 'INCONCLUSIVE', problems: [lead, ...unclear], table };
  return { status: 'PASS', problems: [], table };
}

/**
 * AC2's reading: a handler failed twice, replied in time, then failed twice more, and nothing was set aside: it was
 * asked about every one of those calls and about the call after them (README, AC2). Returns the problems: the first
 * call it wasn't asked about, named. A reply in time the record shows as failed spoils the scene: INCONCLUSIVE.
 */
export function judgeNothingSetAside(events: readonly Ev[], calls: readonly Call[], after: number): string[] {
  const inTime = calls.filter((c) => !c.command.includes(FLAKY_HANG));
  const failedInTime = inTime.filter((c) => recordOf(events, FLAKY, after).some((e) => namesCall(e, events, c)));
  if (failedInTime.length) throw new Inconclusive(`${FLAKY}'s reply in time to ${failedInTime.map((c) => c.label).join(', ')} is on the record as a failure, so the scene (two failures, a reply in time, two failures) didn't happen; read at ${loadReading()}`);
  const unheardCalls = calls.filter((c) => late(events, c));
  if (unheardCalls.length) throw new Inconclusive(`${unheardCalls.map((c) => c.label).join(', ')} may never have reached the hub; read at ${loadReading()}`);
  const missed = calls.find((c) => !asked(events, FLAKY, c));
  if (!missed) return [];
  const before = calls.slice(0, calls.indexOf(missed)).map((c) => `${c.command.includes(FLAKY_HANG) ? 'failed' : 'replied in time to'} ${c.label}`);
  return [`${FLAKY} was not asked about ${missed.label} (\`${missed.command}\`, ${missed.id}), answered after ${waitOf(missed).toFixed(0)} ms: its handler was set aside after it ${before.join(', ')}; a reply in time clears the count, so nothing may be set aside there`];
}

/** The scene of AC2, on one session: two failures, a reply in time, two failures, then a call it answers in time. */
export const FLAKY_SCENE: readonly { label: string; command: string }[] = [
  { label: 'c1', command: `./build.sh ${FLAKY_HANG}-1` },
  { label: 'c2', command: `./build.sh ${FLAKY_HANG}-2` },
  { label: 'c3', command: './build.sh in-time-3' },
  { label: 'c4', command: `./build.sh ${FLAKY_HANG}-4` },
  { label: 'c5', command: `./build.sh ${FLAKY_HANG}-5` },
  { label: 'c6', command: './build.sh in-time-6' },
];
export async function flakyScene(s: Session): Promise<Call[]> {
  const calls: Call[] = [];
  for (const step of FLAKY_SCENE) calls.push(await bash(s, step.label, step.command));
  return calls;
}

/** The text the agent reads from a Stop's reply: the reason of a block, the line the chat shows, and stderr. */
export function stopWords(r: Ran): string {
  const out = parseObject(r.stdout.trim()) ?? {};
  return [out.reason, out.systemMessage, r.stderr].filter((t) => typeof t === 'string' && t).join('\n');
}

/** What a hub run needs and isn't built, or null: the deep CLI and deep-hook. */
export function built(): string | null {
  for (const [what, path] of [['the deep CLI (npm run build --workspaces)', CLI], ['deep-hook (cargo build --locked -p deep-hook)', DEEP_HOOK]] as const) {
    if (!existsSync(path)) return `${what} is not built at ${path}`;
  }
  return null;
}
