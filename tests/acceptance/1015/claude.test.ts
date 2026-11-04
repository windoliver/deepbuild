// #1015 AC1: eight scripted Claude Code sessions in eight worktrees of the sample repo each run `cargo test --workspace`
// through their Bash tool at once, with the hub told 12 cores (so `cpu.slot` is a pool of 6). deep-hook matches the
// shipped entry at PreToolUse and rewrites the call into its `deep lease` form; at most 5 run at once (the pool less
// the slot #907 keeps), the rest wait and then run, each waiter's tool result shows its waiting lines, and the record's
// lease table holds each running command's slot under its session. Real deep-hook, real hub, real `deep lease`; the
// command itself is the stand-in `cargo` (README, How commands are stood in for).
import { describe, expect, it } from 'vitest';
import {
  AC1, CARGO_TEST, claudeCall, inWaves, LIMIT, mustFail, ordinal, overlap, POOL, sampleRepo, Session, shownHook, shownLeases, sleep, slotsOf,
  waitLines, World, type Pre, type Ran, type Running, type Wave,
} from './helpers.ts';

const SESSIONS = 8;

interface Seen { w: World; sessions: Session[]; pres: Pre[]; results: (Ran | undefined)[]; waves: Wave[] }

async function eightSessions(plant?: string): Promise<Seen> {
  const w = new World(plant ? { plant } : {});
  await w.startHub();
  const { worktrees } = sampleRepo(w, SESSIONS);
  const sessions = worktrees.map((wt) => new Session(w, 'claude', wt));
  try {
    await Promise.all(sessions.map((s) => s.begin()));
    const calls = await Promise.all(sessions.map((s) => claudeCall(s, CARGO_TEST)));
    const running: Running[] = calls.flatMap((c, i) => (c.bash ? [{ s: sessions[i]!, bash: c.bash }] : []));
    const waves = await inWaves(w, running);
    const results = await Promise.all(calls.map((c) => Promise.race([c.after, sleep(180_000).then(() => undefined)])));
    // The Proof's reading: each session's command, when it ran, and how it waited.
    const stamps = w.stamps();
    const t0 = Math.min(...stamps.filter((x) => x.kind === 'S').map((x) => x.ms));
    for (const [i, s] of sessions.entries()) {
      const S = stamps.find((x) => x.kind === 'S' && x.label === s.label);
      const E = stamps.find((x) => x.kind === 'E' && x.label === s.label);
      console.log(`AC1 ${plant ?? 'as built'}: ${s.label} (session ${s.id.slice(0, 8)}) ran \`${calls[i]!.pre.decision.updated ?? CARGO_TEST}\`: started +${S ? S.ms - t0 : '-'} ms, ended +${E ? E.ms - t0 : '-'} ms; waiting lines: ${JSON.stringify(waitLines(results[i]?.output ?? ''))}`);
    }
    console.log(`AC1 ${plant ?? 'as built'}: waves ${waves.map((v) => `[${v.running.join(' ')}]`).join(' ')}`);
    return { w, sessions, pres: calls.map((c) => c.pre), results, waves };
  } finally {
    for (const s of sessions) s.stop();
    await w.stopHub();
  }
}

/** A waiting line names what it waits for (the slot) and who holds it: another session, by its ID's first 8 characters or its worktree. */
const namesHolder = (line: string, others: readonly Session[]): boolean => /slot/i.test(line) && others.some((o) => line.includes(o.id.slice(0, 8)) || line.includes(o.label));

function judged({ w, sessions, pres, results, waves }: Seen): void {
  for (const [i, s] of sessions.entries()) {
    expect(pres[i]!.decision.denied, `${s.label}: Claude Code's adapter can rewrite a call, so \`${CARGO_TEST}\` is rewritten, never denied: ${shownHook(pres[i]!.hooked)}`).toBe(false);
  }
  const labels = sessions.map((s) => s.label);
  const { most, past } = overlap(w.stamps(), labels, LIMIT);
  if (past) {
    const s = sessions.find((x) => x.label === past.label)!;
    expect.fail(`the ${ordinal(past.n)} command, \`${CARGO_TEST}\` in ${past.label} (session ${s.id}), started while ${past.beside.length} others ran (${past.beside.join(', ')}): with \`cpu.slot\` a pool of ${POOL}, at most ${LIMIT} leased commands run at once (${most} did)`);
  }
  for (const [i, s] of sessions.entries()) {
    expect(results[i], `${s.label}: the tool result of \`${CARGO_TEST}\` must come back once it ran`).toBeDefined();
    expect(results[i]!.code, `${s.label}: \`${CARGO_TEST}\` waits and then runs to its end: ${JSON.stringify(results[i]!.output.slice(-800))}`).toBe(0);
    expect(w.ended(s.label), `${s.label}: the stand-in cargo ran to its end`).toBeDefined();
  }
  for (const [n, wave] of waves.entries()) {
    for (const label of wave.running) {
      const s = sessions.find((x) => x.label === label)!;
      expect(slotsOf(wave.leases, s).length, `wave ${n + 1}: ${label}'s running command must hold a cpu.slot lease under its session (session:${s.id}); the table held ${shownLeases(wave.leases)}`).toBeGreaterThanOrEqual(1);
    }
  }
  const first = new Set(waves[0]?.running ?? []);
  const waiters = sessions.filter((s) => !first.has(s.label));
  expect(waiters.length, `${SESSIONS} sessions on ${LIMIT} slots: at least ${SESSIONS - LIMIT} waited`).toBeGreaterThanOrEqual(SESSIONS - LIMIT);
  for (const s of waiters) {
    const output = results[sessions.indexOf(s)]?.output ?? '';
    const lines = waitLines(output);
    expect(lines.some((l) => namesHolder(l, sessions.filter((o) => o !== s))), `${s.label}: it waited for a slot, so its tool result must show a waiting line naming the slot and who holds it; it showed ${JSON.stringify(lines)} in ${JSON.stringify(output.slice(0, 1200))}`).toBe(true);
  }
}

describe(`${AC1} eight Claude Code sessions' \`${CARGO_TEST}\` share a cpu.slot pool of ${POOL}: at most ${LIMIT} run at once`, () => {
  it(`${AC1} at most ${LIMIT} of the eight commands run at once, the rest wait and then run, each waiter's tool result shows its waiting lines, and the lease table holds each running command under its session`, async () => {
    judged(await eightSessions());
  }, 1_500_000);
  it(`${AC1} (wrong program) a hook that lets matched commands run as written (DEEP_HUB_PLANT=runs-matched-as-written) fails this test, naming the sixth command`, async () => {
    const seen = await eightSessions('runs-matched-as-written');
    const past = overlap(seen.w.stamps(), seen.sessions.map((s) => s.label), LIMIT).past;
    await mustFail('runs-matched-as-written', () => judged(seen), ['the sixth command', past?.label ?? 'the sixth to start']);
  }, 1_500_000);
});
