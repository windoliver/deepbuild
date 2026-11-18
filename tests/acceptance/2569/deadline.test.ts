// #2569.aedf09ed: an arm whose window gets no frame for a stated time prints INCONCLUSIVE with the reason and exits; it
// never waits without a deadline. The bench is #1477's `lists_1477`, built in release as #1477's tests build it. Its
// `arm blank` opens its real window; 3 s after the window is on screen, past its warm-up frames, cover.swift puts an
// opaque window over it, as the issue's runs had ("the bench's windows were covered"), and macOS stops giving it
// frames. The arm then has the stated 10 s, and 10 s more, to print its INCONCLUSIVE line and exit. The merge base
// waits in the app's run loop for good, so this test stops it by its PID and fails. Off macOS it fails with a message
// starting `INCONCLUSIVE:`.
import { describe, expect, it } from 'vitest';
import {
  AC1, COVER_AFTER_S, Child, REPO, STALL_S, STALL_SLACK_S, compileCover, inconclusive, isObject, useBench, useDir,
  type JsonValue,
} from './helpers.ts';

const bench = useBench();
const dir = useDir();

/** A line of JSON from one of this test's children, or null. */
function parsed(line: string | undefined): JsonValue | null {
  if (line === undefined) return null;
  try { return JSON.parse(line) as JsonValue; } catch { return null; }
}

describe(`${AC1} an arm whose window gets no frame for a stated time prints INCONCLUSIVE with the reason and exits; it never waits without a deadline`, () => {
  it(`${AC1} \`arm blank\`, its real window covered ${COVER_AFTER_S} s after it opens so it gets no more frames: one INCONCLUSIVE line whose reason says no frame for ${STALL_S} s, and exit 0, within ${STALL_S + STALL_SLACK_S} s of the cover`, async () => {
    const bin = bench();
    const coverBin = compileCover(dir());
    const arm = new Child(bin, ['arm', 'blank'], { cwd: REPO });
    // The cover holds for longer than the arm may take, and goes when this test closes its stdin or dies.
    const cover = new Child(coverBin, [String(arm.pid), String(COVER_AFTER_S), String(STALL_S + STALL_SLACK_S + 30)], { cwd: REPO, stdin: 'pipe' });
    const said = (): string => `stdout ${JSON.stringify(arm.lines.join('\n').slice(0, 1500))}, exit ${JSON.stringify(arm.exit)}, stderr ${JSON.stringify(arm.stderr.slice(-1500))}`;
    try {
      // The window on screen: the bench has started and opened it.
      await cover.until(() => cover.lines.length >= 1 || cover.exit !== null, 90_000);
      const first = parsed(cover.lines[0]);
      if (!isObject(first) || !Array.isArray(first['window'])) inconclusive(`\`${bin} arm blank\` put no window on screen for the cover to find (the cover said ${JSON.stringify(cover.lines)}, ${cover.stderr.slice(-600)}); the arm: ${said()}`);
      // The cover over it.
      await cover.until(() => cover.lines.length >= 2 || cover.exit !== null, (COVER_AFTER_S + 30) * 1000);
      const second = parsed(cover.lines[1]);
      if (!isObject(second) || second['covered'] !== true) inconclusive(`the window was not covered (the cover said ${JSON.stringify(cover.lines)}, ${cover.stderr.slice(-600)}); the arm: ${said()}`);
      const covered = performance.now();
      if (arm.exit) inconclusive(`the arm ended before its window was covered, so no frame was kept from it: ${said()}`);

      // The stated time, and no wait without a deadline.
      const ended = await arm.until(() => arm.exit !== null, (STALL_S + STALL_SLACK_S) * 1000);
      expect(ended, `\`lists_1477 arm blank\` exits within ${STALL_S + STALL_SLACK_S} s of its window being covered (the stated ${STALL_S} s with no frame, and ${STALL_SLACK_S} s more); it is still waiting, with no deadline: ${said()}`).toBe(true);
      const took = (arm.exit!.at - covered) / 1000;
      await arm.until(() => arm.lines.length >= 1, 2000);

      expect(arm.lines, `the arm prints one JSON line: ${said()}`).toHaveLength(1);
      const line = parsed(arm.lines[0]);
      if (!isObject(line)) return expect.fail(`the arm prints one JSON object: ${said()}`);
      // A covered window that still got its frames is one this test can't judge, never a pass.
      if (line['status'] === 'measured' || line['status'] === 'missed') inconclusive(`the cover kept no frame from the window: the arm read ${JSON.stringify(line['status'])} with ${JSON.stringify(line['frames'])} frames, ${took.toFixed(1)} s after the cover`);
      expect(line['status'], `the arm prints INCONCLUSIVE: ${said()}`).toBe('INCONCLUSIVE');
      expect(line['arm'], `the line names its arm: ${said()}`).toBe('blank');
      expect(typeof line['reason'] === 'string' ? line['reason'] : '', `with the reason, which starts \`the real window got no frame for ${STALL_S} s\`: ${said()}`).toMatch(new RegExp(`^the real window got no frame for ${STALL_S} s\\b`));
      expect([arm.exit!.code, arm.exit!.signal], `and exits 0: ${said()}`).toEqual([0, null]);
      console.log(`arm blank, covered ${COVER_AFTER_S} s after its window opened: ${arm.lines[0]} (exit 0, ${took.toFixed(1)} s after the cover)`);
    } finally {
      cover.child.stdin?.end();
      await cover.stop();
      await arm.stop();
    }
  }, 600_000);
});
