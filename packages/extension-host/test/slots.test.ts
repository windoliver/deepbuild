// #349's rules the acceptance tests reach only in passing, each shown failing against the host before its fix:
// gating comes from the hook deep-hook held, never from the kinds an adapter's mapHook returned; before an adapter
// gates a session no answer is delivered; steer is a route into a running turn only; an answer whose delivery
// failed stays waiting; a stuck runner can't hang an install; a sandboxed replacement of a shipped kind is BLOCKED
// at install; and a session whose owner was unloaded has no owner. Each runs a real package through a real host.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AdapterCaps, HookRequestLine } from '@deepbuild/adapters';
import { openAsks, type Asks, type Connection, type Delivery } from '@deepbuild/asks';
import { fixtures } from '@deepbuild/contracts';
import { openRecord, type RecordStore } from '@deepbuild/record';
import { openSupervisor } from '@deepbuild/supervisor';
import { openExtensionHost, openTrust, packageDigest, type ExtensionHost, type ReleaseEntry } from '../src/index.js';

const dirs: string[] = [];
const closing: { close(): Promise<void> }[] = [];
afterAll(async () => {
  for (const c of closing.reverse()) await c.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const temp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'deep-slots-test-')));
  dirs.push(d);
  return d;
};
function pkgOf(id: string, code: string, fields: Record<string, unknown> = {}): string {
  const folder = temp();
  writeFileSync(join(folder, 'index.ts'), code);
  const manifest = { id, version: '1.0.0', digest: '', ...fields };
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  manifest.digest = packageDigest(folder);
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  return folder;
}
const release = (...folders: string[]): ReleaseEntry[] => folders.map((folder) => {
  const m = JSON.parse(readFileSync(join(folder, 'deepbuild.json'), 'utf8')) as { id: string; version: string };
  return { id: m.id, version: m.version, digest: packageDigest(folder) };
});
/** The asks core and record a test host was opened on, for tests that raise an ask through it. */
const worldOf = new WeakMap<ExtensionHost, { asks: Asks; record: RecordStore }>();
async function host(release: ReleaseEntry[], ready = true): Promise<ExtensionHost> {
  const dir = temp();
  const record: RecordStore = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  closing.push(record, supervisor);
  mkdirSync(join(dir, 'home'));
  const trust = await openTrust({ record, now: Date.now });
  const h = await openExtensionHost({ record, asks, supervisor, trust, home: join(dir, 'home'), now: Date.now, release });
  closing.push(h);
  worldOf.set(h, { asks, record });
  if (ready) await h.ready();
  return h;
}
async function loaded(h: ExtensionHost, folder: string): Promise<void> {
  const p = await h.install({ from: folder, builtBy: null });
  expect((await h.check(p)).passed, JSON.stringify(await h.check(p))).toBe(true);
  expect((await h.load(p)).status).toBe('loaded');
}

