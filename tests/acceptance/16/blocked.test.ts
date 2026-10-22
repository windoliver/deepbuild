// #16 AC8: the record fails closed. Under the test VFS with `refuse` set, every write fails with an I/O error
// while that file exists, as on a full disk (README, The test VFS). The claims come from session A's deep mcp
// (deep_claim); the gates' state is read from `hub.health` (gates.watch_only, gates.reason).
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Agent, allEvents, claimArgs, cleanup, control, establish, fromHere, health, hookRequest, makeHome, newSession, sendHook, startHub, stopHub,
  tempDir, waitFor, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

describe('AC8 #16.29f3d795 when an append fails the hub stops acknowledging claims and every gate turns watch-only, BLOCKED, until appends work', () => {
  it('AC8 a full disk: claims refused and gates watch-only with a BLOCKED reason; both back once writes succeed', async () => {
    const home = makeHome();
    const refuse = join(tempDir(), 'disk-full');
    const hub = await startHub({ home, vfs: { refuse } });
    const A = newSession(home, 'claude-code');
    const P = Agent.start(home, A.cwd);
    await establish(P, hub.socket, A);
    const hello = await P.mcpOpen(hub.socket);
    if (hello.role !== `mcp:${A.id}`) throw Error(`BLOCKED: deep mcp for session A wasn't bound to it: ${JSON.stringify(hello)}`);
    const cli = await control(hub);
    const claim = async () => P.mcp('mcp.call', { tool: 'deep_claim', arguments: claimArgs() });

    const before = await health(cli);
    expect(String(before.gates?.reason ?? ''), 'no BLOCKED reason while appends work').not.toMatch(/BLOCKED/);
    const first = await claim();
    expect(first.result, `a claim is acknowledged while appends work: ${JSON.stringify(first.error)}`).toBeDefined();

    writeFileSync(refuse, '');
    await sendHook(hub.socket, fromHere(hookRequest(A, 'PreToolUse')));
    const blocked = await waitFor(async () => { const h = await health(cli); return /BLOCKED/.test(String(h.gates?.reason ?? '')) ? h : undefined; }, 10_000, 'the gates to read BLOCKED');
    expect(blocked.gates.watch_only, 'every gate is watch-only while appends fail').toBe(true);
    expect(String(blocked.gates.reason), 'the reason says appends are failing').toMatch(/^BLOCKED/);
    const refused: Line = await claim();
    expect(refused.result, `a claim is not acknowledged while appends fail: ${JSON.stringify(refused)}`).toBeUndefined();
    expect(refused.error, 'the claim gets a refusal instead').toBeDefined();
    const second = await waitFor(async () => { const h = await health(cli); return /BLOCKED/.test(String(h.gates?.reason ?? '')) ? h : undefined; }, 1000, 'the gates to stay BLOCKED');
    expect(second.gates.watch_only).toBe(true);

    rmSync(refuse);
    await waitFor(async () => { const h = await health(cli); return !/BLOCKED/.test(String(h.gates?.reason ?? '')) || undefined; }, 15_000, 'the BLOCKED reason to clear once appends work again');
    const third = await claim();
    expect(third.result, `claims are acknowledged again: ${JSON.stringify(third.error)}`).toBeDefined();
    const events = await allEvents(cli);
    expect(events.some((e) => e.kind === 'claim.made' && e.id === (third.result as Line).event), 'the claim after recovery is in the record').toBe(true);
    cli.close();
    await P.stop();
    await stopHub(hub);
  }, 90_000);
});
