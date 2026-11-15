// deep-hook's waiter holds no control token (#1851): the hub binds it to its session by the agent process it runs
// under, checked by that process's start time, and on that connection it waits only on its own session's answers.
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { client, hookLine, mcp, reply, session, withHub } from './hub.js';

const HOOK = fileURLToPath(new URL('../../../target/debug/deep-hook', import.meta.url));
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** The first ask in the record, polled for up to 30 s. */
async function firstAsk(root: string): Promise<string | undefined> {
  for (let tries = 0; tries < 150; tries++) {
    await sleep(200);
    const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
    try {
      const id = (db.prepare('SELECT id FROM asks').get() as { id: string } | undefined)?.id;
      if (id) return id;
    } finally { db.close(); }
  }
  return undefined;
}

/**
 * A child of this process (the agent of the sessions whose hooks name it) that says hello as `session`'s waiter and,
 * once bound, waits on `on`: the lines the hub wrote back, the hub's own hello first.
 */
function rawWaiter(sock: string, session: string, on: string, gate = ''): Promise<{ pid: number; lines: Record<string, unknown>[] }> {
  const script = `const s=require('net').connect(process.argv[1]);let got='',n=0;s.setEncoding('utf8');
s.on('data',(d)=>{got+=d;const ls=got.split('\\n');while(ls.length-1>n){const l=JSON.parse(ls[n++]);console.log(JSON.stringify(l));
if('hello' in l)s.write(JSON.stringify({v:1,hello:'waiter',session:process.argv[2]})+'\\n');
else if(typeof l.role==='string'){const go=()=>{if(process.argv[4]&&!require('fs').existsSync(process.argv[4]))return setTimeout(go,50);s.write(JSON.stringify({v:1,id:'w1',method:'session.wait',params:{session:process.argv[3],cwd:'',since:Date.now()}})+'\\n');};go();}
else process.exit(0);}});s.on('close',()=>process.exit(0));setTimeout(()=>process.exit(0),8000);`;
  const child = spawn(process.execPath, ['-e', script, sock, session, on, gate], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
  return new Promise((resolve) => child.on('exit', () => resolve({ pid: child.pid!, lines: out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) })));
}

it('wakes an idle session through its waiter with control.token gone, and binds a waiter only to its own session', async () => {
  const a = '7c4d5e60-1851-4222-8333-44445555aaaa';
  const b = '7c4d5e60-1851-4222-8333-44445555bbbb';
  // Session B's agent: a process of its own, no kin of this one.
  const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    await withHub(async (root, home, hub) => {
      writeFileSync(join(root, 'config.json'), JSON.stringify({ asks: { deadline: { taste: '3d' }, default: { taste: 'recommended' } } }));
      writeFileSync(join(home, 'confirm'), 'confirmed\n');
      await hub.restart({ DEEP_HUB_TEST_CONFIRM: join(home, 'confirm') });
      const sock = join(root, 'hub.sock');
      const sa = session(home, a);
      const sb = session(home, b);
      // This process is A's agent, as Claude Code is: its hooks name it, and the waiter is its child.
      for (const event of ['SessionStart', 'Stop']) await reply(sock, hookLine(ulid(Date.now()), event, sa.payload(event, event === 'Stop' ? { stop_hook_active: false } : { source: 'startup' }), { ppid: process.pid }));
      for (const event of ['SessionStart', 'Stop']) await reply(sock, hookLine(ulid(Date.now()), event, sb.payload(event, event === 'Stop' ? { stop_hook_active: false } : { source: 'startup' }), { ppid: other.pid }));

      // A waiter that isn't a child of B's agent, saying hello as B's waiter, is refused, naming the process.
      const posing = await rawWaiter(sock, b, b);
      expect(JSON.stringify(posing.lines[1]), 'the hello as B\'s waiter').toContain(`"code":"role"`);
      expect(JSON.stringify(posing.lines[1])).toContain(`Process ${posing.pid} can't wait as session ${b}'s waiter: it isn't a child of session ${b}'s agent, process ${other.pid}`);
      // A's waiter asking to wait on B is refused, naming its binding.
      const asking = await rawWaiter(sock, a, b);
      expect(asking.lines[1], 'bound to A').toMatchObject({ role: `waiter:${a}` });
      expect(JSON.stringify(asking.lines[2])).toContain(`This waiter is bound to session ${a} by its agent, process ${process.pid}`);

      const tools = mcp(home, sa.work, false);
      await tools.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
      void tools.call('deep_ask', { kind: 'taste', question: 'Which road?', options: [{ id: 'first', label: 'North' }, { id: 'second', label: 'South' }], recommended: 'second' }).catch(() => undefined);
      const ask = await firstAsk(root);
      expect(ask, 'the ask').toBeTruthy();
      tools.close();
      const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
      rmSync(join(root, 'control.token'));

      // deep-hook's waiter, as Claude Code starts it at the stop, with no token on the machine to read.
      const waiter = spawn(HOOK, ['claude-code', 'waiter'], { env: { ...process.env, HOME: home }, stdio: ['pipe', 'ignore', 'pipe'] });
      let said = '';
      waiter.stderr.on('data', (d: Buffer) => { said += d.toString(); });
      const exited = new Promise<number | null>((done) => waiter.on('exit', (code) => done(code)));
      waiter.stdin.end(JSON.stringify(sa.payload('Stop', { stop_hook_active: false })));
      await sleep(1500);
      const cli = await client(sock, token);
      await cli('ask.answer', { ask: `ask:${ask}`, option: 'first' });
      const code = await Promise.race([exited, sleep(10_000).then(() => 'still waiting' as const)]);
      if (code === 'still waiting') waiter.kill('SIGTERM');
      expect(code, `the waiter wakes the session with the answer to ask:${ask}; stderr: ${said}`).toBe(2);
      expect(said).toContain('North');
    });
  } finally {
    other.kill('SIGTERM');
  }
}, 120_000);

