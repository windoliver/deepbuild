// The replay (criterion 1): a scenario written for the `deep-show` stand-in (#393's and #384's `deep-show run` grammar) played
// against a real hub, real agent stand-ins and the app's replica, and its replies compared, field for field, with the
// stand-in's own, evidence hashes compared by content. README: Criterion 1, how a scenario is played.
//
// What is real: the hub, the record (asks and readings seeded through the record before the hub starts), the evidence store,
// the agents' sessions and process trees (a `deep show` "inside an agent's process tree" runs in one), `deep mcp`, `deep show`,
// and the app. What is a seam: the world file (names, panels, minted documents, claims' deliverables, the window and card,
// the fault) and the process table's PID reuse; both are listed in the README.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  App, Stand, World, deepShow, deepShowCli, evidenceRoot, hubCall, makeHome, putPng, readEvidence, startHub, t26, t384, t393, tempDir, uuidOf,
  type AgentKind, type JsonObject, type JsonValue, type WorldFile,
} from './helpers.ts';

const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A scenario's session, and the agent that runs it: a name starting `Codex` is a Codex session, any other a Claude Code session. */
export interface Agent { scenarioId: string; thread: string; name: string; kind: AgentKind; real: string; stand: Stand }

export interface Opened {
  tmp: string;
  home: string;
  hub: t26.Hub;
  world: World;
  agents: Map<string, Agent>;
  /** A `deep mcp` started by hand: its parent is no agent, so its calls bind to no session. */
  hand: t26.McpProcess;
  app: App | undefined;
  /** Claims the scenario names, by the scenario's handle → the real one the hub minted. */
  claims: Map<string, string>;
  /** Maps what leaves the replay (scenario → real) and what comes back (real → scenario). */
  out(value: JsonValue): JsonValue;
  back(value: JsonValue): JsonValue;
}

export interface OpenOptions {
  /** The scenario in `deep-show run`'s grammar: sessions, panels, docs, record, claims, window, card, fault. */
  scenario: JsonObject;
  plant?: string;
  app: boolean;
  /** PNGs the scenario's documents name as assets, to be in the hub's evidence store (the stand-in's has them already). */
  assets?: Buffer[];
  /** PIDs the hub is to treat as reused: the scenario session whose agent process "ended" and whose PID another process now holds. */
  reused?: string[];
}

const kindOf = (name: string): AgentKind => (/^codex/i.test(name) ? 'codex' : 'claude-code');
const replaceAll = (text: string, pairs: [string, string][]): string => pairs.reduce((t, [from, to]) => t.split(from).join(to), text);

