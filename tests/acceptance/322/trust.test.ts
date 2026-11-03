// #322 AC1: an untrusted repo's spec commands never run. Specs run only in projects the core's trust decision marks
// trusted (the issue's Scope; design: spec-draft's row, "a repo trusted in neither never runs"), and the decision is
// reused from the agents: a repo trusted in Claude Code's workspace trust needs no second answer.
//
// The repo's spec (`.deepbuild/done.yaml`) names the check `unit`, `node --test tests/unit.test.js`. The control comes
// first: with the project's trust decision recorded as #348 records it (README, Project trust), a stop that did work
// runs the spec's unit check on its claim (a run.started naming `unit` for a claim of the task). Then the same world
// with no trust decision, in neither Claude Code's workspace trust nor Codex's trusted projects: the same stop runs
// no spec command at all (no run of `unit` for any claim of the task, and nothing passes), the repo being
// watch-only. The second test trusts the repo through Claude Code's workspace trust alone (`~/.claude.json`,
// `projects[<repo>].hasTrustDialogAccepted`), and the spec's check runs. A definition is handed for the prompt in
// every world, so the base's claim exists and the difference is the spec's run alone.
import { afterEach, describe, it } from 'vitest';
import {
  AC1, BEHAVIOR, BEHAVIOR_DRAFT, FIX, claimsOf, cleanup, expectTask, lastPos, lockedFor, makeWorld, must, replyText, runOf, runsOf, Session,
  settle, startHub, taskVerdicts, trustRepo, type Ev,
} from './helpers.ts';

afterEach(cleanup, 60_000);

interface Stopped { ref: string; since: number; events: Ev[]; reply: string }

/** One session in a world: the typed change, the lock, the fix that makes the unit test pass, and the stop that claims. */
async function fixedAndStopped(trust: 'decision' | 'claude' | 'none', expectRun: boolean): Promise<Stopped> {
  const w = makeWorld({ drafts: [BEHAVIOR_DRAFT()], claudeTrust: trust === 'claude' });
  if (trust === 'decision') await trustRepo(w, true);
  const hub = await startHub(w);
  const s = new Session(w);
  await s.start();
  await s.typed(BEHAVIOR);
  await s.read('src/auth.js');
  let events = await settle(hub, (all) => { const ref = (() => { try { return expectTask(all, s, BEHAVIOR, AC1); } catch { return undefined; } })(); return ref !== undefined && lockedFor(all, ref).length > 0; });
  const ref = expectTask(events, s, BEHAVIOR, AC1);
  must(lockedFor(events, ref).length > 0, `${AC1} the handed definition of ${ref} must lock before the stop: none was recorded`);
  const since = await lastPos(hub);
  await s.edit(FIX.file, FIX.from, FIX.to);
  const stop = await s.stop('checkToken now rejects a token whose exp has passed.');
  events = await settle(hub, (all) => claimsOf(all, ref, since).length > 0 && (!expectRun || runsOf(all, ref, since).some(runOf('unit'))), expectRun ? 90_000 : 45_000);
  return { ref, since, events, reply: replyText(stop) };
}

/** The spec's unit check ran on a claim of the task after the stop. */
function specRan(t: Stopped, who: string): void {
  const claims = claimsOf(t.events, t.ref, t.since);
  must(claims.length > 0, `${who} the stop after the fix must make a claim for ${t.ref}: no claim.made after it`);
  const runs = runsOf(t.events, t.ref, t.since);
  must(runs.some(runOf('unit')), `${who} the trusted repo's spec check unit (node --test tests/unit.test.js, from .deepbuild/done.yaml) must run on the claim: the claim's runs are ${runs.map((r) => String(r.started.data.check)).join(', ') || 'none'}`);
}

describe(`${AC1} an untrusted repo's spec commands never run`, () => {
  it(`${AC1} with the project trusted by the core's decision the spec's unit check runs on the claim (control); with no trust decision, in neither Claude Code's nor Codex's trust, it never runs and nothing passes`, async () => {
    const trusted = await fixedAndStopped('decision', true);
    specRan(trusted, `${AC1} [trusted]`);

    const untrusted = await fixedAndStopped('none', false);
    const runs = runsOf(untrusted.events, untrusted.ref, untrusted.since);
    must(!runs.some(runOf('unit')), `${AC1} [untrusted] the repo is trusted in neither Claude Code's workspace trust nor Codex's trusted projects and the core holds no decision for it, so its spec command unit must never run; it ran: ${runs.filter(runOf('unit')).map((r) => String(r.started.data.run)).join(', ')}`);
    const passed = taskVerdicts(untrusted.events, untrusted.ref, untrusted.since).filter((v) => v.data.outcome === 'PASS');
    must(!passed.length, `${AC1} [untrusted] an untrusted repo is watch-only, so no claim of ${untrusted.ref} passes: ${passed.map((v) => JSON.stringify(v.data).slice(0, 300)).join('; ')}`);
    must(!/\bPASS\b/.test(untrusted.reply), `${AC1} [untrusted] the stop's reply must not say PASS for a repo whose checks never ran: ${untrusted.reply.slice(0, 400)}`);
  }, 420_000);

  it(`${AC1} a repo trusted in Claude Code's workspace trust alone (~/.claude.json hasTrustDialogAccepted) needs no second answer: the spec's unit check runs on the claim`, async () => {
    const t = await fixedAndStopped('claude', true);
    specRan(t, `${AC1} [claude trust]`);
  }, 240_000);
});
