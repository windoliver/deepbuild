// Criterion 3: the same run twice on a virtual clock gives the same snapshots and the same screenshot hashes. The run
// drives the fixture panel, whose counter redraws every 4 ms of the replica's clock and whose field shows a caret, and
// takes a snapshot and a screenshot at five points: after launch, after typing, after 1.5 s of the replica's clock,
// after scrolling and after saving. Each screenshot's file must hash to the sha256 its reply gives. The wrong program is
// the same run on the real clock, twice: the counter then lands on different values and the judge names a difference.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Drive, FLICKS_PER_SECOND, ID, PANEL, cleanup, launch, must, requireMacos, sha256, type Obj } from './helpers.ts';

afterEach(cleanup, 60_000);

interface Seen { snapshots: { at: string; snapshot: Obj; sha256: string }[]; shots: { at: string; sha256: string }[] }

async function runOnce(clock: 'virtual' | 'real'): Promise<Seen> {
  const drive = await Drive.start();
  const replica = await launch(drive, { from: 'fixture', panel: PANEL.form, clock });
  const seen: Seen = { snapshots: [], shots: [] };
  const look = async (at: string) => {
    const s = await must(drive, { call: 'see', replica, see: { scope: 'window', include: ['roles', 'names', 'values', 'bounds', 'items'] } });
    expect(s.sha256, 'a snapshot answers its sha256').toMatch(/^[0-9a-f]{64}$/);
    seen.snapshots.push({ at, snapshot: s.snapshot, sha256: s.sha256 });
    const shot = await must(drive, { call: 'screenshot', replica, screenshot: { target: 'window' } });
    expect(sha256(readFileSync(shot.path as string)), `the ${at} screenshot's file hashes to its sha256`).toBe(shot.sha256);
    seen.shots.push({ at, sha256: shot.sha256 });
    return s.t as number;
  };
  await look('launch');
  await must(drive, { call: 'act', replica, locator: { label: 'Email' }, act: { kind: 'click' } });
  await must(drive, { call: 'act', replica, locator: { label: 'Email' }, act: { kind: 'type', text: 'ada@example.com' } });
  const t = await look('typed');
  await must(drive, { call: 'wait_for', replica, wait_for: { t: t + 1.5 * FLICKS_PER_SECOND } });
  await look('1.5 s later');
  await must(drive, { call: 'act', replica, locator: { text: 'Email' }, act: { kind: 'scroll', dx: 0, dy: 200 } });
  await must(drive, { call: 'wait_for', replica, wait_for: { state: 'settled' } });
  await look('scrolled');
  await must(drive, { call: 'act', replica, locator: { role: 'button', name: 'Save' }, act: { kind: 'click' } });
  await look('saved');
  await must(drive, { call: 'close', replica });
  await drive.stop();
  return seen;
}

/** Every difference between two runs' snapshots and screenshot hashes, by the point they were taken at. */
function repeatProblems(a: Seen, b: Seen): string[] {
  const problems: string[] = [];
  if (a.snapshots.length !== b.snapshots.length || a.shots.length !== b.shots.length) problems.push(`the runs took ${a.snapshots.length}/${a.shots.length} and ${b.snapshots.length}/${b.shots.length} snapshots/screenshots`);
  a.snapshots.forEach((s, i) => {
    const o = b.snapshots[i];
    if (!o) return;
    if (JSON.stringify(s.snapshot) !== JSON.stringify(o.snapshot)) problems.push(`the snapshot ${s.at} differs between the runs`);
    if (s.sha256 !== o.sha256) problems.push(`the snapshot ${s.at} hashes to ${s.sha256} and ${o.sha256}`);
  });
  a.shots.forEach((s, i) => { if (b.shots[i] && s.sha256 !== b.shots[i]!.sha256) problems.push(`the screenshot ${s.at} hashes to ${s.sha256} and ${b.shots[i]!.sha256}`); });
  return problems;
}

describe(`${ID.repeat} the same run twice on a virtual clock gives the same snapshots and the same screenshot hashes`, () => {
  it(`${ID.repeat} two replicas on the virtual clock, one run each: every snapshot and every screenshot hash equal`, async () => {
    requireMacos();
    const first = await runOnce('virtual');
    const second = await runOnce('virtual');
    expect(first.snapshots.every((s) => JSON.stringify(s.snapshot).includes('"button"')), 'the snapshots hold the panel\'s nodes').toBe(true);
    expect(new Set(first.shots.map((s) => s.sha256)).size, 'the run changed what was on screen between its screenshots').toBeGreaterThan(1);
    expect(repeatProblems(first, second)).toEqual([]);
  }, 900_000);

  it(`${ID.repeat} the same run on the real clock, twice, is not repeatable, and the judge names where`, async () => {
    requireMacos();
    const problems = repeatProblems(await runOnce('real'), await runOnce('real'));
    expect(problems.length, 'a clock the run doesn\'t control gives different frames').toBeGreaterThan(0);
  }, 900_000);

});

describe('criterion 3\'s judge (no replica; it passes at the base)', () => {
  it('names a snapshot or a screenshot that differs, and passes two equal runs', () => {
    const run = (shot: string, value: string): Seen => ({
      snapshots: [{ at: 'typed', snapshot: { tree: { role: 'window', name: null, value: null, bounds: [0, 0, 1, 1], children: [{ role: 'text_input', name: null, value, bounds: [0, 0, 1, 1], children: [] }] } }, sha256: sha256(value) }],
      shots: [{ at: 'typed', sha256: shot }],
    });
    expect(repeatProblems(run('a'.repeat(64), 'x'), run('a'.repeat(64), 'x'))).toEqual([]);
    expect(repeatProblems(run('a'.repeat(64), 'x'), run('b'.repeat(64), 'x')).join('\n')).toMatch(/screenshot typed hashes/);
    expect(repeatProblems(run('a'.repeat(64), 'x'), run('a'.repeat(64), 'y')).join('\n')).toMatch(/snapshot typed differs/);
  });
});
