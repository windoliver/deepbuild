// #1015 AC3: focused runs match no shipped entry. `npx vitest run src/cart.test.ts` and `cargo test -p cart`, called by
// a Claude Code session, run as written and both at once; then a repo entry in `.deepbuild/done.yaml` naming
// `npx vitest run` makes the first one leased. Real deep-hook, real hub, real `deep lease`; the commands are the
// stand-in `npx` and `cargo`.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC3, asWritten, claudeCall, heldNow, leaseRows, mustFail, rewrittenToLease, sampleRepo, Session, shownHook, shownLeases, sleep, slotsOf, until,
  World, type LeaseRow, type Pre, type Ran,
} from './helpers.ts';

const VITEST = 'npx vitest run src/cart.test.ts';
const CARGO_P = 'cargo test -p cart';
const REPO_ENTRY = 'heavy_commands:\n  - name: vitest run\n    argv_prefix: [npx, vitest, run]\n    kinds: []\n    jobs: none\n';

interface Focused { w: World; s: Session; pres: Pre[]; labels: string[]; results: (Ran | undefined)[]; during: LeaseRow[] }

/** The two focused calls from one session, each run as the hook left it, held until both are seen running. */
async function focusedCalls(w: World, wt: string): Promise<Focused> {
  const s = new Session(w, 'claude', wt);
  await s.begin();
  const labels = ['vitest', 'cargo-p'];
  const calls = await Promise.all([VITEST, CARGO_P].map((cmd, i) => claudeCall(s, cmd, { env: { DH1015_LABEL: labels[i]! } })));
  await until(() => labels.every((l) => w.started(l)) || calls.some((c) => c.bash?.finished()), 90_000);
  await sleep(1000);
  const during = heldNow(await leaseRows(w.hub!));
  for (const l of labels) w.go(l);
  const results = await Promise.all(calls.map((c) => Promise.race([c.after, sleep(120_000).then(() => undefined)])));
  s.stop();
  return { w, s, pres: calls.map((c) => c.pre), labels, results, during };
}
function judgedFocused({ w, s, pres, labels, results, during }: Focused): void {
  for (const [i, cmd] of [VITEST, CARGO_P].entries()) {
    expect(asWritten(pres[i]!.decision, cmd), `\`${cmd}\` is a focused run that matches no shipped entry, so it must run as written; its PreToolUse ${pres[i]!.decision.denied ? 'denied it' : `rewrote it to \`${pres[i]!.decision.updated}\``}: ${shownHook(pres[i]!.hooked)}`).toBe(true);
  }
  const [a, b] = labels.map((l) => ({ S: w.started(l), E: w.ended(l) }));
  expect(a!.S && b!.S, `both focused runs must have started: ${VITEST} ${a!.S ? 'did' : 'did not'}, ${CARGO_P} ${b!.S ? 'did' : 'did not'}`).toBeTruthy();
  expect(a!.S!.ms < (b!.E?.ms ?? Infinity) && b!.S!.ms < (a!.E?.ms ?? Infinity), `\`${VITEST}\` and \`${CARGO_P}\` run at once, each starting before the other ended`).toBe(true);
  expect(slotsOf(during, s), `the focused runs hold no cpu.slot lease while they run: ${shownLeases(during)}`).toEqual([]);
  for (const [i, r] of results.entries()) expect(r?.code, `\`${[VITEST, CARGO_P][i]}\` runs to its end`).toBe(0);
}

describe(`${AC3} focused runs match no shipped entry; a repo entry in done.yaml leases one`, () => {
  it(`${AC3} \`${VITEST}\` and \`${CARGO_P}\` run as written and both at once; with done.yaml naming \`npx vitest run\`, the first one runs leased`, async () => {
    const w = new World();
    await w.startHub();
    try {
      const { worktrees } = sampleRepo(w, 2);
      judgedFocused(await focusedCalls(w, worktrees[0]!));

      // The repo's own entry, in the second worktree's .deepbuild/done.yaml, before its session starts.
      const wt = worktrees[1]!;
      mkdirSync(join(wt, '.deepbuild'), { recursive: true });
      writeFileSync(join(wt, '.deepbuild', 'done.yaml'), REPO_ENTRY);
      const s = new Session(w, 'claude', wt);
      await s.begin();
      const call = await claudeCall(s, VITEST);
      console.log(`AC3 with the repo entry: \`${VITEST}\` → ${call.pre.decision.denied ? `denied: ${call.pre.decision.reason}` : `\`${call.pre.decision.updated ?? VITEST}\``}`);
      expect(rewrittenToLease(call.pre.decision, VITEST), `with done.yaml naming \`npx vitest run\`, \`${VITEST}\` must be rewritten into its \`deep lease\` form: ${shownHook(call.pre.hooked)}`).toBe(true);
      expect(await until(() => Boolean(w.started(s.label)), 120_000), `the leased \`${VITEST}\` runs (a cpu.slot is free): ${JSON.stringify(call.bash?.output())}`).toBe(true);
      const held = heldNow(await leaseRows(w.hub!));
      w.go(s.label);
      expect(slotsOf(held, s).length, `the leased \`${VITEST}\` holds a cpu.slot lease under its session while it runs: ${shownLeases(held)}`).toBeGreaterThanOrEqual(1);
      expect((await Promise.race([call.after, sleep(120_000).then(() => undefined)]))?.code, `the leased \`${VITEST}\` runs to its end`).toBe(0);
      s.stop();
    } finally {
      await w.stopHub();
    }
  }, 900_000);
  it(`${AC3} (wrong program) a matcher that leases every cargo call (DEEP_HUB_PLANT=leases-every-cargo) fails this test, naming the focused call`, async () => {
    const w = new World({ plant: 'leases-every-cargo' });
    await w.startHub();
    try {
      const { worktrees } = sampleRepo(w, 1);
      const seen = await focusedCalls(w, worktrees[0]!);
      await mustFail('leases-every-cargo', () => judgedFocused(seen), [`\`${CARGO_P}\``]);
    } finally {
      await w.stopHub();
    }
  }, 900_000);
});
