// #332's environment resources past its acceptance suite: a worktree's stack stays the session's that leased its keys,
// a stack that dies gives its keys back, values env-local loads are scrubbed from hook text, and computer use acts on
// nothing a lease doesn't cover. Real hub, real `deep env`, the agent stand-in and fixtures of #332's suite.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { sessionIn } from '../../../tests/acceptance/332/agents.ts';
import {
  cleanup, Client, denies, get, given, holderIs, home, jsonOut, leaseEvents, makeRepo, mustBeReady, READY, serverUp, startHub, stopHub, waitFor,
} from '../../../tests/acceptance/332/helpers.ts';

afterEach(cleanup, 60_000);

it('a second session in a worktree whose stack another session leased is BLOCKED naming that session, and can\'t take it down', async () => {
  const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20, leases: { SHOP_ACCOUNT: { kind: 'account', keys: ['shop-test-1'] } } });
  const w = t.worktree('wt-a');
  const hub = await startHub(join(home(), '.deepbuild'));
  try {
    const A = await sessionIn(hub, w);
    const B = await sessionIn(hub, w);
    const upA = mustBeReady(await A.agent.env(hub, A.s, 'up'), w);
    const ranB = await B.agent.env(hub, B.s, 'up');
    expect(jsonOut(ranB), `B's up in A's worktree is BLOCKED (${ranB.stdout} ${ranB.stderr})`).toMatchObject({ status: 'BLOCKED', cause: expect.stringContaining(A.s.id) });
    const downB = await B.agent.env(hub, B.s, 'down');
    expect(downB.code, `B's down of A's stack is refused (${downB.stdout} ${downB.stderr})`).not.toBe(0);
    expect((await given(upA.ports.web as number, 'A\'s stack')).SHOP_ACCOUNT, 'A\'s stack still runs on its account').toBe('shop-test-1');
    expect((await A.agent.env(hub, A.s, 'down')).code, 'A takes its own stack down').toBe(0);
  } finally {
    await stopHub(hub);
  }
}, 240_000);

it('a stack that dies on its own gives its keys back, so the next session\'s up gets them', async () => {
  const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20, leases: { SHOP_ACCOUNT: { kind: 'account', keys: ['shop-test-1'] } } });
  const a = t.worktree('wt-a');
  const b = t.worktree('wt-b');
  const hub = await startHub(join(home(), '.deepbuild'));
  const client = await Client.open(hub);
  try {
    const A = await sessionIn(hub, a);
    const B = await sessionIn(hub, b);
    const upA = mustBeReady(await A.agent.env(hub, A.s, 'up'), a);
    // The stack's server, which this test's hub started, stops by its PID.
    process.kill((await get(upA.ports.web as number, '/health')).body?.pid as number, 'SIGKILL');
    await waitFor(async () => (await get(upA.ports.web as number, '/health')).status === null, 15_000, 'A\'s stack to stop answering');
    const upB = mustBeReady(await B.agent.env(hub, B.s, 'up'), b);
    expect((await given(upB.ports.web as number, 'B\'s stack')).SHOP_ACCOUNT, 'B gets the account A\'s dead stack held').toBe('shop-test-1');
    const toB = leaseEvents(await client.events(), 'lease.acquired', 'account', 'shop-test-1').filter((e) => holderIs(e.data.holder, B.s.id));
    expect(toB.length, 'under a lease of B\'s own').toBe(1);
  } finally {
    client.close();
    await stopHub(hub);
  }
}, 240_000);

it('a credential env-local loaded into a stack is scrubbed by value from the hook text the record keeps', async () => {
  const value = 'plainvalue4711';
  writeFileSync(join(home(), '.shop'), `SHOP_KEY=${value}\n`);
  const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20, credentials: { SHOP_KEY: { dotfile: '~/.shop' } } });
  const w = t.worktree('wt-a');
  const hub = await startHub(join(home(), '.deepbuild'));
  const client = await Client.open(hub);
  try {
    const A = await sessionIn(hub, w);
    mustBeReady(await A.agent.env(hub, A.s, 'up'), w);
    // The agent echoes the value it read from the app: the command line the record keeps names it.
    await A.agent.preToolUse(hub, A.s, 'Bash', { command: `echo marker-332 ${value}`, description: 'Show the key' });
    await waitFor(async () => JSON.stringify(await client.events()).includes('marker-332'), 15_000, 'the command in the record');
    expect(JSON.stringify(await client.events()), 'the record never holds the value').not.toContain(value);
  } finally {
    client.close();
    await stopHub(hub);
  }
}, 240_000);