const CAPS: AdapterCaps = { holdStop: false, wakeIdle: false, steer: false, followUp: false, answerPermission: true, nativeTools: true, mcp: false, rewrite: false, editInput: false, errorTurnHook: false, startTurn: false };
/** Hook names to the kinds a test adapter maps them to; a hook left out is relayed as nothing. */
const REAL: Record<string, string> = { SessionStart: 'session.start', UserPromptSubmit: 'user.ask', PreToolUse: 'tool.before', PostToolUse: 'tool.after', Stop: 'agent.stop', SessionEnd: 'session.end' };
interface TestAdapter { name: string; folder: string; seen(): { route: string; ask: string }[] }
/** An adapter package: `maps` names each hook and the kind it maps to; `deliver` is the body of its deliver, with `seen` the file it appends to. */
function adapter(name: string, caps: Partial<AdapterCaps>, maps: Record<string, string> = REAL, deliver = '', after = ''): TestAdapter {
  const seen = join(temp(), 'seen.jsonl');
  writeFileSync(seen, '');
  const code = `import { appendFileSync, existsSync } from 'node:fs';
let calls = 0;
export default async function (deep: any): Promise<void> {
  const maps: Record<string, string> = ${JSON.stringify(maps)};
  await deep.registerAdapter(${JSON.stringify(name)}, {
    facts: ${JSON.stringify(fixtures('adapter.facts@1')[0])}, caps: ${JSON.stringify({ ...CAPS, ...caps })}, unsupported: ${JSON.stringify(fixtures('adapter.unsupported@1')[0])},
    doctor: () => [],
    mapHook(request: any) { const kind = maps[String(request.payload?.hook_event_name)]; return { events: kind ? [{ agent: ${JSON.stringify(name)}, kind, data: {}, rule: '/test' }] : [], verified: true, readings: [] }; },
    deliver(answer: any, session: string, route: string) { ${deliver} appendFileSync(${JSON.stringify(seen)}, JSON.stringify({ route, ask: answer.ask }) + '\\n'); return { outcome: 'delivered', route }; },
  });
  ${after}
}
`;
  return { name, folder: pkgOf(`test/${name}`, code), seen: () => readFileSync(seen, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { route: string; ask: string }) };
}
let seq = 0;
const line = (agent: string, session: string, event: string): HookRequestLine => ({ v: 1, agent, event, seq: String(++seq), id: `01K7${String(seq).padStart(22, '0')}`, pid: 1, ppid: 1, matched: [], payload: { session_id: session, hook_event_name: event, cwd: '/' } });
const hooks = async (h: ExtensionHost, agent: string, session: string, ...events: string[]): Promise<void> => { for (const e of events) await h.hook(line(agent, session, e)); };
let asked = 0;
const answer = (session: string): Delivery => ({ ask: `ask:A${++asked}`, session, option: 'approve', decision: 'allow', words: null, provisional: false, undoes: null });

describe('#349 gating comes from the hook deep-hook held', () => {
  it('an adapter that maps SessionStart to a gate kind doesn\'t gate the session; the adapter whose PreToolUse line is mapped does', async () => {
    const spoof = adapter('spoof', { steer: true }, { SessionStart: 'tool.before' });
    const gater = adapter('gater', { steer: true });
    const h = await host(release(spoof.folder, gater.folder));
    await loaded(h, spoof.folder);
    await loaded(h, gater.folder);
    const s = 'S1';
    await hooks(h, 'spoof', s, 'SessionStart');
    await hooks(h, 'gater', s, 'SessionStart', 'UserPromptSubmit', 'PreToolUse');
    expect(await h.owner(s)).toEqual({ adapter: 'gater' });
    const out = await h.deliverAnswer(answer(s));
    expect(out).toMatchObject({ status: 'delivered', adapter: 'gater' });
    expect(spoof.seen()).toEqual([]);
  }, 60_000);

  it('a non-owner\'s mapped user.ask opens no route: an answer waiting for the owner\'s next prompt stays until the owner\'s own prompt', async () => {
    const relay = adapter('relay', { steer: true }, { SessionStart: 'session.start', UserPromptSubmit: 'user.ask' });
    const gater = adapter('gater', { steer: false, holdStop: false });
    const h = await host(release(relay.folder, gater.folder));
    await loaded(h, relay.folder);
    await loaded(h, gater.folder);
    const s = 'S2';
    await hooks(h, 'relay', s, 'SessionStart');
    await hooks(h, 'gater', s, 'SessionStart', 'UserPromptSubmit', 'PreToolUse');
    expect((await h.deliverAnswer(answer(s))).status).toBe('held');
    await hooks(h, 'relay', s, 'UserPromptSubmit');
    expect(gater.seen(), 'the relay\'s prompt line opens nothing').toEqual([]);
    await hooks(h, 'gater', s, 'Stop', 'UserPromptSubmit');
    expect(gater.seen().map((x) => x.route)).toEqual(['prompt']);
  }, 60_000);
});

