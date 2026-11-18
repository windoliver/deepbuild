// Test-side tools for the #1048 acceptance tests (README: The surface). They reuse #184's replica process (`Replica`,
// `driveBin`, the `env-plants` debug build) and plain tools, and #555's assembler; run a pool of `deep-drive`
// processes as the hub's replica, each started with a plant when a test names one; open a hub (an extension host with
// the playtest plug-in installed and loaded) with the source seams the model bot's criterion names (an HTTP client, a
// recording to replay and a secret store); run the playtest plug-in's kinds through `runCheck`; and play the suite's
// own replays in a replica of its own. Every play, track, value, trap and refusal read here is the implementation's
// own; the expected values come from the issue's text and this suite's fixtures. Nothing stands in for the replica,
// the host or the plug-in. Processes are #184's helpers' children, stopped by PID.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect } from 'vitest';
import { REPO, Replica, driveBin, sha256, show, tempDir, type Obj } from '../184/helpers.ts';
import type { CheckResult } from '../../../packages/conformance/src/index.ts';
import type { HttpClient, Recording, SecretStore } from '../../../packages/extension-host/src/source-types.ts';

export { macOnly, runSeed, show, word, type Obj } from '../184/helpers.ts';
export { assemble } from '../555/helpers.ts';
export type { CheckResult, HttpClient, Recording, SecretStore };

/** Each criterion's tag (scripts/proof-change.mjs: `#1048.` and the first 8 hex of SHA-256 of its text, white space collapsed). */
export const AC = {
  1: '#1048.e36b203c', 2: '#1048.3109851b', 3: '#1048.1ea738c9', 4: '#1048.657a36a7',
  5: '#1048.c2ba93df', 6: '#1048.354e0af2', 7: '#1048.2c7f09e5',
} as const;

/** Every test passes this timeout: a cold build of the replica takes many minutes on a loaded machine. */
export const TIMEOUT = 5_400_000;
/** The deadline a check run gets in `runCheck`. */
export const DEADLINE = 3_600_000;
export const FLICKS = 705_600_000;
/** A step at 60 Hz, in flicks: every piece here steps at 60 Hz. */
export const STEP_60 = FLICKS / 60;
/** The step an entry is stamped at, on the 60 Hz clock. */
export const stepOf = (e: Obj): number => Math.round(Number(e['t']) / STEP_60);
/** A play's values of `path`, one a step, or [] when the play didn't ask for it. */
export const valuesOf = (reply: Obj, path: string): unknown[] => {
  const v = (reply['values'] as Obj | undefined)?.[path];
  return Array.isArray(v) ? v : [];
};

// ---------------------------------------------------------------------------------------------------
// The hub's pieces, by `<doc>@1`.

const ulid = (n: number): string => `01JC1048P${String(n).padStart(17, '0')}`;
export const DOC = {
  crawler: ulid(1), wall: ulid(2), descend: ulid(3), noturn: ulid(4), leak: ulid(5), calm: ulid(6), pit: ulid(7),
  map: ulid(8), armor: ulid(9), armorClean: ulid(10), tag: ulid(11),
} as const;
const PIECES = new Map<string, Obj>();
/** Keeps `piece` as revision 1 of `doc`; its `<doc>@<rev>`. */
export function putPiece(doc: string, piece: Obj): string {
  PIECES.set(`${doc}@1`, piece);
  return `${doc}@1`;
}
export const pieceOf = (at: string): Obj => {
  const p = PIECES.get(at);
  if (!p) throw Error(`no piece ${at}`);
  return p;
};

// ---------------------------------------------------------------------------------------------------
// A pool of replicas, each one `deep-drive` process playing one call at a time; every play is logged with its reply.

