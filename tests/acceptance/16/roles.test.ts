// #16 AC15: one role per credential. The table below is the criterion's test table: for each role (a hook
// connection, `deep mcp` bound to session A, the app, the CLI) and each socket method, allowed or refused,
// and every cell is exercised against a running hub. A refusal is error@1 with code `role`, naming the
// connection's role (README, Roles). Plus the writer rule with its wrong program, and the credentials.
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  Agent, alive, claimArgs, cleanup, Conn, control, establish, fromHere, health, hookRequest, makeHome, newSession, NODE, openAs,
  png, sendHook, shared, sleep, startHub, stopHub, tokenOf, ulid, waitFor, type Hub, type Line, type Session,
} from './helpers.ts';

type Role = 'hook' | 'mcp:A' | 'app' | 'cli';
const ROLES: readonly Role[] = ['hook', 'mcp:A', 'app', 'cli'];
type Cell = 'allowed' | 'refused';
const A_ = 'allowed' as const;
const R_ = 'refused' as const;
/** The criterion's table. `hook` is a hook request line (hook.request@1); the rest are method calls. */
const TABLE = {
  'hook':             { 'hook': A_, 'mcp:A': R_, 'app': R_, 'cli': R_ },
  'hub.health':       { 'hook': R_, 'mcp:A': R_, 'app': A_, 'cli': A_ },
  'events.read':      { 'hook': R_, 'mcp:A': R_, 'app': A_, 'cli': A_ },
  'stream.subscribe': { 'hook': R_, 'mcp:A': R_, 'app': A_, 'cli': A_ },
  'ask.answer':       { 'hook': R_, 'mcp:A': R_, 'app': A_, 'cli': A_ },
  'gates.off':        { 'hook': R_, 'mcp:A': R_, 'app': A_, 'cli': A_ },
  'mcp.call':         { 'hook': R_, 'mcp:A': A_, 'app': R_, 'cli': R_ },
  'evidence.paste':   { 'hook': R_, 'mcp:A': R_, 'app': A_, 'cli': R_ },
  'run.start':        { 'hook': R_, 'mcp:A': R_, 'app': A_, 'cli': A_ },
  'test.load':        { 'hook': R_, 'mcp:A': R_, 'app': A_, 'cli': A_ },
  'hub.stop':         { 'hook': R_, 'mcp:A': R_, 'app': A_, 'cli': A_ },
} as const satisfies Record<string, Record<Role, Cell>>;
type Method = keyof typeof TABLE;

function params(method: Method): Line {
  switch (method) {
    case 'hub.health': return {};
    case 'events.read': return { after: 0, limit: 1 };
    case 'stream.subscribe': return { after: 0 };
    case 'ask.answer': return { ask: `ask:${ulid()}`, option: 'yes' };
    case 'gates.off': return {};
    case 'mcp.call': return { tool: 'deep_claim', arguments: claimArgs() };
    case 'evidence.paste': return { bytes: Buffer.from(png(4, 4, Math.floor(Math.random() * 1e9))).toString('base64'), type: 'png' };
    case 'run.start': return { check: 'check:noop', claim: `claim:${ulid()}`, commit: '0'.repeat(40), argv: [NODE, '-e', '0'] };
    case 'test.load': return { verdicts: 0, checkpoint: false };
    case 'hub.stop': return {};
    case 'hook': return {};
  }
}

interface Setup { hub: Hub; agent: Agent; A: Session; roleName: Record<Role, string> }
async function setUp(): Promise<Setup> {
  const home = makeHome();
  // Test mode (an empty DEEP_HUB_TEST_VFS) so `test.load` is served and its cells can be exercised.
  const hub = await startHub({ home, vfs: {} });
  const A = newSession(home, 'claude-code');
  const agent = Agent.start(home, A.cwd);
  await establish(agent, hub.socket, A);
  const hello = await agent.mcpOpen(hub.socket);
  if (hello.role !== `mcp:${A.id}`) throw Error(`BLOCKED: deep mcp for session A wasn't bound to it: ${JSON.stringify(hello)}`);
  return { hub, agent, A, roleName: { 'hook': 'hook', 'mcp:A': `mcp:${A.id}`, 'app': 'app', 'cli': 'cli' } };
}
/** Exercises one cell: the reply line (a method's reply, or for `hook` the first line after the request). */
async function exercise(t: Setup, role: Role, method: Method): Promise<Line> {
  const request = fromHere(hookRequest(t.A, 'PreToolUse'));
  if (role === 'mcp:A') return method === 'hook' ? t.agent.mcpSend(request) : t.agent.mcp(method, params(method));
  if (role === 'hook') {
    if (method === 'hook') {
      const h = await sendHook(t.hub.socket, request);
      return h.ack ?? (h.error ? { error: h.error } : { end: h.end });
    }
    const conn = await Conn.open(t.hub.socket);
    try { return await conn.call(method, params(method)); } finally { conn.close(); }
  }
  const conn = await control(t.hub, role);
  try {
    if (method !== 'hook') return await conn.call(method, params(method));
    const from = conn.received.length;
    conn.send(request);
    const reply = await conn.seek((l) => 'ack' in l || 'error' in l, from);
    return reply?.json ?? { end: 'none' };
  } finally { conn.close(); }
}
function check(cell: Cell, role: Role, method: Method, roleName: string, reply: Line): void {
  const error = reply.error as Line | undefined;
  if (cell === 'refused') {
    expect(error?.code, `${method} from ${role} must be refused for its role: ${JSON.stringify(reply)}`).toBe('role');
    if (method !== 'hook') expect(error?.path, `the refusal of ${method} points at the method`).toBe('/method');
    expect(JSON.stringify(error), `the refusal of ${method} names the role ${roleName}`).toContain(roleName);
  } else {
    expect(error?.code, `${method} from ${role} must not be refused for its role: ${JSON.stringify(reply)}`).not.toBe('role');
    if (method === 'hook') expect(reply.ack, 'the hook request is acknowledged').toBeDefined();
  }
}

