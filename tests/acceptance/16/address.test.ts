// #16 AC2 and AC6: every client takes the hub's address from one setting (<home>/.deepbuild/config.json,
// `{"hub": {"address": "unix:<path>"}}`), and passes against a hub reached through a forwarded socket; a dev
// hub with its own root runs beside the installed hub, and sessions that didn't opt in still reach the
// installed one. The CLI's part is this issue's; deep-hook's forwarding is #315's, `deep mcp` is #26's and the
// app's socket client is #34's, each held here to the same setting (README, What depends on other issues).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allEvents, buildDeepHook, childEnv, cleanup, CLI, control, DEEP_HOOK, deep, forwarder, fromHere, health, hookRequest, makeHome,
  newSession, NODE, own, payload, run, sendHook, setAddress, startHub, tempDir, tokenOf, waitFor, type Hub, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** deep-hook as an agent's hook entry runs it: `deep-hook <agent> <event>`, the hook's JSON on stdin (README, deep-hook). */
const deepHook = (home: string, cwd: string, event: string, body: Line, env: Record<string, string> = {}, binary = DEEP_HOOK) =>
  run(binary, ['claude-code', event], { cwd, env: childEnv(home, env), input: JSON.stringify(body), timeoutMs: 30_000 });

/** `deep mcp` over stdio: initialize, then call deep_status. Resolves with the tools/call response. */
function deepMcpStatus(home: string, cwd: string): Promise<Line | undefined> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, 'mcp'], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let buffer = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(undefined); }, 20_000);
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (const raw of buffer.split('\n').slice(0, -1)) {
        let line: Line;
        try { line = JSON.parse(raw) as Line; } catch { continue; }
        if (line.id === 2) { clearTimeout(timer); child.kill(); resolve(line); return; }
      }
    });
    child.on('close', () => { clearTimeout(timer); resolve(undefined); });
    const send = (o: Line) => child.stdin.write(`${JSON.stringify(o)}\n`);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'deep-acceptance-16', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'deep_status', arguments: {} } });
  });
}
/** The hook requests a forwarder carried, by the event they name. */
const requestsIn = (text: string, event: string): Line[] => text.split('\n').flatMap((raw) => { try { const l = JSON.parse(raw) as Line; return l.event === event && typeof l.id === 'string' ? [l] : []; } catch { return []; } });

describe('AC2 #16.818c41e7 every client takes the hub\'s address from one setting and passes through a forwarded socket', () => {
  async function forwarded(): Promise<{ home: string; hub: Hub; fwd: Awaited<ReturnType<typeof forwarder>> }> {
    const home = makeHome();
    const hub = await startHub({ home });
    const fwd = await forwarder(tempDir(), hub.socket);
    setAddress(home, `unix:${fwd.path}`);
    return { home, hub, fwd };
  }

  it('AC2 the CLI: `deep hub status` reaches the hub through the forwarded socket the setting names, and exits 3 naming the address when it is gone', async () => {
    const { home, hub, fwd } = await forwarded();
    const ok = await deep(home, ['hub', 'status']);
    expect(ok.code, `deep hub status through the forward: ${ok.stderr}`).toBe(0);
    expect((JSON.parse(ok.stdout.trim().split('\n').pop()!) as Line).start, 'it read the hub behind the forward').toBe(hub.start);
    expect(fwd.connections, 'the CLI went through the forwarded socket').toBeGreaterThanOrEqual(1);
    await fwd.close();
    const down = await deep(home, ['hub', 'status']);
    expect(down.code, 'a hub it couldn\'t read exits 3').toBe(3);
    expect(`${down.stdout}${down.stderr}`, 'it names the address it tried').toContain(fwd.path);
  }, 60_000);

  it('AC2 deep-hook (#315): a PreToolUse goes through the forwarded socket the setting names, and the hub records it', async () => {
    await buildDeepHook();
    const { home, hub, fwd } = await forwarded();
    const s = newSession(home, 'claude-code');
    const r = await deepHook(home, s.cwd, 'PreToolUse', payload(s, 'PreToolUse'));
    expect(r.code, `deep-hook exits 0: ${r.stderr}`).toBe(0);
    const sent = requestsIn(fwd.upText(), 'PreToolUse');
    expect(sent.length, 'deep-hook sent its request through the forward').toBe(1);
    const cli = await control(hub);
    await waitFor(async () => (await allEvents(cli)).some((e) => e.id === sent[0]!.id) || undefined, 10_000, `the hub to record ${sent[0]!.id}`);
    cli.close();
  }, 600_000);

  it('AC2 deep mcp (#26): deep_status goes through the forwarded socket the setting names and succeeds', async () => {
    const { home, fwd } = await forwarded();
    const s = newSession(home, 'claude-code');
    const reply = await deepMcpStatus(home, s.cwd);
    expect(reply?.result, `deep_status answered: ${JSON.stringify(reply)}`).toBeDefined();
    expect(reply?.result?.isError, 'deep_status is no error').not.toBe(true);
    expect(fwd.upText(), 'deep mcp said hello through the forward').toContain('"hello":"mcp"');
  }, 60_000);

  it('AC2 the app (#34): its socket client\'s tests pass against the hub through the forwarded socket the setting names', async () => {
    const { home, fwd } = await forwarded();
    const r = await run('cargo', ['test', '--locked', '-q', '-p', 'deep-app', '--test', 'hub_client'], { env: childEnv(home), timeoutMs: 1_800_000 });
    expect(r.code, `cargo test -p deep-app --test hub_client: ${r.stderr.slice(-3000)}`).toBe(0);
    expect(fwd.connections, 'the app\'s client went through the forwarded socket').toBeGreaterThanOrEqual(1);
  }, 1_800_000);
});

