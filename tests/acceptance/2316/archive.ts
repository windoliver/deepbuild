// The archive world for #2316.e3f1d78c: #20's world (a real record, evidence store and asks core in a temp HOME
// under /tmp/dh20-*, with Claude Code's and Codex's transcript folders written as each agent writes them), the real
// archive opened from its public entry over the shipped adapters' facts, and 2,000 transcripts of other sessions laid
// where their agents keep them: Claude Code's `projects/<folder>/<session>.jsonl` across 40 project folders and
// Codex's `sessions/YYYY/MM/DD/rollout-<time>-<thread>.jsonl` across 50 days.

import { performance } from 'node:perf_hooks';
import { claudeTranscript, codexTranscript, DAY, HOUR, numbered, T0, type Env, type Transcript } from '../20/helpers.ts';

export * from '../20/helpers.ts';

/** The hub's wait for the copy on the held-push path (packages/hub/src/holds.ts, ARCHIVE_WAIT_MS). */
export const ARCHIVE_WAIT_MS = 2000;
/** The bound read as "well within" it: a tenth (README, The bound). */
export const BOUND_MS = 200;
export const CLAUDE_FOLDERS = 40;
export const CLAUDE_PER_FOLDER = 25;
export const CODEX_DAYS = 50;
export const CODEX_PER_DAY = 20;

/**
 * 2,000 transcripts of finished sessions beside the one under test: 1,000 of Claude Code, 25 in each of 40 project
 * folders (`/tmp/dh20-work/project-<n>`, none the target's), and 1,000 Codex rollouts, 20 on each of 50 days
 * before the test's day. Each holds a few messages. Their sessions, by agent.
 */
export function siblings(env: Env): { claude: Transcript[]; codex: Transcript[] } {
  const claude: Transcript[] = [];
  const codex: Transcript[] = [];
  for (let f = 0; f < CLAUDE_FOLDERS; f++) {
    for (let s = 0; s < CLAUDE_PER_FOLDER; s++) {
      claude.push(claudeTranscript(env, numbered(1, 4, `project ${f} session ${s}`), { cwd: `/tmp/dh20-work/project-${f}`, at: T0 - (f + 1) * DAY + s * HOUR }));
    }
  }
  for (let d = 0; d < CODEX_DAYS; d++) {
    for (let s = 0; s < CODEX_PER_DAY; s++) {
      codex.push(codexTranscript(env, [`day ${d} rollout ${s}: fix the checkout page`, 'run the tests', 'commit it'], T0 - (d + 1) * DAY + s * 7 * 60_000));
    }
  }
  return { claude, codex };
}

/** How long a call takes, by the wall clock, in ms. */
export async function timed(run: () => Promise<unknown>): Promise<number> {
  const at = performance.now();
  await run();
  return performance.now() - at;
}
export const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};