/** The scenario's world, opened for real: the hub with its seams, the agents, the record seeded, the claims filed, the app. */
export async function openWorld(o: OpenOptions): Promise<Opened> {
  const { tmp, home } = makeHome();
  const scenario = o.scenario;
  const sessions = (scenario['sessions'] ?? {}) as JsonObject;
  const names: Record<string, string> = {};
  const ids: { scenarioId: string; thread: string; real: string; name: string; kind: AgentKind }[] = [];
  for (const [id, raw] of Object.entries(sessions)) {
    const s = t393.obj(raw, `session ${id}`);
    const real = uuidOf(id);
    // A fresh session's thread is its own ID (session.start's `thread`).
    ids.push({ scenarioId: id, thread: String(s['thread']), real, name: String(s['name']), kind: kindOf(String(s['name'])) });
    names[real] = String(s['name']);
  }
  const toReal: [string, string][] = ids.map((s) => [s.thread, s.real]);
  const toScenario: [string, string][] = ids.map((s) => [s.real, s.thread]);
  const claims = new Map<string, string>();
  const out = (v: JsonValue): JsonValue => JSON.parse(replaceAll(JSON.stringify(v), [...toReal, ...[...claims].map(([c, r]): [string, string] => [c, r])])) as JsonValue;
  const back = (v: JsonValue): JsonValue => JSON.parse(replaceAll(JSON.stringify(v), [...toScenario, ...[...claims].map(([c, r]): [string, string] => [r, c])])) as JsonValue;

  // Before the hub starts: the assets in its evidence store, and the record's asks and readings, by the handles the scenario uses.
  for (const png of o.assets ?? []) await putPng(evidenceRoot(home), png);
  const record = (scenario['record'] ?? {}) as JsonObject;
  if (Object.keys(record).length > 0) {
    await t26.seed(home, async (s) => {
      for (const [handle, raw] of Object.entries(record)) {
        const rec = t393.obj(raw, `record ${handle}`);
        const session = typeof rec['session'] === 'string' ? uuidOf(rec['session']) : undefined;
        const conn = { writer: 'core' as const, actor: 'you', scope: 'you', ...(session ? { session } : {}), project: t26.PROJECT };
        if (handle.startsWith('ask:')) {
          await s.record.append(conn, { v: 1, id: handle.slice(4), kind: 'ask.created', ts: s.now(), data: t26.askData('taste', `The question of ${handle}?`, s.now(), s.now() + t26.DAY) });
        } else if (handle.startsWith('reading:')) {
          await s.record.append(conn, { v: 1, id: t26.ulid(), kind: 'reading.recorded', ts: s.now(), data: { reading: handle, value: Number(rec['value'] ?? 0), unit: 'count', as_of: Number(rec['as_of'] ?? 0), source: 'tests/acceptance/806', n: 1, outside: false } });
        } else throw Error(`BLOCKED: the replay seeds asks and readings only, not ${handle}`);
      }
    });
  }

  const worktree = t26.makeWorktree(join(tmp, 'work'));
  const worldPath = join(tmp, 'world.json');
  const world = new World(worldPath, {
    names,
    ...(scenario['panels'] ? { panels: scenario['panels'] } : {}),
    ...(scenario['docs'] ? { docs: out(scenario['docs']) as JsonObject } : {}),
    ...(scenario['window'] ? { window: scenario['window'] } : {}),
    ...(scenario['card'] ? { card: scenario['card'] } : {}),
    ...(scenario['fault'] ? { fault: scenario['fault'] } : {}),
  } as WorldFile);
  const reuseFile = join(tmp, 'reused-pids.json');
  writeFileSync(reuseFile, '[]\n');
  const hub = await startHub(home, { plant: o.plant, world: worldPath, reuse: reuseFile });

  const agents = new Map<string, Agent>();
  for (const s of ids) {
    const stand = Stand.start(home, worktree.path, s.kind, s.real, o.plant ? { DEEP_HUB_PLANT: o.plant } : {});
    await stand.establish(hub);
    await t26.initialize(stand);
    agents.set(s.scenarioId, { ...s, stand });
  }
  // The sessions the scenario says reused PIDs for: from now on the hub reads their agent PIDs as another process's.
  if (o.reused?.length) writeFileSync(reuseFile, `${JSON.stringify(o.reused.map((id) => agents.get(id)!.stand.pid))}\n`);

  const hand = t26.McpProcess.start(home, worktree.path, o.plant ? { DEEP_HUB_PLANT: o.plant } : {});
  await t26.initialize(hand);

  // Claims: each filed through the session's own deep_claim; the scenario's handle names the one the hub minted.
  const claimDefs = (scenario['claims'] ?? {}) as JsonObject;
  const deliverables: JsonObject = {};
  for (const [handle, raw] of Object.entries(claimDefs)) {
    const def = t393.obj(raw, `claim ${handle}`);
    const agent = agents.get(String(def['session']))!;
    const made = t26.valueOf(await t26.callTool(agent.stand, 'deep_claim', t26.claimArgs()), `deep_claim of ${handle} by ${agent.name}`);
    const real = String(made.claim ?? `claim:${made.event}`);
    claims.set(handle, real);
    deliverables[real] = { session: agent.real, deliverables: def['deliverables'] ?? [] };
  }
  if (Object.keys(deliverables).length > 0) world.set({ claims: deliverables });

  let app: App | undefined;
  if (o.app) app = await App.start(home, join(tmp, 'app'));
  return { tmp, home, hub, world, agents, hand, app, claims, out, back };
}

/** The agent a `deep show` peer runs under, by walking the scenario's process table as the hub's peer check does; undefined: you. */
export function peerAgent(scenario: JsonObject, peer: JsonObject, opened: Opened): Agent | undefined {
  const table = new Map<number, { ppid: number; start: number }>();
  for (const p of (scenario['processes'] ?? []) as JsonObject[]) table.set(Number(p['pid']), { ppid: Number(p['ppid']), start: Number(p['start']) });
  const sessions = (scenario['sessions'] ?? {}) as JsonObject;
  const procOf = (id: string) => t393.obj(t393.obj(sessions[id], id)['process'], `${id}.process`);
  let pid = table.get(Number(peer['pid']))?.ppid;
  for (const seen = new Set<number>(); pid !== undefined && pid > 1 && !seen.has(pid); pid = table.get(pid)?.ppid) {
    seen.add(pid);
    for (const id of Object.keys(sessions)) {
      const p = procOf(id);
      // A PID an ended agent's process had, now another process's start time: not that agent's tree (the hub is told so, DEEP_HUB_TEST_PID_REUSE).
      if (Number(p['pid']) === pid) return opened.agents.get(id);
    }
  }
  return undefined;
}

