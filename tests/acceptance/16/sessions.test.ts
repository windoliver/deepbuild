// #16 AC9 and AC17: an event that claims a session is checked against it (its transcript under the agent's
// home, its working folder, its process tree); one that can't be checked is recorded as unverified and takes
// nothing over. The sessions here come from fixtures/agent.mjs, a real process whose children carry its hooks
// and its deep mcp, so the hub sees a true process tree (README, The agent stand-in).
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Agent, allEvents, claimArgs, cleanup, control, establish, hookRequest, makeHome, newSession, startHub, stopHub, tempDir, waitFor,
  type Ev, type Hub, type Line, type Session,
} from './helpers.ts';

afterEach(cleanup, 60_000);

async function eventOf(hub: Hub, id: string): Promise<Ev[]> {
  const cli = await control(hub);
  try {
    return await waitFor(async () => { const all = (await allEvents(cli)).filter((e) => e.id === id); return all.length ? all : undefined; }, 10_000, `the event ${id}`);
  } finally { cli.close(); }
}
/** deep_claim through an agent's deep mcp: the session it bound to, or the refusal. */
async function claim(agent: Agent, args = claimArgs()): Promise<{ session?: string; error?: Line; args: Line }> {
  const reply = await agent.mcp('mcp.call', { tool: 'deep_claim', arguments: args });
  return reply.error ? { error: reply.error as Line, args } : { session: (reply.result as Line).session as string, args };
}

type Variant = 'process tree' | 'working folder' | 'transcript';
describe('AC9 #16.077ffde2 an event that claims a session it can\'t be checked against is recorded as unverified and never takes it over', () => {
  it.each<Variant>(['process tree', 'working folder', 'transcript'])('AC9 a SessionStart claiming session S that fails only the %s check', async (variant) => {
    const home = makeHome();
    const hub = await startHub({ home });
    const S = newSession(home, 'claude-code');
    const P = Agent.start(home, S.cwd);
    await establish(P, hub.socket, S);
    expect((await P.mcpOpen(hub.socket)).role, 'the real agent\'s deep mcp binds to S').toBe(`mcp:${S.id}`);

    // The impostor's request names S. Only one thing about it disagrees with S.
    let impostor: Agent | undefined;
    let sent: { id: string };
    if (variant === 'process tree') {
      impostor = Agent.start(home, S.cwd);   // another process, same folder, S's own transcript path
      const r = hookRequest(S, 'SessionStart');
      await impostor.hook(hub.socket, r);
      sent = r;
    } else if (variant === 'working folder') {
      const elsewhere = join(tempDir(), 'elsewhere');
      mkdirSync(elsewhere, { recursive: true });
      const r = hookRequest({ ...S, cwd: elsewhere }, 'SessionStart');
      await P.hook(hub.socket, r, { cwd: elsewhere });
      sent = r;
    } else {
      const fake = join(S.cwd, 'not-under-the-agent-home.jsonl');
      writeFileSync(fake, '{}\n');
      const r = hookRequest({ ...S, transcript: fake }, 'SessionStart');
      await P.hook(hub.socket, r);
      sent = r;
    }
    const recorded = await eventOf(hub, sent.id);
    expect(recorded.map((e) => e.verified), `the claiming event ${sent.id} is recorded, unverified`).toEqual(recorded.map(() => false));

    // It took nothing over: S's own next event is still verified, S's deep mcp still binds S's claims,
    // and an impostor's deep mcp gets no session and can't claim.
    const next = hookRequest(S, 'PreToolUse');
    await P.hook(hub.socket, next);
    expect((await eventOf(hub, next.id)).every((e) => e.verified), 'S\'s own next event is verified').toBe(true);
    const mine = await claim(P);
    expect(mine.session, `S's deep_claim still binds to S: ${JSON.stringify(mine.error)}`).toBe(S.id);
    if (impostor) {
      const hello = await impostor.mcpOpen(hub.socket);
      expect(hello.role, 'the impostor\'s deep mcp is not bound to S').not.toBe(`mcp:${S.id}`);
      const theirs = await claim(impostor);
      expect(theirs.session, 'the impostor\'s deep_claim binds to no session').toBeUndefined();
      expect(theirs.error, 'the impostor\'s deep_claim is refused').toBeDefined();
    }
    // Recorded as unverified: still so after a restart.
    await stopHub(hub);
    const again = await startHub({ home });
    expect((await eventOf(again, sent.id)).every((e) => e.verified === false), 'still unverified after a restart').toBe(true);
    await P.stop();
    await impostor?.stop();
  }, 90_000);
});

describe('AC17 #16.7d3e3988 a SessionEnd for B stamped by hand in session A on one Codex daemon is unverified; B\'s deep_claim still binds', () => {
  interface Daemon { A: Session; B: Session; end: { id: string; verified: boolean[] }; claimB: { session?: string; error?: Line }; before: { a: string | undefined; b: string | undefined } }
  /** One Codex daemon D serving A and B: hooks of both come from D's children; one deep mcp, a child of D, serves both. */
  async function daemon(plant?: string): Promise<Daemon> {
    const home = makeHome();
    const hub = await startHub({ home, ...(plant && { plant }) });
    const A = newSession(home, 'codex');
    const B = newSession(home, 'codex');
    const D = Agent.start(home, A.cwd);
    await establish(D, hub.socket, A);
    await establish(D, hub.socket, B);
    await D.mcpOpen(hub.socket);
    // Each deep_* call binds to the PreToolUse D stamped for it: tool mcp__deep__deep_claim, its arguments as tool_input.
    const stampedClaim = async (s: Session) => {
      const args = claimArgs();
      await D.hook(hub.socket, hookRequest(s, 'PreToolUse', { tool_name: 'mcp__deep__deep_claim', tool_input: args }), { cwd: s.cwd });
      return claim(D, args);
    };
    const before = { a: (await stampedClaim(A)).session, b: (await stampedClaim(B)).session };
    // In session A, the agent runs deep-hook by hand: a shell D started for A's tool call runs it, stamping SessionEnd for B.
    const end = hookRequest({ ...B, cwd: A.cwd }, 'SessionEnd');
    await D.hook(hub.socket, end, { via: 'shell', cwd: A.cwd });
    const recorded = await eventOf(hub, end.id);
    const claimB = await stampedClaim(B);
    await D.stop();
    await stopHub(hub);
    return { A, B, end: { id: end.id, verified: recorded.map((e) => e.verified) }, claimB, before };
  }
  function bindingHolds(o: Daemon): void {
    expect(o.before, 'before the hand-run hook, each stamped deep_claim binds to its own session').toEqual({ a: o.A.id, b: o.B.id });
    expect(o.end.verified.length, 'the SessionEnd is recorded').toBeGreaterThan(0);
    expect(o.end.verified.every((v) => v === false), `the SessionEnd ${o.end.id} for B (${o.B.id}) is recorded as unverified`).toBe(true);
    expect(o.claimB.session, `B's deep_claim must still bind to B (${o.B.id}); got ${JSON.stringify(o.claimB)}`).toBe(o.B.id);
  }
  it('AC17 the hand-run SessionEnd for B is unverified, and B\'s deep_claim still binds to B', async () => {
    bindingHolds(await daemon());
  }, 90_000);
  it('AC17 (wrong program) a hub that ends the binding fails, naming B', async () => {
    const o = await daemon('ends-binding');
    expect(() => bindingHolds(o)).toThrow(new RegExp(o.B.id));
  }, 90_000);
});