describe('#349 no answer before an adapter gates the session', () => {
  it('a session only bound, by an adapter that relays, has no owner; its answer waits, and goes through the adapter that then gates it', async () => {
    const relay = adapter('relay', { steer: true }, { SessionStart: 'session.start', PostToolUse: 'tool.after' });
    const gater = adapter('gater', { steer: true });
    const h = await host(release(relay.folder, gater.folder));
    await loaded(h, relay.folder);
    await loaded(h, gater.folder);
    const s = 'S3';
    await hooks(h, 'relay', s, 'SessionStart', 'PostToolUse');
    expect(await h.owner(s)).toBeNull();
    const a = answer(s);
    expect((await h.deliverAnswer(a)).status).toBe('held');
    expect(relay.seen(), 'the relaying adapter delivers nothing').toEqual([]);
    await hooks(h, 'gater', s, 'SessionStart', 'UserPromptSubmit', 'PreToolUse');
    expect(gater.seen().map((x) => x.ask)).toEqual([a.ask]);
  }, 60_000);
});

describe('#349 steer is a route into a running turn', () => {
  it('an adapter that can steer but not wake gets an idle session\'s answer at its next prompt, not as a steer into no turn', async () => {
    const a = adapter('steerer', { steer: true, holdStop: false, wakeIdle: false });
    const h = await host(release(a.folder));
    await loaded(h, a.folder);
    const s = 'S4';
    await hooks(h, 'steerer', s, 'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop');
    const out = await h.deliverAnswer(answer(s));
    expect(out.status, JSON.stringify(out)).toBe('held');
    await hooks(h, 'steerer', s, 'UserPromptSubmit');
    expect(a.seen().map((x) => x.route)).toEqual(['prompt']);
  }, 60_000);
});

describe('#349 a delivery that fails leaves the answer waiting', () => {
  it('an adapter whose deliver throws once: the hook that opened the route rejects naming it, the failed answer stays waiting while the other went through, and the next opening delivers it; each once', async () => {
    const a = adapter('flaky', { steer: false, holdStop: true }, REAL, 'if (++calls === 1) throw Error(\'not now\');');
    const h = await host(release(a.folder));
    await loaded(h, a.folder);
    const s = 'S5';
    await hooks(h, 'flaky', s, 'SessionStart', 'UserPromptSubmit', 'PreToolUse');
    const first = answer(s);
    const second = answer(s);
    expect((await h.deliverAnswer(first)).status).toBe('held');
    expect((await h.deliverAnswer(second)).status).toBe('held');
    await expect(h.hook(line('flaky', s, 'Stop'))).rejects.toThrow(/flaky.*not now/);
    expect(a.seen(), 'the answer whose delivery failed is not among the delivered; the other went through once').toEqual([{ route: 'hold', ask: second.ask }]);
    await hooks(h, 'flaky', s, 'UserPromptSubmit', 'PreToolUse', 'Stop');
    expect(a.seen().map((x) => x.ask), 'the failed answer is delivered at the next opening, and nothing twice').toEqual([second.ask, first.ask]);
  }, 60_000);
});

describe('#349 the kit at install', () => {
  const journey = (id: string, body: string, fields: Record<string, unknown> = {}): string =>
    pkgOf(id, `export default function (deep: any): void {\n  deep.registerCheck('journey', () => ${body});\n}\n`, { checks: ['journey'], replaces: ['journey'], ...fields });

  it('a replacement of a shipped kind whose runner never answers is refused at install within the kit\'s deadline, and nothing of it is installed', async () => {
    const folder = journey('test/hangs', 'new Promise(() => undefined)');
    const h = await host(release(folder));
    const t0 = Date.now();
    // The kit's first case gives the runner 60 s; the install refuses it a 5 s grace later, the whole kit at once.
    await expect(h.install({ from: folder, builtBy: null })).rejects.toThrow(/journey.*(took longer than|reads (FAIL|BLOCKED) on check\.kind@1)/);
    expect(Date.now() - t0).toBeLessThan(60_000 + 5_000 + 10_000);
    expect(await h.installed()).toEqual([]);
  }, 120_000);

  it('a replacement of a shipped kind that would run in the sandbox is BLOCKED at install, naming the kind: the kit can\'t run there, so it doesn\'t install', async () => {
    const folder = journey('test/sandboxed', "({ outcome: 'passed', testsRun: 1, failures: [], evidence: [], read: [], mask: null })");
    const h = await host([]);
    await expect(h.install({ from: folder, builtBy: null })).rejects.toThrow(/BLOCKED.*journey/);
    expect(await h.installed()).toEqual([]);
  }, 60_000);
});