const FLICKS = 705_600_000;
/** A time in flicks as the time grammar's seconds text (`"4.2s"`: Time and the flick), exactly; BLOCKED when it has no exact text. */
export function secondsText(flicks: number): string {
  const text = `${flicks / FLICKS}s`;
  if (Math.round(Number.parseFloat(text) * FLICKS) !== flicks) throw Error(`BLOCKED: ${flicks} flicks has no exact seconds text for deep_show's \`t\``);
  return text;
}
/** The flicks a top-level `t` reads as: a number is flicks, text is the grammar's seconds (`"4.2s"`); anything else is left as it is. */
const flicksOf = (v: JsonValue | undefined): JsonValue | undefined => {
  const m = typeof v === 'string' ? /^(\d+(?:\.\d+)?)\s*s$/.exec(v) : null;
  return m ? Math.round(Number.parseFloat(m[1]!) * FLICKS) : v;
};

export interface Played { replies: JsonObject[]; ms: number[] }

/** Plays one scenario's calls in order against the opened world; the replies as the hub and app gave them, translated back to the scenario's names. */
export async function play(scenario: JsonObject, opened: Opened): Promise<Played> {
  const replies: JsonObject[] = [];
  const ms: number[] = [];
  for (const raw of (scenario['calls'] ?? []) as JsonObject[]) {
    const kind = String(raw['call']);
    const call = opened.out(raw) as JsonObject;
    const at = performance.now();
    let reply: JsonObject;
    switch (kind) {
      case 'deep_show': {
        const agent = typeof raw['session'] === 'string' ? opened.agents.get(raw['session']) : undefined;
        if (typeof raw['session'] === 'string' && !agent) throw Error(`the scenario's deep_show names session ${raw['session']}, which it doesn't hold`);
        reply = (await deepShow(agent ? agent.stand : opened.hand, call, 'deep_show')).reply;
        break;
      }
      case 'render_back': {
        const agent = opened.agents.get(String(raw['session']))!;
        // deep_show's `t` is time-grammar text in every replay (one JSON type a field, #26's strict schemas); #384's render_back gives flicks.
        const t = typeof call['t'] === 'number' ? secondsText(call['t']) : call['t'];
        reply = (await deepShow(agent.stand, { doc: call['doc'], t, rev: call['rev'], size: call['size'], include: ['pixels'] }, 'render-back through deep_show')).reply;
        break;
      }
      case 'deep show': {
        const agent = peerAgent(scenario, raw['peer'] as JsonObject, opened);
        reply = (await deepShowCli(opened.home, opened.tmp, agent?.stand, call)).reply;
        break;
      }
      case 'revisions':
        reply = await hubCall(opened.hub, 'canvas.revisions', { doc: call['doc'] });
        break;
      case 'messages':
        reply = await hubCall(opened.hub, 'canvas.messages', { session: uuidOf(String(raw['session'])) });
        break;
      default: {
        // The user's side: what the stand-in plays for the app (`screen`, `input`, `ask`, `scope`, `view`, `presented`).
        if (!opened.app) throw Error(`the scenario's ${kind} call is the app's: the world was opened without it`);
        await opened.app.sync();
        const { at: _at, ...rest } = call;
        void _at;
        // The scenario's session ID names no real session: the app is told the one the hub knows (the thread is already put in by `out`).
        if (typeof raw['session'] === 'string') {
          const agent = opened.agents.get(raw['session']);
          if (!agent) throw Error(`the scenario's ${kind} call names session ${raw['session']}, which it doesn't hold`);
          rest['session'] = agent.real;
        }
        reply = await opened.app.call(rest);
      }
    }
    ms.push(performance.now() - at);
    replies.push(opened.back(reply) as JsonObject);
  }
  return { replies, ms };
}

// ---------------------------------------------------------------------------------------------------
// Comparing replies

