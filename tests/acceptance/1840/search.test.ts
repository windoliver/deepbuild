// AC1 #1840.5abd3b51: "On a hub with two people, `deep_search` from the second person's session returns a decision
// saved at the project's scope and none the owner saved at their personal scope. A planted search with no scope filter
// on decisions fails, naming the decision"
//
// #1337's fixture project with two people: maya owns the hub, bob joins acme/shop. maya has three decisions whose
// questions share one word: one she saved for all her repos (scope `all`, her personal scope, design: One hub for a
// project, What's shared), one from a session in maya/notes, her own repo outside the project (`repo:<notes>`, also
// personal), and one from a session in her clone of acme/shop (`repo:<acme/shop>`, the project's). bob's session, a
// Codex session in his clone of acme/shop whose hooks present his credential, searches that word through its own
// `deep mcp`. It must find the project's decision and neither of hers (README: How the criterion is read).
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { askSources } from '../../../packages/asks/src/index.ts';
import { CLI, childEnv, hookRequest, newSession, own, setAddress, type Session } from '../16/helpers.ts';
import { cleanup, failureOf, joinBob, NODE, owner, readWith, sleep, tempDir, world, type Ev, type Line, type World } from '../1337/helpers.ts';
import { askData, callTool, initialize, nextId, seed, word, type Exchange, type Mcp, type Outcome } from '../26/helpers.ts';

afterAll(cleanup, 60_000);

const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
const YOU = { actor: 'you', scope: 'you' };