/** One play as a replica got it and answered it: the piece's `<doc>@<rev>` (when played through the hub), the call's fields (assets left out) and the reply as the log keeps it. */
export interface Played { piece: string | null; call: Obj; reply: Obj; replica: number }
export interface PoolOptions {
  /** The `DEEP_DRIVE_PLANT` each replica starts with (the `env-plants` build reads it). */
  plant?: string;
  /** The array paths whose values the log keeps (all others are dropped, to keep the log small). */
  keep?: readonly string[];
  /** Whether the log keeps each reply's recorded entries (a 100,000-step soak's are many). Default: true. */
  entries?: boolean;
  /**
   * The test's own planted hub replica: what the hub's play call answers in place of the replica's reply. The
   * replica played the call as given; only what the hub hands back changes.
   */
  report?: (reply: Obj) => Obj;
}
export class Pool {
  readonly log: Played[] = [];
  private readonly free: number[];
  private readonly queue: ((i: number) => void)[] = [];
  private constructor(readonly replicas: Replica[], private readonly o: PoolOptions) { this.free = replicas.map((_, i) => i); }
  /** `n` debug replicas (`deep-drive` with env-plants, #184's build). */
  static async open(n: number, o: PoolOptions = {}): Promise<Pool> {
    const bin = driveBin('debug');
    return new Pool(await Promise.all(Array.from({ length: n }, () => Replica.start(bin, o.plant))), o);
  }
  private take(): Promise<number> {
    const i = this.free.shift();
    return i !== undefined ? Promise.resolve(i) : new Promise((done) => this.queue.push(done));
  }
  private give(i: number): void {
    const next = this.queue.shift();
    if (next) next(i);
    else this.free.push(i);
  }
  private kept(reply: Obj): Obj {
    const keep = new Set(this.o.keep ?? []);
    const values = reply['values'] && typeof reply['values'] === 'object' ? Object.fromEntries(Object.entries(reply['values'] as Obj).filter(([p]) => keep.has(p))) : reply['values'];
    const { step_times: _t, fuel: _f, frames: _fr, ...rest } = reply;
    return { ...rest, values, ...(this.o.entries === false ? { entries: undefined } : {}) };
  }
  /** `{"call": "play", …run}` on a free replica: the replica's whole reply (the log keeps it cut). */
  async play(run: Obj, piece: string | null = null): Promise<Obj> {
    const i = await this.take();
    try {
      const reply = await this.replicas[i]!.call({ call: 'play', ...run });
      const { piece: _body, assets: _assets, ...call } = run;
      this.log.push({ piece, call, reply: this.kept(reply), replica: i });
      return reply;
    } finally {
      this.give(i);
    }
  }
  /** The hub's replica (README: The surface): the host's play call, its piece resolved by `<doc>@<rev>`. */
  readonly hub = async (c: Obj): Promise<Obj> => {
    const { call: _call, piece, ...run } = c;
    const body = PIECES.get(String(piece));
    if (!body) return { ok: false, error: { code: 'refused', message: `no piece ${String(piece)} in this test's hub` } };
    const reply = await this.play({ ...run, piece: body }, String(piece));
    return this.o.report ? this.o.report(reply) : reply;
  };
  /** The recorded entries of the logged play whose reply names `track` (a sha256), or undefined. */
  entriesOf(track: string): Obj[] | undefined {
    const p = this.log.find((x) => x.reply['ok'] === true && x.reply['track'] === track && Array.isArray(x.reply['entries']));
    return p ? (p.reply['entries'] as Obj[]) : undefined;
  }
}
/** Whether a play ran no step: an error, or a play of no step (the owner's ruling on #184: refused before its first step). */
export const ranNoStep = (p: Played): boolean => p.reply['ok'] !== true || Number(p.reply['steps']) === 0;