/** A side's replies made comparable: evidence by content, revision hashes and layer and task handles by where they first appear. */
export interface Side { replies: JsonObject[]; readEvidence(sha: string): Promise<Buffer>; translate(value: JsonValue): JsonValue }

/**
 * What a scenario's replies need beyond that, because two correct programs can't give the same value there (README: Criterion 1, the #384
 * replays). Nothing is set for #393's scenarios, whose comparison is exactly the plain one.
 */
export interface Compare {
  /**
   * A patch reply's `arrived`, `checked` and `current` are readings of the stand-in's virtual display clock (`clock` and each call's `at`),
   * which the hub is never given. They leave both sides; what they say that a real clock keeps is their order, so a hub that carries any
   * must carry all three with arrived ≤ checked ≤ current, else its reply gets a `clock_order` field the stand-in's lacks.
   */
  clock?: boolean;
  /** A reply's own top-level `t` is a time: a number is flicks, text is the grammar's seconds; either compares as flicks. */
  time?: boolean;
  /** Top-level fields the hub's reply may lack but, when it has them, must equal the stand-in's (after `time`). */
  optional?: string[];
  /** A doc handle's doc ID compares case-folded (a ULID is case-insensitive; #384's `sameHandle`), the item ID exact. */
  foldDocIds?: boolean;
  /** Fields (by path) of the hub's replies to change one at a time, besides the top-level ones every replay tries; each must be reported. */
  mutants?: Mutant[];
}
/** `path` is dot-separated (array indexes are numbers); `call` restricts it to the first reply to a call of that kind. */
export interface Mutant { path: string; call?: string }

const foldDoc = (text: string): string => text.replace(/^doc:([0-9A-Za-z]+)#/, (_m, id: string) => `doc:${id.toLowerCase()}#`);

export async function normalize(side: Side, compare: Compare = {}): Promise<JsonValue[]> {
  const ordinals = new Map<string, string>();
  const ordinal = (kind: string, value: JsonValue | undefined): string => {
    const key = `${kind}:${JSON.stringify(value)}`;
    if (!ordinals.has(key)) ordinals.set(key, `${kind}#${[...ordinals.keys()].filter((k) => k.startsWith(`${kind}:`)).length + 1}`);
    return ordinals.get(key)!;
  };
  const walk = async (value: JsonValue, key: string): Promise<JsonValue> => {
    if (Array.isArray(value)) return Promise.all(value.map((v) => walk(v, key)));
    if (!isObject(value)) return typeof value === 'string' && compare.foldDocIds ? foldDoc(value) : value;
    const result: JsonObject = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'issues_evidence' && typeof v === 'string') {
        // The full issue list, by content.
        result[k] = side.translate(JSON.parse((await side.readEvidence(v)).toString('utf8')) as JsonValue);
      } else if (k === 'snapshots' && Array.isArray(v)) {
        result[k] = await Promise.all(v.map(async (s) => {
          const snap = t393.obj(s, 'a snapshot');
          const png = await side.readEvidence(String(snap['sha256']));
          return { sha256: `pixels:${t384.pixelHash(png)}`, w: snap['w'] ?? null, h: snap['h'] ?? null };
        }));
      } else if (k === 'hash' && typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)) {
        // A revision's hash covers the canonical document, which names the writer's thread: it can't be the same on both sides, so the
        // revisions compare by which of them share a hash (the stand-in's `hash` and the hub's name the same bytes up to the thread).
        result[k] = ordinal('hash', v);
      } else if (k === 'layer' && typeof v === 'string') {
        result[k] = ordinal('layer', v);
      } else if (k === 'handle' && key === 'task' && typeof v === 'string') {
        result[k] = ordinal('task', v);
      } else result[k] = await walk(v, k);
    }
    return result;
  };
  return Promise.all(side.replies.map(async (r) => treat(await walk(r, '') as JsonObject, compare)));
}

/** The top-level treatments of `Compare`: the clock's readings out (their order checked), `t` as flicks. */
function treat(reply: JsonObject, compare: Compare): JsonObject {
  const out: JsonObject = { ...reply };
  if (compare.time && 't' in out) out['t'] = flicksOf(out['t'])!;
  if (compare.clock) {
    const readings = ['arrived', 'checked', 'current'].map((k) => out[k]);
    const some = readings.some((v) => v !== undefined);
    for (const k of ['arrived', 'checked', 'current']) delete out[k];
    const [a, c, u] = readings;
    const ordered = typeof a === 'number' && typeof c === 'number' && typeof u === 'number' && a <= c && c <= u;
    if (some && !ordered) out['clock_order'] = `arrived ${JSON.stringify(a ?? null)}, checked ${JSON.stringify(c ?? null)}, current ${JSON.stringify(u ?? null)}: not three numbers in order`;
  }
  return out;
}