it('on its leased screen, computer use is still denied apps it doesn\'t lease, your clipboard and machine-wide keys', async () => {
  const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20, leases: { SCREEN: { kind: 'screen', keys: ['screen-2'] }, WINDOW: { kind: 'window', keys: ['Simulator'] } } });
  const w = t.worktree('wt-a');
  const hub = await startHub(join(home(), '.deepbuild'));
  try {
    const A = await sessionIn(hub, w);
    mustBeReady(await A.agent.env(hub, A.s, 'up'), w);
    const step = async (tool: string, input: Record<string, unknown>) => denies((await A.agent.preToolUse(hub, A.s, `mcp__computer-use__${tool}`, input)).reply);
    expect(await step('screenshot', {}), 'a step before its switch has run').toBe(true);
    expect(await step('switch_display', { display: 'screen-2' }), 'its own screen').toBe(false);
    expect(await step('screenshot', {}), 'a step while its switch hasn\'t run (no PostToolUse yet)').toBe(true);
    await A.agent.hook(hub, A.s, 'PostToolUse', { tool_name: 'mcp__computer-use__switch_display', tool_input: { display: 'screen-2' }, tool_response: 'switched', tool_use_id: 'toolu_332switch' });
    expect(await step('request_teach_access', { apps: ['Google Chrome'], reason: 'r' }), 'teaching in your browser').toBe(true);
    expect(await step('read_clipboard', {}), 'reading your clipboard').toBe(true);
    expect(await step('request_access', { apps: ['Simulator'], reason: 'r', clipboardWrite: true }), 'a grant of your clipboard').toBe(true);
    expect(await step('request_access', { apps: ['Simulator'], reason: 'r', systemKeyCombos: true }), 'machine-wide keys').toBe(true);
    expect(await step('request_access', { apps: ['Simulator'], reason: 'r' }), 'the app whose window it leases').toBe(false);
    expect(await step('computer_batch', { actions: [{ action: 'screenshot' }] }), 'a step on its own screen').toBe(false);
    expect(await step('list_granted_applications', {}), 'reading which apps it was granted').toBe(false);
  } finally {
    await stopHub(hub);
  }
}, 240_000);

it('once the session that leased a worktree\'s stack has ended, the next session\'s up starts it again with its keys leased to that session', async () => {
  const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20, leases: { SHOP_ACCOUNT: { kind: 'account', keys: ['shop-test-1'] } } });
  const w = t.worktree('wt-a');
  const hub = await startHub(join(home(), '.deepbuild'));
  const client = await Client.open(hub);
  try {
    const A = await sessionIn(hub, w);
    const upA = mustBeReady(await A.agent.env(hub, A.s, 'up'), w);
    await A.agent.hook(hub, A.s, 'SessionEnd', { reason: 'exit' });
    const C = await sessionIn(hub, w);
    const upC = mustBeReady(await C.agent.env(hub, C.s, 'up'), w);
    expect(upC.run, 'C\'s stack is a new one, not A\'s').not.toBe(upA.run);
    const leases = leaseEvents(await client.events(), 'lease.acquired', 'account', 'shop-test-1');
    expect(holderIs(leases.at(-1)?.data.holder, C.s.id), `the account is now leased to C (${JSON.stringify(leases.map((e) => e.data.holder))})`).toBe(true);
    const downC = await C.agent.env(hub, C.s, 'down');
    expect(downC.code, `C takes it down (${downC.stdout} ${downC.stderr})`).toBe(0);
  } finally {
    client.close();
    await stopHub(hub);
  }
}, 240_000);

it('a stack whose first process exits while the server it started keeps serving is not swept by another worktree\'s up', async () => {
  // The up line starts the server and exits a few seconds after it answers: the server goes on serving.
  const t = makeRepo({ up: `${serverUp()} & sleep 3`, ports: ['web'], ready: READY, within: 20, leases: { SHOP_ACCOUNT: { kind: 'account', keys: ['shop-test-1', 'shop-test-2'] } } });
  const y = t.worktree('wt-y');
  const x = t.worktree('wt-x');
  const hub = await startHub(join(home(), '.deepbuild'));
  try {
    const Y = await sessionIn(hub, y);
    const X = await sessionIn(hub, x);
    const upY = mustBeReady(await Y.agent.env(hub, Y.s, 'up'), y);
    await waitFor(async () => !(await get(upY.ports.web as number, '/health')).error && (await new Promise((r) => setTimeout(r, 4_000, true))), 15_000, 'Y\'s up line to exit');
    mustBeReady(await X.agent.env(hub, X.s, 'up'), x);
    expect((await get(upY.ports.web as number, '/health')).body?.cwd, 'Y\'s own server still answers on its port').toBe(y);
  } finally {
    await stopHub(hub);
  }
}, 240_000);

