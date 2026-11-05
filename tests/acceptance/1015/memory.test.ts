// #1015 AC5: with the system's memory pressure held critical, a matched command waits, its line naming memory, and
// starts within 5 s of the pressure easing; nothing is killed. The pressure is the test seam's (README, Surfaces:
// DEEP_TEST_MEMORY_PRESSURE_FILE), which stands for macOS's memory-pressure level here: a real allocator would press
// every other session on this shared machine. A Claude Code session's `cargo test --workspace`, rewritten into its
// `deep lease` form; the stand-in cargo; a bystander process the test started.
import { describe, expect, it, type TestContext } from 'vitest';
import { AC5, bystander, CARGO_TEST, claudeCall, loaded, mustFail, running, sampleRepo, Session, shownHook, sleep, until, waitLines, World, type Pre, type Ran } from './helpers.ts';

const EASED_WITHIN_MS = 5000;

interface Seen { pre: Pre; calledAt: number; startedAt?: number; easedAt: number; lines: string[]; result?: Ran; bystanderAlive: boolean; label: string }

async function underPressure(plant?: string): Promise<Seen> {
  const w = new World({ pressure: 'critical', ...(plant ? { plant } : {}) });
  await w.startHub();
  const other = bystander();
  const { worktrees } = sampleRepo(w, 1);
  const s = new Session(w, 'claude', worktrees[0]!);
  try {
    await s.begin();
    const calledAt = Date.now();
    const call = await claudeCall(s, CARGO_TEST);
    const output = () => call.bash?.output() ?? '';
    await until(() => waitLines(output()).some((l) => /memory/i.test(l)) || Boolean(w.started(s.label)) || Boolean(call.bash?.finished()), 90_000);
    await sleep(3000);
    const easedAt = Date.now();
    w.setPressure('normal');
    await until(() => Boolean(w.started(s.label)) || Boolean(call.bash?.finished()), 60_000, 50);
    w.go(s.label);
    const result = await Promise.race([call.after, sleep(120_000).then(() => undefined)]);
    const startedAt = w.started(s.label)?.ms;
    const seen: Seen = { pre: call.pre, calledAt, easedAt, lines: waitLines(result?.output ?? output()), bystanderAlive: running(other), label: s.label, ...(startedAt ? { startedAt } : {}), ...(result ? { result } : {}) };
    // The Proof's reading: the memory-pressure wait.
    console.log(`AC5 ${plant ?? 'as built'}: \`${call.pre.decision.updated ?? CARGO_TEST}\` called at 0, pressure eased at +${easedAt - calledAt} ms, started ${startedAt ? `+${startedAt - calledAt} ms (${startedAt - easedAt} ms after easing)` : 'never'}; waiting lines ${JSON.stringify(seen.lines)}; bystander alive: ${seen.bystanderAlive}`);
    return seen;
  } finally {
    s.stop();
    await w.stopHub();
  }
}

function judged(x: Seen, ctx?: TestContext): void {
  expect(x.pre.decision.denied, `\`${CARGO_TEST}\` is matched and rewritten, never denied: ${shownHook(x.pre.hooked)}`).toBe(false);
  expect(x.startedAt === undefined || x.startedAt >= x.easedAt, `with memory pressure held critical, \`${CARGO_TEST}\` must wait for it to ease; it started ${(x.startedAt ?? 0) - x.calledAt} ms after its call, while the pressure was critical`).toBe(true);
  expect(x.lines.some((l) => /memory/i.test(l)), `while it waits, its line names memory: ${JSON.stringify(x.lines)}`).toBe(true);
  expect(x.bystanderAlive, 'nothing is killed: the process beside it still runs').toBe(true);
  expect(x.startedAt, `once the pressure eased, \`${CARGO_TEST}\` must start; it hadn't within 60 s`).toBeDefined();
  expect(x.result?.code, `\`${CARGO_TEST}\` is never stopped: it runs to its end`).toBe(0);
  const after = x.startedAt! - x.easedAt;
  if (after > EASED_WITHIN_MS) {
    const why = loaded();
    if (why && ctx) ctx.skip(`INCONCLUSIVE (reading only: ${why}): started ${after} ms after the pressure eased, against ${EASED_WITHIN_MS}`);
    expect.fail(`\`${CARGO_TEST}\` must start within ${EASED_WITHIN_MS} ms of the pressure easing; it started ${after} ms after`);
  }
}

describe(`${AC5} a matched command waits while memory pressure is critical and starts once it eases`, () => {
  it(`${AC5} under critical pressure \`${CARGO_TEST}\` waits, its line naming memory, starts within 5 s of the pressure easing, and nothing is killed`, async (ctx) => {
    judged(await underPressure(), ctx);
  }, 600_000);
  it(`${AC5} (wrong program) a lease that ignores memory pressure (DEEP_HUB_PLANT=ignores-memory-pressure) starts the command at once and fails this test`, async () => {
    const seen = await underPressure('ignores-memory-pressure');
    await mustFail('ignores-memory-pressure', () => judged(seen), ['memory pressure held critical']);
  }, 600_000);
});