const same = (a: JsonValue | undefined, b: JsonValue | undefined): boolean => JSON.stringify(sortKeys(a ?? null)) === JSON.stringify(sortKeys(b ?? null));
export const sortKeys = (v: JsonValue): JsonValue => (Array.isArray(v) ? v.map(sortKeys) : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k]!)])) : v);

/** The differences between two calls' replies, each naming the call and the field. A render-back's reply only has to hold the stand-in's fields. */
export function differences(calls: readonly JsonObject[], standIn: readonly JsonValue[], hub: readonly JsonValue[], optional: readonly string[] = []): string[] {
  const failures: string[] = [];
  const show = (v: JsonValue | undefined) => JSON.stringify(v ?? null).slice(0, 300);
  standIn.forEach((a, i) => {
    const name = String(calls[i]?.['call']);
    const b = hub[i];
    const label = `call ${i + 1} (${name})`;
    if (!isObject(a) || !isObject(b)) { if (!same(a, b)) failures.push(`${label}: the stand-in answered ${show(a)}, the hub ${show(b)}`); return; }
    const keys = new Set([...Object.keys(a), ...(name === 'render_back' ? [] : Object.keys(b))]);
    for (const k of keys) if (!(optional.includes(k) && !(k in b)) && !same(a[k], b[k])) failures.push(`${label}: field \`${k}\` is ${show(b[k])} on the hub, ${show(a[k])} on the stand-in`);
  });
  if (hub.length !== standIn.length) failures.push(`the hub answered ${hub.length} calls, the stand-in ${standIn.length}`);
  return failures;
}

/** One reply of the hub with one field changed, to show the comparison can fail. */
export function mutate(hub: readonly JsonValue[], index: number, field: string): JsonValue[] {
  const out = clone(hub as JsonValue[]);
  const reply = out[index] as JsonObject;
  const v = reply[field]!;
  reply[field] = typeof v === 'string' ? `${v}~` : typeof v === 'number' ? v + 1 : Array.isArray(v) ? [...v, 'extra'] : isObject(v) ? { ...v, extra: 'extra' } : v === true ? false : true;
  return out;
}

/** The fields worth mutating in a replay: the first call each shows up in. */
export const MUTABLE = ['outcome', 'rev', 'issues_evidence', 'snapshots', 'result', 'changed', 'revisions', 'messages', 'bands', 'state'] as const;

/** Runs the scenario on the stand-in and on the hub with the app, compares them and shows the comparison can fail. Returns the hub's side for more checks. */
export interface Replayed {
  calls: JsonObject[]; standIn: JsonObject[]; hub: Played; failures: string[]; opened: Opened; hubNorm: JsonValue[]; standNorm: JsonValue[]; evidence: string;
  /** How the hub's replies were read and translated, to normalize a changed copy of them again (`clockProblems`). */
  hubSide: Omit<Side, 'replies'>;
}

export async function replay(scenarioFor: (evidence: string) => JsonObject, assets: Buffer[], o: { app: boolean; plant?: string; reused?: string[]; compare?: Compare; standIn: (scenario: JsonObject) => JsonObject[] }): Promise<Replayed> {
  const evidence = tempDir();
  for (const png of assets) await t393.putPng(evidence, png);
  const scenario = scenarioFor(evidence);
  const standIn = o.standIn(scenario);
  const opened = await openWorld({ scenario, app: o.app, assets, ...(o.plant ? { plant: o.plant } : {}), ...(o.reused ? { reused: o.reused } : {}) });
  const hub = await play(scenario, opened);
  const calls = (scenario['calls'] ?? []) as JsonObject[];
  const compare = o.compare ?? {};
  const hubSide = { readEvidence: (sha: string) => readEvidence(opened.home, sha), translate: (v: JsonValue) => opened.back(v) };
  const standNorm = await normalize({ replies: standIn, readEvidence: (sha) => t393.readEvidence(evidence, sha), translate: (v) => v }, compare);
  const hubNorm = await normalize({ replies: hub.replies, ...hubSide }, compare);
  return { calls, standIn, hub, failures: differences(calls, standNorm, hubNorm, compare.optional), opened, hubNorm, standNorm, evidence, hubSide };
}