describe('AC15 #16.ffcc7e73 the role table: every role against every socket method', () => {
  let t: Setup;
  // One hub for the table, started by the first cell; if it can't start, each cell fails with that.
  const once = shared(setUp);
  beforeEach(async () => { t = await once(); }, 60_000);
  afterAll(cleanup, 60_000);
  const cells = (Object.keys(TABLE) as Method[]).filter((m) => m !== 'hub.stop').flatMap((method) => ROLES.map((role) => ({ method, role, cell: TABLE[method][role] as Cell })));
  it.each(cells)('AC15 $method from $role is $cell', async ({ method, role, cell }) => {
    check(cell, role, method, t.roleName[role], await exercise(t, role, method));
  }, 30_000);
});

describe('AC15 #16.ffcc7e73 the role table: hub.stop, each role on a hub of its own', () => {
  afterAll(cleanup, 60_000);
  it.each(ROLES.map((role) => ({ role, cell: TABLE['hub.stop'][role] as Cell })))('AC15 hub.stop from $role is $cell', async ({ role, cell }) => {
    const t = await setUp();
    check(cell, role, 'hub.stop', t.roleName[role], await exercise(t, role, 'hub.stop'));
    if (cell === 'allowed') await waitFor(() => !alive(t.hub.pid) || undefined, 10_000, `the hub to stop on ${role}'s hub.stop`);
    else { await sleep(300); expect(alive(t.hub.pid), `the hub still runs after ${role}'s refused hub.stop`).toBe(true); }
    await t.agent.stop();
    await stopHub(t.hub);
  }, 60_000);
});

describe('AC15 #16.ffcc7e73 a hook connection that subscribes, answers an ask or calls deep off is refused, naming its role', () => {
  afterAll(cleanup, 60_000);
  it('AC15 a hook connection is refused stream.subscribe, ask.answer and gates.off, naming hook, and none of them takes effect', async () => {
    const t = await setUp();
    const cli = await control(t.hub);
    const before = await health(cli);
    const sub = await Conn.open(t.hub.socket);
    const r1 = await sub.call('stream.subscribe', { after: 0 });
    check('refused', 'hook', 'stream.subscribe', 'hook', r1);
    await sendHook(t.hub.socket, fromHere(hookRequest(t.A, 'PostToolUse')));
    await sleep(300);
    expect(sub.received.slice(1).filter((r) => r.json && 'event' in r.json), 'no frame reaches the refused subscriber').toEqual([]);
    sub.close();
    for (const method of ['ask.answer', 'gates.off'] as const) {
      const conn = await Conn.open(t.hub.socket);
      check('refused', 'hook', method, 'hook', await conn.call(method, params(method)));
      conn.close();
    }
    expect((await health(cli)).gates, 'the gates are as they were').toEqual(before.gates);
    cli.close();
  }, 60_000);
});

describe('AC15 #16.ffcc7e73 credentials: the control token is new each launch, yours alone, and never on a command line', () => {
  afterAll(cleanup, 60_000);
  it('AC15 control.token has mode 0600, changes at each launch, is not on the hub\'s command line, and an old or wrong one is refused', async () => {
    const home = makeHome();
    const hub = await startHub({ home });
    const file = join(hub.root, 'control.token');
    expect((statSync(file).mode & 0o777).toString(8), 'control.token is 0600').toBe('600');
    const first = tokenOf(hub.root);
    expect(first.length, 'the token is long enough to be random').toBeGreaterThanOrEqual(32);
    const commandLine = execFileSync('ps', ['-o', 'command=', '-p', String(hub.pid)], { encoding: 'utf8' });
    expect(commandLine.includes(first), 'the token is not on the hub\'s command line').toBe(false);
    await stopHub(hub);
    const again = await startHub({ home });
    const second = tokenOf(again.root);
    expect(second, 'a new token at the next launch').not.toBe(first);
    for (const token of [first, `${second}x`, '']) {
      const conn = await Conn.open(again.socket);
      conn.send({ v: 1, hello: 'cli', token });
      const reply = await conn.next();
      expect(reply?.error?.code, `a hello with ${token === first ? 'the last launch\'s' : 'a wrong'} token is refused`).toBe('credential');
      const after = await conn.call('events.read', { after: 0, limit: 1 }).catch(() => ({ closed: true }) as Line);
      expect(after.result, 'the refused connection reads nothing').toBeUndefined();
      conn.close();
    }
    expect((await openAs(again.socket, 'cli', second)).hello).toBeDefined();
  }, 60_000);
});