// ---- An agent session's process: hooks from its children, and its own deep mcp (fixtures/agent.mjs).
class Agent implements Mcp {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private constructor(private readonly child: ChildProcess) {
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i)) as Line;
        buffer = buffer.slice(i + 1);
        this.pending.get(line.n as number)?.(line);
      }
    });
  }
  /** An agent process run as the person whose home it is, in `cwd`. */
  static start(home: string, cwd: string): Agent {
    const child = spawn(NODE, [AGENT], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Agent(child);
  }
  private send(command: Line, timeoutMs = 150_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(n); reject(Error(`the agent stand-in gave no answer to ${command.op} in ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(n, (line) => {
        clearTimeout(timer);
        this.pending.delete(n);
        if (line.failed) reject(Error(`the agent stand-in failed ${command.op}: ${line.failed}`));
        else resolve(line);
      });
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  /** One hook from a child of this process; with `token`, its connection first says hello with that person's credential. */
  async hook(socket: string, request: Line, cwd: string, token?: string): Promise<Line[]> {
    const r = await this.send({ op: 'hook', address: socket, request, cwd, ...(token ? { token } : {}) });
    return (r.lines as string[]).slice(1).map((raw) => { try { return JSON.parse(raw) as Line; } catch { return { unparsed: raw }; } });
  }
  async request(method: string, params: Line = {}, timeoutMs = 120_000): Promise<Exchange> {
    const r = await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line: { jsonrpc: '2.0', id: nextId(method), method, params }, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return { reply: r.reply as Line, ms: r.ms as number, pid: r.pid as number };
  }
  async notify(method: string, params: Line = {}): Promise<void> {
    await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line: { jsonrpc: '2.0', method, params } });
  }
}

/**
 * A session of the person whose home it is, in `cwd`, its hooks presenting `token` when given (a person's). maya's are
 * Claude Code's, whose transcripts are in the hub's home, so the hub binds their deep mcp by its process. bob's is a
 * Codex session whose hooks carry no transcript path, as Codex's facts allow: his transcript stays on his machine, the
 * hub checks the session by its folder and process alone, and each deep_* call binds by the PreToolUse Codex fires for
 * it (#39, as #806's suite stamps it). README: Values the issue leaves open.
 */
interface Working { who: string; agent: Agent; session: Session; token: string | undefined; events: string[] }
async function hook(w: World, s: Working, event: string, extra: Line = {}): Promise<string> {
  const request = hookRequest(s.session, event, { ...(s.session.agent === 'codex' ? { transcript_path: null } : {}), ...extra });
  const lines = await s.agent.hook(w.hub.socket, request, s.session.cwd, s.token);
  if (!lines.some((l) => 'ack' in l)) throw Error(`BLOCKED: the hub didn't acknowledge ${event} of ${s.who}'s session ${s.session.id} in ${s.session.cwd}: ${JSON.stringify(lines)}`);
  return request.id;
}
async function sessionIn(w: World, who: string, home: string, cwd: string, o: { kind: Session['agent']; token?: string }): Promise<Working> {
  const s: Working = { who, agent: Agent.start(home, cwd), session: newSession(home, o.kind, cwd), token: o.token, events: [] };
  for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse']) s.events.push(await hook(w, s, event));
  await initialize(s.agent);
  return s;
}
/** One deep_* call from the session's deep mcp; a Codex session's PreToolUse for it first. */
async function call(w: World, s: Working, tool: string, args: Line): Promise<Outcome> {
  if (s.session.agent === 'codex') await hook(w, s, 'PreToolUse', { tool_name: `mcp__deep__${tool}`, tool_input: args });
  return callTool(s.agent, tool, args);
}

/** A decision as the scene made it: its source as deep_search cites one, its question, the scope its data names, and a word only its question holds. */
interface Decision { source: string; question: string; scope: string; marker: string; what: string }
const ANSWER = 'files';
/** A choice raised through the session's deep_ask (recommended, so it goes on at once), answered by maya on her trusted path. */
async function decide(w: World, s: Working, question: string): Promise<string> {
  const asked = await call(w, s, 'deep_ask', { kind: 'choice', question, options: [{ id: 'sqlite', label: 'SQLite' }, { id: ANSWER, label: 'Plain files' }], recommended: ANSWER });
  const handle = asked.value?.ask;
  if (asked.isError || typeof handle !== 'string') throw Error(`BLOCKED: deep_ask "${question}" from session ${s.session.id} raised no ask: ${JSON.stringify(asked.reply).slice(0, 1500)}`);
  const conn = await owner(w);
  try {
    const reply = await conn.call('ask.answer', { ask: handle, option: ANSWER }, 30_000);
    if ('error' in reply) throw Error(`BLOCKED: maya's answer to ${handle} on her control connection was refused: ${JSON.stringify(reply.error)}`);
  } finally {
    conn.close();
  }
  return handle;
}

interface Seen { term: string; project: Decision; personal: Decision[]; session: string; pages: Outcome[] }
async function scenario(plant?: string): Promise<Seen> {
  const term = word(10);
  const marker = { all: word(), notes: word(), project: word() };
  const asked = {
    all: `Store every ${term} log${marker.all} on SQLite or plain files?`,
    notes: `Store the ${term} index${marker.notes} on SQLite or plain files?`,
    project: `Store the ${term} cache${marker.project} on SQLite or plain files?`,
  };
  // maya's decision for all her repos, saved before the hub starts through the asks core as the hub's would save it:
  // an ask the core raised in no session, her answer, then saved at `all` on her trusted path (README: Values the issue leaves open).
  const seeded = tempDir();
  let allDecision = '';
  await seed(seeded, async (s) => {
    const source = askSources().find((row) => row.kind === 'choice' && !/^(asks|request)\./.test(row.source))!.source;
    const handle = await s.asks.raise({ writer: 'core', ...YOU }, source, askData('choice', asked.all, s.now()));
    await s.asks.answer({ writer: 'cli', ...YOU }, handle, { option: ANSWER });
    allDecision = await s.asks.saveDecision({ writer: 'cli', ...YOU }, handle, 'all');
  });
  const w = await world({ ledger: join(seeded, '.deepbuild', 'ledger.db'), ...(plant === undefined ? {} : { plant }) });
  // maya's settings declare how long a choice waits and what it defaults to, as a deep_ask needs (#1330's suite writes the same).
  writeFileSync(join(w.hub.root, 'config.json'), `${JSON.stringify({ asks: { deadline: { choice: '2d' }, default: { choice: 'recommended' } } })}\n`);
  const bob = await joinBob(w);
  // bob's machine reaches the project's hub at its address (#16's setting); his deep mcp reads it from his home.
  setAddress(w.bob, `unix:${w.hub.socket}`);

  const project = await sessionIn(w, 'maya', w.maya, w.repos.shop, { kind: 'claude-code' });
  const projectAsk = await decide(w, project, asked.project);
  const notes = await sessionIn(w, 'maya', w.maya, w.repos.notes, { kind: 'claude-code' });
  const notesAsk = await decide(w, notes, asked.notes);
  const b = await sessionIn(w, 'bob', w.bob, w.repos.bobShop, { kind: 'codex', token: bob.token });

  // What the record holds, as its owner reads it: the scene happened as the README says, or the run is BLOCKED.
  const conn = await owner(w);
  try {
    const savedFrom = (all: Ev[], ask: string) => all.find((e) => e.kind === 'decision.created' && e.data?.ask === ask);
    const deadline = Date.now() + 15_000;
    let read = await readWith(conn);
    while ((!savedFrom(read.events, projectAsk) || !savedFrom(read.events, notesAsk)) && Date.now() < deadline) {
      await sleep(200);
      read = await readWith(conn);
    }
    const decision = (e: Ev | undefined, named: string, question: string, m: string, what: string): Decision => {
      if (e?.kind !== 'decision.created') throw Error(`BLOCKED: no decision.created in the record for ${named} ("${question}")`);
      return { source: `decision:${e.id}`, question, scope: String(e.data?.scope), marker: m, what };
    };
    const found = {
      project: decision(savedFrom(read.events, projectAsk), projectAsk, asked.project, marker.project, `saved from maya's session in acme/shop, at the project's scope`),
      notes: decision(savedFrom(read.events, notesAsk), notesAsk, asked.notes, marker.notes, `saved from maya's session in maya/notes, her own repo outside the project: her personal scope`),
      all: decision(read.events.find((e) => `decision:${e.id}` === allDecision), allDecision, asked.all, marker.all, 'saved by maya for all her repos: her personal scope'),
    };
    const projectOf = (id: string) => read.sessions.find((r) => String(r.id) === id)?.project_id as string | undefined;
    const shop = projectOf(project.session.id);
    const mine = projectOf(notes.session.id);
    const want: [Decision, string | undefined][] = [[found.project, shop && `repo:${shop}`], [found.notes, mine && `repo:${mine}`], [found.all, 'all']];
    for (const [d, scope] of want) if (!scope || d.scope !== scope) throw Error(`BLOCKED: ${d.source} ("${d.question}") is saved at ${d.scope}, not ${scope ?? 'a scope its session names'}`);
    if (shop === mine) throw Error(`BLOCKED: maya's sessions in acme/shop and maya/notes read as one project, ${shop}`);
    if (projectOf(b.session.id) !== shop) throw Error(`BLOCKED: bob's session ${b.session.id} reads as project ${projectOf(b.session.id)}, not acme/shop's ${shop}`);
    const bobs = read.events.filter((e) => b.events.includes(e.id));
    if (bobs.length !== b.events.length || bobs.some((e) => e.actor !== bob.person)) throw Error(`BLOCKED: bob's session ${b.session.id} isn't his in the record: ${JSON.stringify(bobs.map((e) => ({ id: e.id, actor: e.actor })))}`);

    // bob's deep mcp acts for his session: the search is from the second person's session.
    const status = await call(w, b, 'deep_status', {});
    if (status.isError || status.value?.session !== b.session.id) throw Error(`BLOCKED: bob's deep mcp acts for no session of his (deep_status: ${JSON.stringify(status.reply).slice(0, 1500)})`);
    // Every page of his search, following `next`.
    const pages: Outcome[] = [];
    for (let cursor: string | undefined; pages.length < 20;) {
      const page = await call(w, b, 'deep_search', { query: term, ...(cursor === undefined ? {} : { cursor }) });
      pages.push(page);
      cursor = page.isError ? undefined : page.value?.next;
      if (typeof cursor !== 'string') break;
    }
    return { term, project: found.project, personal: [found.all, found.notes], session: b.session.id, pages };
  } finally {
    conn.close();
  }
}

/** The criterion's assertions: bob's search holds no decision at maya's personal scope, and holds the project's; a failure names the decision. */
function judge(seen: Seen): void {
  const by = `bob's deep_search "${seen.term}" from his session ${seen.session}`;
  for (const page of seen.pages) {
    expect(page.isError === false && Array.isArray(page.value?.hits), `${by} answers with hits: ${JSON.stringify(page.reply).slice(0, 1500)}`).toBe(true);
  }
  const hits = seen.pages.flatMap((p) => p.value.hits as Line[]);
  const leaked = seen.personal.flatMap((d) => hits.filter((h) => h.source === d.source || JSON.stringify(h).includes(d.marker)).map((h) => `${d.source} ("${d.question}", ${d.what}, scope ${d.scope}) as ${JSON.stringify(h)}`));
  expect(leaked, `${by} returned a decision maya saved at her personal scope:\n${leaked.join('\n')}`).toEqual([]);
  expect(hits.map((h) => h.source), `${by} lacks ${seen.project.source} ("${seen.project.question}", ${seen.project.what}, scope ${seen.project.scope}): ${JSON.stringify(hits).slice(0, 1500)}`).toContain(seen.project.source);
}

describe('AC1 #1840.5abd3b51 deep_search from a person\'s session filters decisions by scope', () => {
  it('AC1 #1840.5abd3b51 bob\'s deep_search returns the decision saved at acme/shop\'s scope and neither of maya\'s personal ones', async () => {
    judge(await scenario());
  }, 300_000);

  it('AC1 #1840.5abd3b51 (wrong program) a search with no scope filter on decisions fails, naming the decision', async () => {
    const seen = await scenario('search-decisions-unfiltered');
    const failure = failureOf(() => judge(seen));
    expect(failure, `the planted search passed: bob's search cited ${JSON.stringify(seen.pages.flatMap((p) => (p.value?.hits ?? []).map((h: Line) => h.source)))}`).toBeDefined();
    const named = seen.personal.flatMap((d) => [d.source, d.question]);
    expect(named.some((n) => failure!.message.includes(n)), `the failure names none of maya's personal decisions (${named.join(', ')}): ${failure!.message}`).toBe(true);
  }, 300_000);
});