/**
 * The comparison can fail: one field of the hub's reply changed at a time, for each field this scenario's replies have, must be
 * reported, naming the call and the field. Returns what the comparison missed; empty means every mutant was caught.
 */
export function mutantProblems(calls: readonly JsonObject[], standIn: readonly JsonValue[], hub: readonly JsonValue[], compare: Compare = {}): string[] {
  const problems: string[] = [];
  let tried = 0;
  for (const field of MUTABLE) {
    const i = hub.findIndex((r) => isObject(r) && field in r);
    if (i < 0) continue;
    tried++;
    const found = differences(calls, standIn, mutate(hub, i, field), compare.optional);
    if (!found.some((f) => f.includes(`call ${i + 1} (`) && f.includes(`\`${field}\``))) problems.push(`a hub reply with \`${field}\` of call ${i + 1} changed is not reported (${found.length} differences: ${found.join('; ').slice(0, 300)})`);
  }
  // The fields the scenario is about, nested or on one kind of call: found in the stand-in's replies (a hub that may lack the field gets it, wrong).
  for (const m of compare.mutants ?? []) {
    const i = standIn.findIndex((r, n) => (m.call === undefined || calls[n]?.['call'] === m.call) && valueAt(r, m.path) !== undefined);
    if (i < 0) { problems.push(`no ${m.call ?? ''} reply of the stand-in holds \`${m.path}\`, which this scenario's comparison is to be shown to fail on`); continue; }
    tried++;
    const top = m.path.split('.')[0]!;
    const found = differences(calls, standIn, mutateAt(hub, i, m.path, valueAt(standIn[i]!, m.path)!), compare.optional);
    if (!found.some((f) => f.includes(`call ${i + 1} (`) && f.includes(`\`${top}\``))) problems.push(`a hub reply with \`${m.path}\` of call ${i + 1} changed is not reported (${found.length} differences: ${found.join('; ').slice(0, 300)})`);
  }
  if (tried === 0) problems.push('no reply holds a field the comparison was shown to fail on');
  return problems;
}

const valueAt = (v: JsonValue | undefined, path: string): JsonValue | undefined =>
  path.split('.').reduce<JsonValue | undefined>((at, k) => (Array.isArray(at) ? at[Number(k)] : isObject(at) ? at[k] : undefined), v);

/** One reply of the hub with the value at `path` set to a wrong one, made from `base` (what the stand-in has there), however the hub's reply has it. */
function mutateAt(hub: readonly JsonValue[], index: number, path: string, base: JsonValue): JsonValue[] {
  const out = clone(hub as JsonValue[]);
  const keys = path.split('.');
  let at = out[index] as JsonValue;
  for (const k of keys.slice(0, -1)) {
    const next = Array.isArray(at) ? at[Number(k)] : isObject(at) ? at[k] : undefined;
    if (next === undefined || typeof next !== 'object' || next === null) return out;
    at = next;
  }
  const last = keys.at(-1)!;
  const wrong = typeof base === 'string' ? `${base}~` : typeof base === 'number' ? base + 1 : Array.isArray(base) ? [...base, 'extra'] : isObject(base) ? { ...base, extra: 'extra' } : base === true ? false : true;
  if (Array.isArray(at)) at[Number(last)] = wrong; else (at as JsonObject)[last] = wrong;
  return out;
}

/**
 * `Compare.clock`'s own check: a copy of the hub's raw replies whose first patch reply carries clock readings out of order must read as
 * a difference naming `clock_order`, so a hub that carried the readings backwards would not pass. Returns what the comparison missed.
 */
export async function clockProblems(r: Replayed, compare: Compare): Promise<string[]> {
  const i = r.calls.findIndex((c) => isObject(c['patch']));
  if (i < 0) return ['the scenario has no patch call, which is where the clock readings are'];
  const replies = clone(r.hub.replies as JsonValue[]) as JsonObject[];
  Object.assign(replies[i]!, { arrived: 10, checked: 5, current: 7 });
  const hub = await normalize({ replies, ...r.hubSide }, compare);
  const found = differences(r.calls, r.standNorm, hub, compare.optional);
  return found.some((f) => f.includes(`call ${i + 1} (`) && f.includes('`clock_order`')) ? [] : [`readings out of order on call ${i + 1} are not reported (${found.length} differences: ${found.join('; ').slice(0, 300)})`];
}
