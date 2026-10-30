// #332 AC5 and AC6: screens and deploy targets are leased like ports, each worktree gets its own host name, and a
// computer-use step on a screen or window the session doesn't lease is denied.
//
// AC5: the environment names a screen pool, a deploy-target pool and the variable the stack reads its host name
// from (`leases: { SCREEN: { kind: screen, ... }, DEPLOY: { kind: deploy, ... } }`, `host: APP_HOST`, README). Two
// sessions in two worktrees bring their stacks up: each stack gets a screen and a deploy target of its own,
// recorded as leases (lease.acquired@1, resource kinds `screen` and `deploy`) under its session, and a host name of
// its own; one session's down ends its own leases and no other's.
//
// AC6: a computer-use step is the agent's computer-use tool call (`mcp__computer-use__<action>`), as Claude Code asks
// the PreToolUse hook about it before it runs; the hook's reply (hook.reply@2) denies it with exit 2 or a deny
// decision. A screen is named as the tool names a display (`switch_display {display}`), a window by its app
// (`open_application {app}`). Session A leases screen-2; a step on screen-1, on your browser's window, and any step
// of session B, which leases no screen, is denied; A's switch to its own screen-2 is not (the control).
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sessionIn } from './agents.ts';
import {
  cleanup, Client, denies, given, holderIs, home, leaseEvents, makeRepo, mustBeReady, READY, serverUp, startHub, stopHub, waitFor, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** A host name: dot-separated labels of letters, digits and hyphens (RFC 1123). */
const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

describe('AC5 #332.447b1838 screens and deploy targets are leased like ports, and each worktree gets its own host name', () => {
  it('AC5 two sessions in two worktrees each get a screen, a deploy target and a host name of their own, the screens and targets leased to each session, and one session\'s down ends only its own leases', async () => {
    const t = makeRepo({
      up: serverUp(), ports: ['web'], ready: READY, within: 20, host: 'APP_HOST',
      leases: { SCREEN: { kind: 'screen', keys: ['screen-1', 'screen-2'] }, DEPLOY: { kind: 'deploy', keys: ['deploy-a', 'deploy-b'] } },
    });
    const a = t.worktree('wt-a');
    const b = t.worktree('wt-b');
    const hub = await startHub(join(home(), '.deepbuild'));
    const client = await Client.open(hub);
    try {
      const A = await sessionIn(hub, a);
      const B = await sessionIn(hub, b);
      const upA = mustBeReady(await A.agent.env(hub, A.s, 'up'), a);
      const upB = mustBeReady(await B.agent.env(hub, B.s, 'up'), b);
      const envA = await given(upA.ports.web as number, 'worktree A\'s stack');
      const envB = await given(upB.ports.web as number, 'worktree B\'s stack');

      expect(['screen-1', 'screen-2'], `worktree A's stack was given a leased screen in SCREEN (${JSON.stringify(envA)})`).toContain(envA.SCREEN);
      expect(['screen-1', 'screen-2'], `worktree B's stack was given a leased screen in SCREEN (${JSON.stringify(envB)})`).toContain(envB.SCREEN);
      expect(envB.SCREEN, 'the two stacks were given the same screen').not.toBe(envA.SCREEN);
      expect(['deploy-a', 'deploy-b'], `worktree A's stack was given a leased deploy target in DEPLOY (${JSON.stringify(envA)})`).toContain(envA.DEPLOY);
      expect(['deploy-a', 'deploy-b'], `worktree B's stack was given a leased deploy target in DEPLOY (${JSON.stringify(envB)})`).toContain(envB.DEPLOY);
      expect(envB.DEPLOY, 'the two stacks were given the same deploy target').not.toBe(envA.DEPLOY);

      expect(typeof envA.APP_HOST === 'string' && HOSTNAME.test(envA.APP_HOST), `worktree A's stack was given a host name in APP_HOST (${JSON.stringify(envA.APP_HOST)})`).toBe(true);
      expect(typeof envB.APP_HOST === 'string' && HOSTNAME.test(envB.APP_HOST), `worktree B's stack was given a host name in APP_HOST (${JSON.stringify(envB.APP_HOST)})`).toBe(true);
      expect(envB.APP_HOST, 'the two worktrees were given the same host name').not.toBe(envA.APP_HOST);
      for (const name of [envA.APP_HOST, envB.APP_HOST]) expect(['localhost', '127.0.0.1', '::1'], `${String(name)} is a worktree's own name, not the machine's loopback`).not.toContain(name);

      const events = await client.events();
      const leased = (kind: string, key: string): Line | undefined => leaseEvents(events, 'lease.acquired', kind, key)[0];
      for (const [kind, env, s] of [['screen', envA.SCREEN, A.s], ['screen', envB.SCREEN, B.s], ['deploy', envA.DEPLOY, A.s], ['deploy', envB.DEPLOY, B.s]] as const) {
        const lease = leased(kind, env as string);
        expect(lease, `the record holds the lease on ${kind} ${String(env)} (lease.acquired, resource kind ${kind})`).toBeDefined();
        expect(holderIs(lease!.data.holder, s.id), `the lease on ${kind} ${String(env)} is its session's (${s.id}); holder ${JSON.stringify(lease!.data.holder)}`).toBe(true);
      }

      const downA = await A.agent.env(hub, A.s, 'down');
      expect(downA.code, `session A's deep env down exits 0 (${downA.stdout} ${downA.stderr})`).toBe(0);
      await waitFor(async () => {
        const now = await client.events();
        return leaseEvents(now, 'lease.released', 'screen', envA.SCREEN as string).length > 0 && leaseEvents(now, 'lease.released', 'deploy', envA.DEPLOY as string).length > 0;
      }, 15_000, `the leases on ${String(envA.SCREEN)} and ${String(envA.DEPLOY)} to end after A's down`);
      const after = await client.events();
      expect(leaseEvents(after, 'lease.released', 'screen', envB.SCREEN as string).map((e) => e.data), `B's screen ${String(envB.SCREEN)} is still leased`).toEqual([]);
      expect(leaseEvents(after, 'lease.released', 'deploy', envB.DEPLOY as string).map((e) => e.data), `B's deploy target ${String(envB.DEPLOY)} is still leased`).toEqual([]);
    } finally {
      client.close();
      await stopHub(hub);
    }
  }, 240_000);
});

describe('AC6 #332.346b8a56 a computer-use step on a screen or window the session doesn\'t lease is denied, so your own browser is never touched', () => {
  it('AC6 session A, leasing screen-2, is denied a step on screen-1 and on your browser\'s window; session B, leasing no screen, is denied any step; A\'s step on screen-2 is not denied', async () => {
    const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20, leases: { SCREEN: { kind: 'screen', keys: ['screen-2'] } } });
    const a = t.worktree('wt-a');
    const b = t.worktree('wt-b');
    const hub = await startHub(join(home(), '.deepbuild'));
    const client = await Client.open(hub);
    try {
      const A = await sessionIn(hub, a);
      const B = await sessionIn(hub, b);
      const upA = mustBeReady(await A.agent.env(hub, A.s, 'up'), a);

      const step = async (who: typeof A, tool: string, input: Line) => {
        const r = await who.agent.preToolUse(hub, who.s, `mcp__computer-use__${tool}`, input);
        expect(r.reply, `the hub replied to the PreToolUse for ${tool} (${JSON.stringify(r.lines)})`).toBeDefined();
        return r.reply;
      };
      const toScreen1 = await step(A, 'switch_display', { display: 'screen-1' });
      expect(denies(toScreen1), `session A's step onto screen-1, which it doesn't lease, is denied (reply ${JSON.stringify(toScreen1)})`).toBe(true);
      const browser = await step(A, 'open_application', { app: 'Google Chrome' });
      expect(denies(browser), `session A's step onto your browser's window, which it doesn't lease, is denied (reply ${JSON.stringify(browser)})`).toBe(true);
      const shot = await step(B, 'screenshot', {});
      expect(denies(shot), `session B, which leases no screen, is denied a screenshot of the screen it's on (reply ${JSON.stringify(shot)})`).toBe(true);
      const click = await step(B, 'left_click', { coordinate: [200, 200] });
      expect(denies(click), `session B, which leases no screen, is denied a click (reply ${JSON.stringify(click)})`).toBe(true);

      // The control, once A's lease on screen-2 is shown.
      expect((await given(upA.ports.web as number, 'session A\'s stack')).SCREEN, 'session A leases screen-2').toBe('screen-2');
      const own = await step(A, 'switch_display', { display: 'screen-2' });
      expect(denies(own), `session A's step onto screen-2, which it leases, is not denied (reply ${JSON.stringify(own)})`).toBe(false);
    } finally {
      client.close();
      await stopHub(hub);
    }
  }, 240_000);
});