it('binds the waiter of an idle session the restarted hub has not heard from, by the agent the last hub watched', async () => {
  const id = '7c4d5e60-1851-4222-8333-44445555cccc';
  await withHub(async (root, home, hub) => {
    writeFileSync(join(root, 'config.json'), JSON.stringify({ asks: { deadline: { taste: '3d' }, default: { taste: 'recommended' } } }));
    writeFileSync(join(home, 'confirm'), 'confirmed\n');
    const env = { DEEP_HUB_TEST_CONFIRM: join(home, 'confirm') };
    await hub.restart(env);
    const sock = join(root, 'hub.sock');
    const s = session(home, id);
    for (const event of ['SessionStart', 'Stop']) await reply(sock, hookLine(ulid(Date.now()), event, s.payload(event, event === 'Stop' ? { stop_hook_active: false } : { source: 'startup' }), { ppid: process.pid }));
    const tools = mcp(home, s.work, false);
    await tools.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    void tools.call('deep_ask', { kind: 'taste', question: 'Which road?', options: [{ id: 'first', label: 'North' }, { id: 'second', label: 'South' }], recommended: 'second' }).catch(() => undefined);
    const ask = await firstAsk(root);
    expect(ask, 'the ask').toBeTruthy();
    tools.close();
    await hub.restart(env);
    const waiter = spawn(HOOK, ['claude-code', 'waiter'], { env: { ...process.env, HOME: home }, stdio: ['pipe', 'ignore', 'pipe'] });
    let said = '';
    waiter.stderr.on('data', (d: Buffer) => { said += d.toString(); });
    const exited = new Promise<number | null>((done) => waiter.on('exit', (code) => done(code)));
    waiter.stdin.end(JSON.stringify(s.payload('Stop', { stop_hook_active: false })));
    await sleep(1500);
    const cli = await client(sock, readFileSync(join(root, 'control.token'), 'utf8').trim());
    await cli('ask.answer', { ask: `ask:${ask}`, option: 'first' });
    const code = await Promise.race([exited, sleep(10_000).then(() => 'still waiting' as const)]);
    if (code === 'still waiting') waiter.kill('SIGTERM');
    expect(code, `the waiter wakes the session with the answer to ask:${ask}; stderr: ${said}`).toBe(2);
    expect(said).toContain('North');
  });
}, 120_000);

it('binds no waiter in a process that runs two sessions, and ends a binding with its session', async () => {
  const c = '7c4d5e60-1851-4222-8333-44445555dddd';
  const d = '7c4d5e60-1851-4222-8333-44445555eeee';
  const e = '7c4d5e60-1851-4222-8333-44445555ffff';
  await withHub(async (root, home) => {
    const sock = join(root, 'hub.sock');
    const sc = session(home, c);
    const sd = session(home, d);
    const se = session(home, e);
    const start = (s: ReturnType<typeof session>) => reply(sock, hookLine(ulid(Date.now()), 'SessionStart', s.payload('SessionStart', { source: 'startup' }), { ppid: process.pid }));
    await start(sc);
    // Bound while C is the one session this process runs; C ends before the wait, and the binding with it.
    const gate = join(home, 'go');
    const ending = rawWaiter(sock, c, c, gate);
    await sleep(1500);
    await reply(sock, hookLine(ulid(Date.now()), 'SessionEnd', sc.payload('SessionEnd', { reason: 'prompt_input_exit' }), { ppid: process.pid }));
    writeFileSync(gate, '');
    const ended = await ending;
    expect(ended.lines[1], 'bound to C while it ran').toMatchObject({ role: `waiter:${c}` });
    expect(JSON.stringify(ended.lines[2])).toContain(`This waiter's binding to session ${c} has ended`);
    // Two live sessions in one process: neither binds a waiter by that process.
    await start(sd);
    await start(se);
    const two = await rawWaiter(sock, d, d);
    expect(JSON.stringify(two.lines[1])).toContain(`"code":"role"`);
    expect(JSON.stringify(two.lines[1])).toContain(`its agent, process ${process.pid}, runs sessions`);
  });
}, 120_000);