it('another session\'s up in a worktree whose stack stopped answering is BLOCKED naming its owner, and never takes its keys', async () => {
  const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20, leases: { SHOP_ACCOUNT: { kind: 'account', keys: ['shop-test-1'] } } });
  const w = t.worktree('wt-a');
  const hub = await startHub(join(home(), '.deepbuild'));
  const client = await Client.open(hub);
  let server: number | undefined;
  try {
    const A = await sessionIn(hub, w);
    const B = await sessionIn(hub, w);
    const upA = mustBeReady(await A.agent.env(hub, A.s, 'up'), w);
    // A's server, which this test's hub started, is paused by its PID: it still runs, and no longer answers.
    server = (await get(upA.ports.web as number, '/health')).body?.pid as number;
    process.kill(server, 'SIGSTOP');
    await waitFor(async () => (await get(upA.ports.web as number, '/health')).status === null, 15_000, 'A\'s stack to stop answering');
    const ranB = await B.agent.env(hub, B.s, 'up');
    expect(jsonOut(ranB), `B's up is BLOCKED naming A (${ranB.stdout} ${ranB.stderr})`).toMatchObject({ status: 'BLOCKED', cause: expect.stringContaining(A.s.id) });
    const toB = leaseEvents(await client.events(), 'lease.acquired', 'account', 'shop-test-1').filter((e) => holderIs(e.data.holder, B.s.id));
    expect(toB.map((e) => e.data), 'A\'s account was never leased to B').toEqual([]);
  } finally {
    if (server) process.kill(server, 'SIGCONT');
    client.close();
    await stopHub(hub);
  }
}, 240_000);

it('another session\'s up in a worktree whose stack died on its own gets the keys it held', async () => {
  const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20, leases: { SHOP_ACCOUNT: { kind: 'account', keys: ['shop-test-1'] } } });
  const w = t.worktree('wt-a');
  const hub = await startHub(join(home(), '.deepbuild'));
  try {
    const A = await sessionIn(hub, w);
    const B = await sessionIn(hub, w);
    const upA = mustBeReady(await A.agent.env(hub, A.s, 'up'), w);
    // The stack's server, which this test's hub started, stops by its PID.
    process.kill((await get(upA.ports.web as number, '/health')).body?.pid as number, 'SIGKILL');
    await waitFor(async () => (await get(upA.ports.web as number, '/health')).status === null, 15_000, 'A\'s stack to stop answering');
    const upB = await waitFor(async () => {
      const ran = await B.agent.env(hub, B.s, 'up');
      return jsonOut(ran)?.status === 'ready' ? jsonOut(ran) : undefined;
    }, 30_000, 'B\'s up to get the account A\'s dead stack held');
    expect((await given(upB.ports.web as number, 'B\'s stack')).SHOP_ACCOUNT, 'B runs on shop-test-1').toBe('shop-test-1');
  } finally {
    await stopHub(hub);
  }
}, 240_000);

it('a credential is scrubbed from hook text even when its stack never comes up', async () => {
  const value = 'plainvalue5821';
  writeFileSync(join(home(), '.shop'), `SHOP_KEY=${value}\n`);
  // The stack starts and never answers its health route.
  const t = makeRepo({ up: 'sleep 30', ports: ['web'], ready: READY, within: 2, credentials: { SHOP_KEY: { dotfile: '~/.shop' } } });
  const w = t.worktree('wt-a');
  const hub = await startHub(join(home(), '.deepbuild'));
  const client = await Client.open(hub);
  try {
    const A = await sessionIn(hub, w);
    expect(jsonOut(await A.agent.env(hub, A.s, 'up'))?.status, 'the stack never comes up').toBe('BLOCKED');
    await A.agent.preToolUse(hub, A.s, 'Bash', { command: `echo marker-5821 ${value}`, description: 'Show the key' });
    await waitFor(async () => JSON.stringify(await client.events()).includes('marker-5821'), 15_000, 'the command in the record');
    expect(JSON.stringify(await client.events()), 'the record never holds the value').not.toContain(value);
  } finally {
    client.close();
    await stopHub(hub);
  }
}, 240_000);

