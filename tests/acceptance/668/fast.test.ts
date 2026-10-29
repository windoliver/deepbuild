// #668's fast tests: no Claude Code session and no spend. The checkpoint runs on a temporary home whose Claude Code user
// settings hold one hook of your own, with stand-ins only for what this repo doesn't own (launchd, systemctl, the
// `claude` binary, Claude Code running its settings' hooks): `deep setup` in the checkout-web fixture, a made-up
// session whose hooks go through your user settings into the real deep-hook and hub while its commands run for real
// (the failing test run, the fix, the test run again, the commit), `deep status`, `deep doctor --prompt`, DeepBuild's
// PreToolUse entry removed by hand and `deep doctor` again, the fix it names, `deep off` and `deep on`, and
// `deep setup --undo`. Each criterion's check is the one the live file runs on a real session. The planted status the
// issue's Proof names is run here too: it must fail the AC2 check, naming the criterion and the commit.
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, AC2, AC3, AC4, AC5, AC6, TELEMETRY, afterStopProblems, allEvents, besideProblems, checkout, checkpoint, cleanup, deep, doctorProblems, duringSession,
  failedRunProblems, fastSession, makeHome, sessionBlock, shared, shown, undoProblems, unlisted, waitFor, whileRunningProblems, type Home, type Ran, type Repo,
  type SessionRun,
} from './helpers.ts';

afterAll(cleanup, 120_000);

/** The made-up session, with one `deep status` taken right after its failing first test run reached the record. */
async function made(h: Home, repo: Repo): Promise<SessionRun> {
  const snaps: Ran[] = [];
  const { s, calls, first } = await fastSession(h, repo, async (session, call) => {
    await waitFor(async () => (await allEvents(h)).some((e) => e.kind === 'tool.after' && e.session === session.id && e.data?.call === call.id), 15_000);
    snaps.push(await deep(h, ['status'], { cwd: repo.dir }));
  });
  return { id: s.id, calls, first, transcript: s.transcript, whileRunning: snaps, terminal: [] };
}
const world = shared(() => {
  const h = makeHome({ fast: true });
  return checkpoint('fast', h, checkout(h), made, TELEMETRY);
});

describe(`AC1 ${AC1} After \`deep setup\`, the person's own hook still runs, and DeepBuild's hook entries sit beside it in the user settings, never in the repo's`, () => {
  it(`AC1 ${AC1} after deep setup your own PostToolUse hook runs for every tool call of the session, DeepBuild's entries sit beside it in your user settings, and the repo's settings are untouched`, async () => {
    const w = await world();
    expect(besideProblems({ h: w.h, before: w.settingsBefore.toString('utf8'), repo: w.repoSnaps, settingsAfterSetup: w.settingsAfterSetup, session: w.session.id, calls: w.session.calls }),
      `${AC1} your hook beside DeepBuild's entries, in your user settings only`).toEqual([]);
  }, 900_000);
});

describe(`AC2 ${AC2} While the session runs, \`deep status\` lists it under checkout-web as working; after its stop it lists its tool calls and its commit by SHA, read from the record; a status that misses the session's commit or lists one it didn't make fails this test, naming the commit`, () => {
  it(`AC2 ${AC2} deep status lists the session under checkout-web as working while it runs, and after its stop its tool calls and its commit by SHA, and not your commit made after it`, async () => {
    const w = await world();
    const during = duringSession(w);
    expect(during.length, `${AC2} a deep status must have been taken while the session ran (after its prompt, before its stop, as the record stamps them): ${w.session.whileRunning.map(shown).join('\n')}`).toBeGreaterThan(0);
    expect(during.flatMap((r) => whileRunningProblems(r, w.session.id, w.sessions)), `${AC2} while the session runs`).toEqual([]);
    expect(afterStopProblems({ status: w.statusStopped, session: w.session.id, sessions: w.sessions, calls: w.session.calls, made: w.made, others: w.others, events: w.events }),
      `${AC2} after its stop, read from the record`).toEqual([]);
  }, 900_000);

  it(`AC2 ${AC2} (planted status) a status that lists the tool calls but not the commit fails the same check, naming the criterion and the commit`, async () => {
    const w = await world();
    const block = sessionBlock(w.statusPlanted.stdout, w.session.id, w.sessions);
    expect(block, `${AC2} the planted status (DEEP_HUB_PLANT=status-omits-commit) must still list session ${w.session.id}: ${shown(w.statusPlanted)}`).toBeDefined();
    expect(unlisted(block!.lines, w.session.calls).map((c) => `${c.name} ${c.id}`), `${AC2} the planted status must list the session's tool calls as the merged status does, or it plants nothing: ${shown(w.statusPlanted)}`).toEqual([]);
    const problems = afterStopProblems({ status: w.statusPlanted, session: w.session.id, sessions: w.sessions, calls: w.session.calls, made: w.made, others: w.others, events: w.events });
    for (const c of w.made) {
      expect(problems.some((p) => p.startsWith(AC2) && p.includes(c.sha)), `${AC2} the check must fail on the planted status, naming the criterion and the commit ${c.sha}: ${JSON.stringify(problems)}`).toBe(true);
    }
  }, 900_000);
});

describe(`AC3 ${AC3} The first test run, which fails, is recorded as a failed tool call with its error signature and shows on the session`, () => {
  it(`AC3 ${AC3} the failing \`node --test\` is a failed tool call of the session in the record, with its error signature, and deep status shows it failed on the session`, async () => {
    const w = await world();
    expect(failedRunProblems({ status: w.statusStopped, session: w.session.id, sessions: w.sessions, first: w.session.first, events: w.events }), `${AC3} the failed first test run`).toEqual([]);
  }, 900_000);
});

describe(`AC4 ${AC4} \`deep doctor\` exits 0 with every item OK or "not checked"; with DeepBuild's hook entry removed by hand it names the missing installation with its exact fix and exits non-zero`, () => {
  it(`AC4 ${AC4} after setup and the session, deep doctor --prompt shows every item OK or "not checked" and exits 0; with DeepBuild's PreToolUse entry removed by hand (the hub stopped) it names the missing installation with the fix \`deep setup\` and exits non-zero, and that fix puts the entry back`, async () => {
    const w = await world();
    expect(doctorProblems(w), `${AC4} the doctor after setup, then with DeepBuild's entry removed by hand`).toEqual([]);
  }, 900_000);
});

describe(`AC5 ${AC5} \`deep off\` makes the next hook reply watch-only within a second, and \`deep on\` brings the gates back`, () => {
  it(`AC5 ${AC5} your gate denies \`make release\`; after deep off a hook started within a second is let through, acknowledged by the hub; after deep on it is denied again`, async () => {
    const w = await world();
    if ('error' in w.offOn) throw w.offOn.error;
    expect(w.offOn.problems, `${AC5} deep off and deep on: ${w.offOn.proof}`).toEqual([]);
  }, 900_000);
});

describe(`AC6 ${AC6} \`deep setup --undo\` leaves the Claude Code user settings byte for byte as they were before setup`, () => {
  it(`AC6 ${AC6} after the session, status, doctor, off and on, deep setup --undo leaves your user settings byte for byte as before setup`, async () => {
    const w = await world();
    expect(undoProblems(w.h, w.settingsBefore, w.undo), `${AC6} your user settings after undo`).toEqual([]);
  }, 900_000);
});