describe('AC6 #16.a88e65ab a dev hub with its own root runs beside the installed hub; sessions that didn\'t opt in still reach the installed one', () => {
  it('AC6 the dev hub has its own socket, ledger, evidence and control token, and each hub records only what reached it', async () => {
    const home = makeHome();
    const installed = await startHub({ home });
    const dev = await startHub({ home, root: join(tempDir(), 'dev') });
    expect(dev.socket).not.toBe(installed.socket);
    expect(dev.start).not.toBe(installed.start);
    expect(dev.pid).not.toBe(installed.pid);
    for (const hub of [installed, dev]) {
      expect(statSync(join(hub.root, 'hub.sock')).isSocket(), `${hub.root}/hub.sock`).toBe(true);
      expect(existsSync(join(hub.root, 'ledger.db')), `${hub.root}/ledger.db`).toBe(true);
      expect(statSync(join(hub.root, 'evidence')).isDirectory(), `${hub.root}/evidence/`).toBe(true);
    }
    expect(tokenOf(dev.root), 'the dev hub has its own control token').not.toBe(tokenOf(installed.root));
    const s = newSession(home, 'claude-code');
    const toInstalled = fromHere(hookRequest(s, 'PreToolUse'));
    const toDev = fromHere(hookRequest(s, 'PreToolUse'));
    expect((await sendHook(installed.socket, toInstalled)).ack).toBeDefined();
    expect((await sendHook(dev.socket, toDev)).ack).toBeDefined();
    const [ci, cd] = [await control(installed), await control(dev)];
    const ei = await waitFor(async () => { const all = await allEvents(ci); return all.some((e) => e.id === toInstalled.id) ? all : undefined; }, 10_000, 'the installed hub\'s event');
    const ed = await waitFor(async () => { const all = await allEvents(cd); return all.some((e) => e.id === toDev.id) ? all : undefined; }, 10_000, 'the dev hub\'s event');
    expect(ei.some((e) => e.id === toDev.id), 'the installed hub has nothing that went to the dev hub').toBe(false);
    expect(ed.some((e) => e.id === toInstalled.id), 'the dev hub has nothing that went to the installed hub').toBe(false);
    expect((await health(ci)).pid).toBe(installed.pid);
    expect((await health(cd)).pid).toBe(dev.pid);
    ci.close();
    cd.close();
  }, 60_000);

  it('AC6 with a dev hub running, the CLI, deep-hook (#315) and deep mcp (#26) from a worktree that didn\'t opt in reach the installed hub', async () => {
    await buildDeepHook();
    const home = makeHome();
    const installed = await startHub({ home });
    const dev = await startHub({ home, root: join(tempDir(), 'dev') });
    // A forward in front of the installed hub, named by the setting, counts who reached it.
    const fwd = await forwarder(tempDir(), installed.socket);
    setAddress(home, `unix:${fwd.path}`);
    const worktree = join(tempDir(), 'deepbuild-worktree');
    mkdirSync(worktree, { recursive: true });
    const s = newSession(home, 'claude-code', worktree);
    const cd = await control(dev);
    const devBefore = (await allEvents(cd)).length;

    const status = await deep(home, ['hub', 'status'], { cwd: worktree });
    expect(status.code, status.stderr).toBe(0);
    expect((JSON.parse(status.stdout.trim().split('\n').pop()!) as Line).start, 'deep hub status reads the installed hub').toBe(installed.start);
    const devStatus = await deep(home, ['hub', 'status', '--root', dev.root], { cwd: worktree });
    expect((JSON.parse(devStatus.stdout.trim().split('\n').pop()!) as Line).start, 'and the dev hub only with --root').toBe(dev.start);

    const r = await deepHook(home, worktree, 'PreToolUse', payload(s, 'PreToolUse'));
    expect(r.code, r.stderr).toBe(0);
    const sent = requestsIn(fwd.upText(), 'PreToolUse');
    expect(sent.length, 'deep-hook reached the installed hub').toBe(1);
    const reply = await deepMcpStatus(home, worktree);
    expect(reply?.result, `deep mcp answered: ${JSON.stringify(reply)}`).toBeDefined();
    expect(fwd.upText(), 'deep mcp reached the installed hub').toContain('"hello":"mcp"');
    const ci = await control(installed);
    await waitFor(async () => (await allEvents(ci)).some((e) => e.id === sent[0]!.id) || undefined, 10_000, 'the installed hub to record the hook');
    expect((await allEvents(cd)).length, 'the dev hub recorded nothing from the session that didn\'t opt in').toBe(devBefore);
    ci.close();
    cd.close();
  }, 600_000);
});