it('a session that ends takes the stack it leased keys for down, so another worktree\'s session gets them', async () => {
  const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20, leases: { GPU: { kind: 'gpu', keys: ['gpu-0'] } } });
  const a = t.worktree('wt-a');
  const b = t.worktree('wt-b');
  const hub = await startHub(join(home(), '.deepbuild'));
  try {
    const A = await sessionIn(hub, a);
    const B = await sessionIn(hub, b);
    mustBeReady(await A.agent.env(hub, A.s, 'up'), a);
    await A.agent.hook(hub, A.s, 'SessionEnd', { reason: 'exit' });
    const upB = await waitFor(async () => {
      const ran = await B.agent.env(hub, B.s, 'up');
      return jsonOut(ran)?.status === 'ready' ? jsonOut(ran) : undefined;
    }, 30_000, 'B\'s up to get gpu-0 once A has ended');
    expect((await given(upB.ports.web as number, 'B\'s stack')).GPU, 'B runs on gpu-0').toBe('gpu-0');
  } finally {
    await stopHub(hub);
  }
}, 240_000);

it('a session whose agent is killed, with no SessionEnd, takes the stack it leased keys for down, so another worktree\'s session gets them', async () => {
  const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20, leases: { GPU: { kind: 'gpu', keys: ['gpu-0'] } } });
  const a = t.worktree('wt-a');
  const b = t.worktree('wt-b');
  const hub = await startHub(join(home(), '.deepbuild'));
  try {
    const A = await sessionIn(hub, a);
    const B = await sessionIn(hub, b);
    mustBeReady(await A.agent.env(hub, A.s, 'up'), a);
    process.kill(A.agent.pid, 'SIGKILL');
    const upB = await waitFor(async () => {
      const ran = await B.agent.env(hub, B.s, 'up');
      return jsonOut(ran)?.status === 'ready' ? jsonOut(ran) : undefined;
    }, 30_000, 'B\'s up to get gpu-0 once A\'s agent is gone');
    expect((await given(upB.ports.web as number, 'B\'s stack')).GPU, 'B runs on gpu-0').toBe('gpu-0');
  } finally {
    await stopHub(hub);
  }
}, 240_000);

it('a session whose start can\'t be read for a moment (ps failing under load) keeps its stack and keys', async () => {
  // ps fails while the flag exists, as it does when the machine can't fork; the hub finds ps on its PATH.
  const bin = join(home(), 'flaky-ps');
  const flag = join(bin, 'failing');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'ps'), `#!/bin/sh\n[ -e ${JSON.stringify(flag)} ] && exit 1\nexec /bin/ps "$@"\n`, { mode: 0o755 });
  const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20, leases: { GPU: { kind: 'gpu', keys: ['gpu-0'] } } });
  const a = t.worktree('wt-a');
  const b = t.worktree('wt-b');
  const hub = await startHub(join(home(), '.deepbuild'), { PATH: `${bin}:${process.env.PATH ?? ''}` });
  try {
    const A = await sessionIn(hub, a);
    const B = await sessionIn(hub, b);
    const upA = mustBeReady(await A.agent.env(hub, A.s, 'up'), a);
    writeFileSync(flag, '');
    expect(jsonOut(await B.agent.env(hub, B.s, 'up'))?.status, 'B\'s up while A\'s start can\'t be read').not.toBe('ready');
    rmSync(flag);
    expect((await given(upA.ports.web as number, 'A\'s stack, still up')).GPU, 'A still runs on gpu-0').toBe('gpu-0');
  } finally {
    rmSync(flag, { force: true });
    await stopHub(hub);
  }
}, 240_000);

it('an agent\'s up while ps fails is refused, never credited to your own terminal', async () => {
  const bin = join(home(), 'flaky-ps');
  const flag = join(bin, 'failing');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'ps'), `#!/bin/sh\n[ -e ${JSON.stringify(flag)} ] && exit 1\nexec /bin/ps "$@"\n`, { mode: 0o755 });
  const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20, leases: { GPU: { kind: 'gpu', keys: ['gpu-0'] } } });
  const a = t.worktree('wt-a');
  const hub = await startHub(join(home(), '.deepbuild'), { PATH: `${bin}:${process.env.PATH ?? ''}` });
  try {
    const A = await sessionIn(hub, a);
    writeFileSync(flag, '');
    const up = jsonOut(await A.agent.env(hub, A.s, 'up'));
    rmSync(flag);
    expect(up?.status, 'A\'s up while no start can be read').toBe('BLOCKED');
    const client = await Client.open(hub);
    expect(leaseEvents(await client.events(), 'lease.acquired', 'gpu').map((e) => e.data.holder), 'no lease credited to your terminal').not.toContain('core');
  } finally {
    rmSync(flag, { force: true });
    await stopHub(hub);
  }
}, 240_000);