describe('#349 a session whose owner is gone', () => {
  it('after the owning adapter\'s package is reinstalled, the session has no owner and its answer waits instead of failing', async () => {
    const a = adapter('owner', { steer: true });
    const h = await host(release(a.folder));
    await loaded(h, a.folder);
    const s = 'S6';
    await hooks(h, 'owner', s, 'SessionStart', 'UserPromptSubmit', 'PreToolUse');
    expect(await h.owner(s)).toEqual({ adapter: 'owner' });
    await h.install({ from: a.folder, builtBy: null });
    expect(await h.owner(s)).toBeNull();
    expect((await h.deliverAnswer(answer(s))).status).toBe('held');
  }, 60_000);
});

describe('#349 a session that ends with answers waiting drops none unheard', () => {
  it('the owner\'s SessionEnd with an answer still waiting rejects naming the answer, and the session is gone', async () => {
    const a = adapter('ender', { steer: false, holdStop: false, wakeIdle: false });
    const h = await host(release(a.folder));
    await loaded(h, a.folder);
    const s = 'S9';
    await hooks(h, 'ender', s, 'SessionStart', 'UserPromptSubmit', 'PreToolUse');
    const first = answer(s);
    expect((await h.deliverAnswer(first)).status).toBe('held');
    await expect(h.hook(line('ender', s, 'SessionEnd'))).rejects.toThrow(new RegExp(`${s}.*${first.ask}`));
    expect(await h.owner(s), 'the ended session is forgotten').toBeNull();
    expect(a.seen()).toEqual([]);
  }, 60_000);
});

describe('#349 a session ends with its owner\'s SessionEnd line, mapped to an event or not', () => {
  it('an owner whose mapHook maps SessionEnd to nothing still ends the session: the host forgets it', async () => {
    const { SessionEnd: _dropped, ...noEnd } = REAL;
    const a = adapter('quiet', { steer: true }, noEnd);
    const h = await host(release(a.folder));
    await loaded(h, a.folder);
    const s = 'S10';
    await hooks(h, 'quiet', s, 'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop');
    expect(await h.owner(s)).toEqual({ adapter: 'quiet' });
    expect((await h.hook(line('quiet', s, 'SessionEnd'))).events).toEqual([]);
    expect(await h.owner(s)).toBeNull();
  }, 60_000);
});

describe('#349 a direct delivery that fails leaves the answer waiting too', () => {
  it('a steering owner whose deliver throws: deliverAnswer answers held, and the next prompt delivers the answer once', async () => {
    const a = adapter('direct', { steer: true }, REAL, 'if (++calls === 1) throw Error(\'not now\');');
    const h = await host(release(a.folder));
    await loaded(h, a.folder);
    const s = 'S7';
    await hooks(h, 'direct', s, 'SessionStart', 'UserPromptSubmit', 'PreToolUse');
    const first = answer(s);
    expect((await h.deliverAnswer(first)).status, 'a failed delivery holds the answer').toBe('held');
    expect(a.seen()).toEqual([]);
    await hooks(h, 'direct', s, 'Stop', 'UserPromptSubmit');
    expect(a.seen().map((x) => x.ask)).toEqual([first.ask]);
  }, 60_000);
});

describe('#349 wake is a route the stop opens', () => {
  it('an owner that wakes an idle session but can\'t steer or hold a stop gets a mid-turn answer at the stop, by wake', async () => {
    const a = adapter('waker', { steer: false, holdStop: false, wakeIdle: true });
    const h = await host(release(a.folder));
    await loaded(h, a.folder);
    const s = 'S8';
    await hooks(h, 'waker', s, 'SessionStart', 'UserPromptSubmit', 'PreToolUse');
    const first = answer(s);
    expect((await h.deliverAnswer(first)).status).toBe('held');
    await hooks(h, 'waker', s, 'Stop');
    expect(a.seen()).toEqual([{ route: 'wake', ask: first.ask }]);
  }, 60_000);
});

