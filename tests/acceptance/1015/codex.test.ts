// #1015 AC2: AC1's run in eight scripted Codex sessions, whose adapter can't rewrite a call. Each session's
// `cargo test --workspace` is denied once, the deny giving its `deep lease` form; the session's next call is that form,
// which runs leased with no second deny. As in AC1 (the same run), at most 5 run at once and each running command's
// slot is held under its session. Real deep-hook (`deep-hook codex <event>`), real hub, real `deep lease`; the command
// itself is the stand-in `cargo`.
import { describe, expect, it } from 'vitest';
import {
  AC2, CARGO_TEST, inWaves, leasedForm, LIMIT, mustFail, ordinal, overlap, sampleRepo, Session, shownHook, shownLeases, sleep, slotsOf,
  World, type Pre, type Ran, type Running, type Wave,
} from './helpers.ts';

const SESSIONS = 8;

interface Trail { s: Session; first: Pre; form?: string; retry?: Pre; result?: Ran }
interface Seen { w: World; trails: Trail[]; waves: Wave[] }

async function codexRun(plant?: string): Promise<Seen> {
  const w = new World(plant ? { plant } : {});
  await w.startHub();
  const { worktrees } = sampleRepo(w, SESSIONS);
  const sessions = worktrees.map((wt) => new Session(w, 'codex', wt));
  try {
    await Promise.all(sessions.map((s) => s.begin()));
    // The agent's call, denied; then, as Codex's model does, the command the deny gives, as the next call.
    const trails: Trail[] = await Promise.all(sessions.map(async (s): Promise<Trail> => {
      const first = await s.pre(CARGO_TEST);
      const form = first.decision.denied ? leasedForm(first.decision.reason) : undefined;
      if (!form) return { s, first };
      return { s, first, form, retry: await s.pre(form) };
    }));
    const running: Running[] = [];
    const ends: Promise<void>[] = [];
    for (const t of trails) {
      if (!t.retry || t.retry.decision.denied) continue;
      const bash = t.s.run(t.form!);
      running.push({ s: t.s, bash });
      ends.push(bash.done.then(async (ran) => { t.result = ran; await t.s.post(t.retry!, t.form!, ran); }));
    }
    const waves = await inWaves(w, running);
    await Promise.race([Promise.all(ends), sleep(180_000)]);
    // The Proof's reading: the deny-once trail.
    for (const t of trails) {
      console.log(`AC2 ${plant ?? 'as built'}: ${t.s.label} ${t.first.id} \`${CARGO_TEST}\` ${t.first.decision.denied ? `denied: ${JSON.stringify(t.first.decision.reason.slice(0, 300))}` : 'not denied'}; ${t.retry ? `${t.retry.id} \`${t.form}\` ${t.retry.decision.denied ? `denied again: ${JSON.stringify(t.retry.decision.reason.slice(0, 200))}` : 'allowed'}` : 'no retry'}; ran: ${t.result ? `exit ${t.result.code}` : 'no'}`);
    }
    return { w, trails, waves };
  } finally {
    for (const s of sessions) s.stop();
    await w.stopHub();
  }
}

function judged({ w, trails, waves }: Seen): void {
  for (const t of trails) {
    expect(t.first.decision.denied, `${t.s.label}: Codex's adapter can't rewrite, so the matched call ${t.first.id} \`${CARGO_TEST}\` must be denied once with its \`deep lease\` form: ${shownHook(t.first.hooked)}`).toBe(true);
    expect(t.form, `${t.s.label}: the deny of ${t.first.id} must give the \`deep lease\` form to run instead, in backticks: ${JSON.stringify(t.first.decision.reason)}`).toBeDefined();
    expect(t.form, `${t.s.label}: the \`deep lease\` form runs the command the agent asked for`).toContain(CARGO_TEST);
    expect(t.retry!.decision.denied, `the retried call ${t.retry!.id} \`${t.form}\` in ${t.s.label} must run leased with no second deny; it was denied again: ${JSON.stringify(t.retry!.decision.reason)}`).toBe(false);
  }
  const labels = trails.map((t) => t.s.label);
  const { past } = overlap(w.stamps(), labels, LIMIT);
  if (past) expect.fail(`the ${ordinal(past.n)} command, \`${CARGO_TEST}\` in ${past.label}, started while ${past.beside.length} others ran (${past.beside.join(', ')}): at most ${LIMIT} leased commands run at once`);
  for (const t of trails) expect(t.result?.code, `${t.s.label}: the leased \`${CARGO_TEST}\` waits and then runs to its end: ${JSON.stringify(t.result?.output.slice(-800))}`).toBe(0);
  for (const [n, wave] of waves.entries()) {
    for (const label of wave.running) {
      const t = trails.find((x) => x.s.label === label)!;
      expect(slotsOf(wave.leases, t.s).length, `wave ${n + 1}: ${label}'s running command must hold a cpu.slot lease under its session (session:${t.s.id}); the table held ${shownLeases(wave.leases)}`).toBeGreaterThanOrEqual(1);
    }
  }
}

describe(`${AC2} in Codex sessions each matched call is denied once with its \`deep lease\` form, and the next call runs leased`, () => {
  it(`${AC2} eight Codex sessions' \`${CARGO_TEST}\`: each denied once with its \`deep lease\` form, the retry allowed and run leased, at most ${LIMIT} at once`, async () => {
    judged(await codexRun());
  }, 1_500_000);
  it(`${AC2} (wrong program) a hook that denies every retry (DEEP_HUB_PLANT=denies-every-retry) fails this test, naming the call`, async () => {
    const seen = await codexRun('denies-every-retry');
    const retried = seen.trails[0]?.retry;
    expect(retried, 'the planted hook still denies the first call once with its `deep lease` form, so the session retries').toBeDefined();
    await mustFail('denies-every-retry', () => judged(seen), [retried!.id, 'denied again']);
  }, 1_500_000);
});
