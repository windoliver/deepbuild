// AC2 #1338.5dc7055b: "A hook on a second machine stays within its declared overhead on a link with 100 ms of delay,
// and a guard's verdict is unchanged with the link cut."
//
// bob's machine joins acme/shop and its agent's hooks run the real deep-hook in his clone, reaching maya's hub over a
// link that holds every chunk 100 ms each way. Each hook's wall time must stay within the hook overhead the network
// route declares in Claude Code's adapter facts, and every one of those hooks must reach the record, so a hook that
// sends nothing can't pass. Then a fail_closed fast rule deep-hook enforces locally (no-kill-by-name, from the shipped
// rules on bob's machine) must decide its planted call and its twin the same with the link up and cut: the planted
// call denied, the twin allowed. The link is restored at the end and a hook must reach the record again.
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import {
  cleanup, decision, hook, joined, judge, killByName, needDeepHook, newSession, p95, recordUntil, shown, SURFACE, world, type Ev, type Hooked,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const RUNS = 3;
const PER_RUN = 10;

/** The network route's declared hook overhead (surface 7), in ms; BLOCKED when the facts declare none. */
function declared(): { overhead: number; failOpen: unknown } {
  const facts = JSON.parse(readFileSync(SURFACE.facts.file, 'utf8')) as Record<string, Record<string, Record<string, unknown>> | undefined>;
  const route = facts[SURFACE.facts.member]?.[SURFACE.facts.route];
  const overhead = route?.[SURFACE.facts.overhead];
  if (typeof overhead !== 'number' || !Number.isFinite(overhead) || overhead <= 0) {
    throw Error(`BLOCKED: ${SURFACE.facts.file} declares no hook overhead for the ${SURFACE.facts.route} route (${SURFACE.facts.member}.${SURFACE.facts.route}.${SURFACE.facts.overhead}, ms): ${JSON.stringify(route)}`);
  }
  return { overhead, failOpen: route?.[SURFACE.facts.failOpen] };
}

describe('AC2 #1338.5dc7055b a second machine\'s hook stays within its declared overhead on a 100 ms link, and a guard\'s verdict holds with the link cut', () => {
  it('AC2 #1338.5dc7055b hooks on bob\'s machine over a 100 ms link: within the network route\'s declared overhead, all recorded; no-kill-by-name decides the same up and cut', async (ctx) => {
    needDeepHook();
    const w = await world();
    const bob = await joined(w, 'bob');
    const limit = declared();
    const s = newSession(bob.home, 'claude-code', bob.clone);
    w.link.delayMs = 100;
    const carried = w.link.carried;

    const start = await hook(bob.home, s, 'SessionStart', {}, bob.path);
    expect(start.code, `bob's SessionStart through deep-hook: ${shown(start)}`).toBe(0);
    const runs: number[] = [];
    const all: Hooked[] = [];
    for (let r = 0; r < RUNS; r++) {
      const times: number[] = [];
      for (let i = 0; i < PER_RUN; i++) {
        const h = await hook(bob.home, s, 'PreToolUse', { tool_input: { command: 'ls' } }, bob.path);
        expect(decision(h), `an allowed call (ls) on bob's machine: ${shown(h)}`).toBe('allow');
        times.push(h.ms);
        all.push(h);
      }
      runs.push(p95(times));
    }
    // Every one of those hooks reaches the project's record, with the link up: one that sent nothing proves no overhead.
    const before = (evs: Ev[]) => evs.filter((e) => e.session === s.id && e.kind === 'tool.before');
    const got = before(await recordUntil(w, (evs) => before(evs).length >= all.length, 60_000));
    expect(got.length, `bob's ${all.length} PreToolUse hooks over the 100 ms link must all reach the record (session ${s.id}); it holds ${got.length}`).toBeGreaterThanOrEqual(all.length);
    expect(w.link.carried, 'the hooks must reach the hub through the network link').toBeGreaterThan(carried);

    // The guard: a fail_closed fast rule, decided with the link up (100 ms) and with it cut.
    const rule = killByName();
    const verdicts = async () => ({
      planted: await hook(bob.home, s, 'PreToolUse', { tool_name: rule.planted.tool_name, tool_input: rule.planted.tool_input }, bob.path),
      twin: await hook(bob.home, s, 'PreToolUse', { tool_name: rule.twin.tool_name, tool_input: rule.twin.tool_input }, bob.path),
    });
    const up = await verdicts();
    w.link.cut();
    const cut = await verdicts();
    console.log(`AC2 link cut: the planted call took ${cut.planted.ms.toFixed(0)} ms, its twin ${cut.twin.ms.toFixed(0)} ms (declared fail-open ${JSON.stringify(limit.failOpen)} ms)`);
    for (const [which, want] of [['planted', 'deny'], ['twin', 'allow']] as const) {
      const call = (which === 'planted' ? rule.planted : rule.twin).tool_input.command as string;
      expect(decision(up[which]), `${rule.name}: ${which} call \`${call}\` with the link up must be ${want === 'deny' ? 'denied' : 'allowed'}: ${shown(up[which])}`).toBe(want);
      expect(decision(cut[which]), `${rule.name}: ${which} call \`${call}\` was ${decision(up[which])} with the link up and is ${decision(cut[which])} with it cut: ${shown(cut[which])}`).toBe(decision(up[which]));
    }

    // Restored, the link carries a new session's hook to the record again.
    w.link.restore();
    w.link.delayMs = 0;
    const s2 = newSession(bob.home, 'claude-code', bob.clone);
    const again = await hook(bob.home, s2, 'SessionStart', {}, bob.path);
    expect(again.code, `a SessionStart once the link is restored: ${shown(again)}`).toBe(0);
    const back = (await recordUntil(w, (evs) => evs.some((e) => e.session === s2.id), 60_000)).filter((e) => e.session === s2.id);
    expect(back.length, `with the link restored, a new session's hook (${s2.id}) must reach the record`).toBeGreaterThan(0);

    // Last, since an unclear reading ends the test INCONCLUSIVE: each run's p95 against the declared overhead.
    judge(ctx, `deep-hook on bob's machine, PreToolUse p95 over a 100 ms link (ms), declared ${SURFACE.facts.member}.${SURFACE.facts.route}.${SURFACE.facts.overhead}`, runs, limit.overhead);
  }, 600_000);
});