describe('#349 a resolver registers only from the hub', () => {
  it('a package the sandbox runs can\'t register a resolver: its conformance fails naming the resolver, and it doesn\'t load', async () => {
    const folder = pkgOf('test/sandbox-resolver', 'export default async function (deep: any): Promise<void> {\n  await deep.registerResolver(async () => undefined);\n}\n');
    const h = await host([]);
    const p = await h.install({ from: folder, builtBy: null });
    const c = await h.check(p);
    expect(c.passed, 'its conformance refuses the resolver').toBe(false);
    expect(c.reasons.join('\n')).toMatch(/resolver/);
    expect((await h.load(p)).status).toBe('refused');
  }, 60_000);

  it('an adapter whose package has not finished starting is no adapter yet: a hook line for it rejects, and nothing it mapped binds a session', async () => {
    const flag = join(temp(), 'hang');
    const a = adapter('hanger', {}, REAL, '', `if (existsSync(${JSON.stringify(flag)})) await new Promise(() => undefined);`);
    const h = await host(release(a.folder));
    const p = await h.install({ from: a.folder, builtBy: null });
    expect((await h.check(p)).passed).toBe(true);
    writeFileSync(flag, '');
    const loading = h.load(p);
    for (let i = 0; i < 500 && !(await h.adapters()).some((x) => x.name === 'hanger'); i++) await new Promise((r) => setTimeout(r, 10));
    expect((await h.adapters()).map((x) => x.name), 'the adapter was registered by a start that has not finished').toContain('hanger');
    await expect(h.hook(line('hanger', 'S-hang', 'SessionStart'))).rejects.toThrow(/no loaded extension registered an adapter hanger/);
    expect((await loading).status, 'the package never finished starting').toBe('refused');
    expect((await h.adapters()).map((x) => x.name)).not.toContain('hanger');
  }, 60_000);

  it('a resolver registered by a package whose start has not finished is consulted on nothing: an ask raised meanwhile reaches you with no refusal from it', async () => {
    const flag = join(temp(), 'hang');
    const folder = pkgOf('test/hanging-resolver', `import { existsSync } from 'node:fs';
export default async function (deep: any): Promise<void> {
  await deep.registerResolver(() => ({ answer: 'blue', because: 'decision:NONE' }));
  if (existsSync(${JSON.stringify(flag)})) await new Promise(() => undefined);
}
`);
    const h = await host(release(folder));
    const { asks, record } = worldOf.get(h)!;
    const p = await h.install({ from: folder, builtBy: null });
    expect((await h.check(p)).passed, JSON.stringify(await h.check(p))).toBe(true);
    writeFileSync(flag, '');
    const loading = h.load(p);
    await new Promise((r) => setTimeout(r, 300));
    const you: Connection = { writer: 'mcp:S-hang', actor: 'you', scope: 'you', session: 'S-hang' };
    await record.append({ writer: 'hook', actor: 'you', scope: 'you', session: 'S-hang' }, { v: 1, id: '01K7HANG00000000000000000A', kind: 'session.start', ts: Date.now(), data: { agent: 'claude-code', worktree: temp(), branch: 'main', thread: 'T' } });
    const handle = await asks.raise(you, 'deep_ask.taste', {
      kind: 'taste', question: 'Which colour?', options: [{ id: 'blue', label: 'Blue', decision: 'none' }, { id: 'green', label: 'Green', decision: 'none' }],
      recommended: 'blue', deadline: Date.now() + 3_600_000, fallback: 'you', default: 'blue', provisional: false, owner: 'you',
      key: 'a'.repeat(64), pinned_to: { kind: 'evidence', ref: 'b'.repeat(64) },
    });
    expect(await asks.refusals(handle), 'nothing was asked of a package that has not started').toEqual([]);
    expect((await asks.needsYou()).map((c) => c.ask)).toContain(handle);
    expect((await loading).status, 'the package never finished starting').toBe('refused');
  }, 60_000);
});