/** A play of this suite's own, outside the hub, on `pool`: the piece at `<doc>@1`, its reply checked ok. */
export async function ownPlay(pool: Pool, at: string, run: Obj): Promise<Obj> {
  const reply = await pool.play({ ...run, piece: pieceOf(at) });
  expect(reply['ok'], `this suite's own play of ${at} answers ok: ${show(reply, 800)}`).toBe(true);
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// The hub: an extension host with the playtest plug-in (packages/checks/playtest), loaded under a grant of every DOC.

export const PLAYTEST_DIR = join(REPO, 'packages', 'checks', 'playtest');
export const PLAYTEST_ID = 'deepbuild/playtest';
/** The playtest plug-in's entry, for its named exports; a path, so the suite type-checks at the base. */
export const playtestEntry = async (): Promise<Obj> => (await import(join(PLAYTEST_DIR, 'index.ts'))) as Obj;
/** #555's `lockPlay(play)`: the interface as locked, or a refusal naming why. */
export async function lockPlay(play: Obj): Promise<Obj> {
  const entry = await playtestEntry();
  expect(typeof entry['lockPlay'], 'the playtest plug-in exports lockPlay(play) (#555)').toBe('function');
  return (await (async () => entry['lockPlay'](play))()) as Obj;
}

/** The source seams a hub takes (#102): every outside call goes through `http`; with `replay`, none does. */
export interface Seams { http?: HttpClient; replay?: Recording; secrets?: SecretStore }
/** An HTTP client that makes no call: it counts each one it is handed and refuses it. */
export function noLiveCalls(): { http: HttpClient; calls: string[] } {
  const calls: string[] = [];
  const http: HttpClient = async (request) => { calls.push(`${request.method} ${request.url}`); throw Error('this test makes no live call'); };
  return { http, calls };
}
/** A secret store that holds nothing. */
export const emptySecrets = (): SecretStore => ({ get: async () => undefined, set: async () => undefined, delete: async () => undefined });

export interface Hub { host: Obj }
const closers: (() => Promise<void>)[] = [];
afterAll(async () => { for (const close of closers.splice(0)) await close().catch(() => undefined); }, 120_000);
/** A fresh extension host whose replica is `pool`'s, with the playtest plug-in installed under a grant of every DOC and loaded. */
export async function openHub(pool: Pool, seams: Seams = {}): Promise<Hub> {
  const hostEntry = await import('../../../packages/extension-host/src/index.ts');
  const { openRecord } = await import('../../../packages/record/src/index.ts');
  const { openAsks } = await import('../../../packages/asks/src/index.ts');
  const { openSupervisor } = await import('../../../packages/supervisor/src/index.ts');
  const dir = tempDir('hub1048');
  const home = join(dir, 'deepbuild');
  mkdirSync(home, { recursive: true });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  const trust = await hostEntry.openTrust({ record, now: Date.now });
  expect(existsSync(join(PLAYTEST_DIR, 'deepbuild.json')), 'the playtest plug-in is a first-party package at packages/checks/playtest').toBe(true);
  const m = JSON.parse(readFileSync(join(PLAYTEST_DIR, 'deepbuild.json'), 'utf8')) as Obj;
  const release = [{ id: PLAYTEST_ID, version: String(m['version']), digest: hostEntry.packageDigest(PLAYTEST_DIR) }];
  const host = await hostEntry.openExtensionHost({
    record, asks, supervisor: sup, trust, home, release, now: Date.now, replica: pool.hub,
    ...(seams.http ? { http: seams.http } : {}), ...(seams.replay ? { replay: seams.replay } : {}), ...(seams.secrets ? { secrets: seams.secrets } : {}),
  } as unknown as Parameters<typeof hostEntry.openExtensionHost>[0]) as unknown as Obj;
  closers.push(async () => { await host['close']().catch(() => undefined); await sup.close().catch(() => undefined); await record.close().catch(() => undefined); });
  await host['ready']();
  const installed = await host['install']({ from: PLAYTEST_DIR, builtBy: null, grant: { docs: Object.values(DOC) } });
  const conformance = await host['check'](installed);
  expect(conformance.passed, `${PLAYTEST_ID} passes conformance: ${show(conformance)}`).toBe(true);
  const load = await host['load'](installed);
  expect(load.status === 'loaded' && load.place, `${PLAYTEST_ID} loads in the hub: ${show(load)}`).toBe('hub');
  return { host };
}

// ---------------------------------------------------------------------------------------------------
// The plug-in's kinds through runCheck (README: The surface).

const base = { runner: 'deep.canvas.play', inputs: [], depth: 'journey', oracle: 'code', contract: null };
/** A playtest's spec: its input in `play` (#184). */
export const playtestSpec = (input: Obj): Obj => ({ kind: 'playtest', ...base, play: input });
/** A rules.legal spec: its own input in `legal`, and the input of the playtest it names in `play`. */
export const legalSpec = (legal: Obj, playtest: Obj): Obj => ({ kind: 'rules.legal', ...base, legal, play: playtest });
/** A logic.edges spec: its own input in `edges`, and the input of the playtest it names in `play`. */
export const edgesSpec = (edges: Obj, playtest: Obj): Obj => ({ kind: 'logic.edges', ...base, edges, play: playtest });
/** A result with the fields this suite reads beside check.kind@1's (README: The surface). */
export type Result = CheckResult & { runs?: Obj[]; legal?: Obj; edges?: Obj };
export async function runCheck(hub: Hub, spec: Obj): Promise<Result> {
  return (await hub.host['runCheck'](String(spec['kind']), spec, { checkout: tempDir('checkout1048'), deadline: DEADLINE })) as Result;
}
export const shown = (r: Result): string =>
  `${r.outcome}, testsRun ${r.testsRun}; failures: ${r.failures.map((f) => `[${f.test}] ${f.message}`).join(' | ').slice(0, 3000) || '(none)'}`;
/** The failures whose message starts with `code`, of `test` when given. */
export const failuresOf = (r: Result, code: string, test?: string): CheckResult['failures'] =>
  r.failures.filter((f) => f.message.startsWith(code) && (test === undefined || f.test === test));
/** A number a message names after `label ` (`step 57`, `window 18`, `offset 112`), or undefined. */
export function named(message: string, label: string): number | undefined {
  const m = message.match(new RegExp(`(?:^|[^A-Za-z_])${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (-?\\d+(?:\\.\\d+)?)`));
  return m ? Number(m[1]) : undefined;
}
/** A row or entry a message names as `<label> [a0, a, b]`, or undefined. */
export function triple(message: string, label: string): [number, number, number] | undefined {
  const m = message.match(new RegExp(`${label} \\[\\s*(-?\\d+)\\s*,\\s*(-?\\d+)\\s*,\\s*(-?\\d+)\\s*\\]`));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}
/** The sha256 a message names as `track <sha256>`, or undefined. */
export const trackNamed = (message: string): string | undefined => message.match(/track ([0-9a-f]{64})/)?.[1];
/** The result's runs (README: The surface): one per run of every bot, `test` `bot <b> run <i>`. */
export function runsIn(r: Result): Obj[] {
  expect(Array.isArray(r.runs), `the result lists its runs (runs: [{test, seed, track, outcome, counted}]): ${show(r as never, 600)}`).toBe(true);
  return r.runs as Obj[];
}
/** The SHA-256 of an empty recorded track, as the replica hashes one (`[]`). */
export const EMPTY_TRACK = sha256('[]');