it('Claude in Chrome, which acts in your own Chrome, is denied even a session that leases a Chrome window', async () => {
  const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20, leases: { SCREEN: { kind: 'screen', keys: ['screen-2'] }, WINDOW: { kind: 'window', keys: ['Google Chrome'] } } });
  const w = t.worktree('wt-a');
  const hub = await startHub(join(home(), '.deepbuild'));
  try {
    const A = await sessionIn(hub, w);
    mustBeReady(await A.agent.env(hub, A.s, 'up'), w);
    const step = async (tool: string, input: Record<string, unknown>) => denies((await A.agent.preToolUse(hub, A.s, tool, input)).reply);
    expect(await step('mcp__claude-in-chrome__navigate', { url: 'https://example.com', tabId: 1 }), 'navigating your Chrome').toBe(true);
    expect(await step('mcp__remote-devices__computer_screenshot', {}), 'a remote-desktop step before a switch to a leased screen').toBe(true);
  } finally {
    await stopHub(hub);
  }
}, 240_000);

it('a session that ends while its stack comes up leaves no key behind: the up is BLOCKED and another session gets the key', async () => {
  // The up line waits before it starts the server, so the session can end while the stack comes up.
  const t = makeRepo({ up: `sleep 3 && exec ${serverUp()}`, ports: ['web'], ready: READY, within: 20, leases: { GPU: { kind: 'gpu', keys: ['gpu-0'] } } });
  const a = t.worktree('wt-a');
  const b = t.worktree('wt-b');
  const hub = await startHub(join(home(), '.deepbuild'));
  try {
    const A = await sessionIn(hub, a);
    const B = await sessionIn(hub, b);
    const upA = A.agent.env(hub, A.s, 'up');
    await new Promise((r) => setTimeout(r, 1_000));
    await A.agent.hook(hub, A.s, 'SessionEnd', { reason: 'exit' });
    expect(jsonOut(await upA)?.status, 'A\'s up, whose session ended, is BLOCKED').toBe('BLOCKED');
    const upB = mustBeReady(await B.agent.env(hub, B.s, 'up'), b);
    expect((await given(upB.ports.web as number, 'B\'s stack')).GPU, 'B runs on gpu-0').toBe('gpu-0');
  } finally {
    await stopHub(hub);
  }
}, 240_000);

it('two variables leased from one pool get two different keys', async () => {
  const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20, leases: { SHOP_ACCOUNT: { kind: 'account', keys: ['shop-test-1', 'shop-test-2'] }, GPU: { kind: 'account', keys: ['shop-test-1', 'shop-test-2'] } } });
  const w = t.worktree('wt-a');
  const hub = await startHub(join(home(), '.deepbuild'));
  try {
    const A = await sessionIn(hub, w);
    const env = await given(mustBeReady(await A.agent.env(hub, A.s, 'up'), w).ports.web as number, 'A\'s stack');
    expect([env.SHOP_ACCOUNT, env.GPU].sort(), 'each variable has a key of its own').toEqual(['shop-test-1', 'shop-test-2']);
  } finally {
    await stopHub(hub);
  }
}, 240_000);

it('a credential the seed step writes into its record is scrubbed from the record\'s seed.cloned', async () => {
  const value = 'plainvalue6630';
  writeFileSync(join(home(), '.shop'), `SHOP_KEY=${value}\n`);
  const seed = `printf '{"source":"db://admin:${value}@prod/shop","copied_at":"2026-10-01T04:00:00.000Z","migration":"m1"}' > "$DEEP_SEED_RECORD" && : > "$DATABASE"`;
  const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20, credentials: { SHOP_KEY: { dotfile: '~/.shop' } }, seed: { run: seed, database: 'DATABASE' } });
  const w = t.worktree('wt-a');
  const hub = await startHub(join(home(), '.deepbuild'));
  const client = await Client.open(hub);
  try {
    const A = await sessionIn(hub, w);
    mustBeReady(await A.agent.env(hub, A.s, 'up'), w);
    const cloned = (await client.events()).filter((e) => e.kind === 'seed.cloned');
    expect(cloned.length, 'the clone is recorded').toBe(1);
    expect(JSON.stringify(cloned), 'without the value').not.toContain(value);
  } finally {
    client.close();
    await stopHub(hub);
  }
}, 240_000);
