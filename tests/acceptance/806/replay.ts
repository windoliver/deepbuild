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
        reply = (await deepShow(agent.stand, { doc: call['doc'], t: call['t'], rev: call['rev'], size: call['size'], include: ['pixels'] }, 'render-back through deep_show')).reply;
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

export async function normalize(side: Side): Promise<JsonValue[]> {
  const ordinals = new Map<string, string>();
  const ordinal = (kind: string, value: JsonValue | undefined): string => {
    const key = `${kind}:${JSON.stringify(value)}`;
    if (!ordinals.has(key)) ordinals.set(key, `${kind}#${[...ordinals.keys()].filter((k) => k.startsWith(`${kind}:`)).length + 1}`);
    return ordinals.get(key)!;
  };
  const walk = async (value: JsonValue, key: string): Promise<JsonValue> => {
    if (Array.isArray(value)) return Promise.all(value.map((v) => walk(v, key)));
    if (!isObject(value)) return value;
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
  return Promise.all(side.replies.map((r) => walk(r, '')));
}

const same = (a: JsonValue | undefined, b: JsonValue | undefined): boolean => JSON.stringify(sortKeys(a ?? null)) === JSON.stringify(sortKeys(b ?? null));
export const sortKeys = (v: JsonValue): JsonValue => (Array.isArray(v) ? v.map(sortKeys) : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k]!)])) : v);

/** The differences between two calls' replies, each naming the call and the field. A render-back's reply only has to hold the stand-in's fields. */
export function differences(calls: readonly JsonObject[], standIn: readonly JsonValue[], hub: readonly JsonValue[]): string[] {
  const failures: string[] = [];
  const show = (v: JsonValue | undefined) => JSON.stringify(v ?? null).slice(0, 300);
  standIn.forEach((a, i) => {
    const name = String(calls[i]?.['call']);
    const b = hub[i];
    const label = `call ${i + 1} (${name})`;
    if (!isObject(a) || !isObject(b)) { if (!same(a, b)) failures.push(`${label}: the stand-in answered ${show(a)}, the hub ${show(b)}`); return; }
    const keys = new Set([...Object.keys(a), ...(name === 'render_back' ? [] : Object.keys(b))]);
    for (const k of keys) if (!same(a[k], b[k])) failures.push(`${label}: field \`${k}\` is ${show(b[k])} on the hub, ${show(a[k])} on the stand-in`);
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
export interface Replayed { calls: JsonObject[]; standIn: JsonObject[]; hub: Played; failures: string[]; opened: Opened; hubNorm: JsonValue[]; standNorm: JsonValue[]; evidence: string }

export async function replay(scenarioFor: (evidence: string) => JsonObject, assets: Buffer[], o: { app: boolean; plant?: string; reused?: string[]; standIn: (scenario: JsonObject) => JsonObject[] }): Promise<Replayed> {
  const evidence = tempDir();
  for (const png of assets) await t393.putPng(evidence, png);
  const scenario = scenarioFor(evidence);
  const standIn = o.standIn(scenario);
  const opened = await openWorld({ scenario, app: o.app, assets, ...(o.plant ? { plant: o.plant } : {}), ...(o.reused ? { reused: o.reused } : {}) });
  const hub = await play(scenario, opened);
  const calls = (scenario['calls'] ?? []) as JsonObject[];
  const standNorm = await normalize({ replies: standIn, readEvidence: (sha) => t393.readEvidence(evidence, sha), translate: (v) => v });
  const hubNorm = await normalize({ replies: hub.replies, readEvidence: (sha) => readEvidence(opened.home, sha), translate: (v) => opened.back(v) });
  return { calls, standIn, hub, failures: differences(calls, standNorm, hubNorm), opened, hubNorm, standNorm, evidence };
}


/**
 * The comparison can fail: one field of the hub's reply changed at a time, for each field this scenario's replies have, must be
 * reported, naming the call and the field. Returns what the comparison missed; empty means every mutant was caught.
 */
export function mutantProblems(calls: readonly JsonObject[], standIn: readonly JsonValue[], hub: readonly JsonValue[]): string[] {
  const problems: string[] = [];
  let tried = 0;
  for (const field of MUTABLE) {
    const i = hub.findIndex((r) => isObject(r) && field in r);
    if (i < 0) continue;
    tried++;
    const found = differences(calls, standIn, mutate(hub, i, field));
    if (!found.some((f) => f.includes(`call ${i + 1} (`) && f.includes(`\`${field}\``))) problems.push(`a hub reply with \`${field}\` of call ${i + 1} changed is not reported (${found.length} differences: ${found.join('; ').slice(0, 300)})`);
  }
  if (tried === 0) problems.push('no reply holds a field the comparison was shown to fail on');
  return problems;
}
