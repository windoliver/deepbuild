// #2883's regression test for #1345 and #1458: in the list, each open taste call's row draws when its recommended
// answer applies, in a slot a person can see. Since #1620 the replica's tree keeps a slot drawn with no width, so
// #1345's AC8 reads the time's words from the list's `ask:<id>:time` node even when the row draws it 0 wide; this test
// reads the slot's width as well. Run by hand on a Mac (the app draws headless only on macOS), from the repo root:
//   npx vitest run --root tests/proof/1345 --no-file-parallelism
// It has no tsconfig of its own: one under tests/ that no test names makes affected.mjs select every test there.
// Its world is #1345's Proof fixture, built by that suite's helpers: five issues whose reversible changes land with
// their taste calls open, then the app drawn over a copy of the record on your next visit.
import { expect, test } from 'vitest';
import { draw, FIRST, flat, lists, MIN, openCallsOf, waitUntil, World } from '../../acceptance/1345/helpers.ts';

const ISSUES = [100, 101, 102, 103, 104];

test('each open taste call\'s list row draws when its recommended answer applies, in a slot with width', async () => {
  const w = await World.open({ issues: ISSUES.map(() => ({})), atOnce: 'five', visits: true, clock: true });
  await w.startRun();
  const all = await waitUntil(async () => { const events = await w.events(); return ISSUES.every((n) => w.merged(n) && openCallsOf(events, n).length > 0); }, FIRST + 45 * MIN, 5000);
  expect(all, 'each of the five changes lands with its taste call open').toBe(true);
  const events = await w.events();
  const calls = ISSUES.map((n) => openCallsOf(events, n)[0]!);
  await w.toNextVisit();
  const shown = await waitUntil(async () => { const now = await w.events(); return calls.every((c) => now.some((e) => lists(e, c.handle))); }, 5 * MIN, 2000);
  expect(shown, 'your next visit shows the five calls').toBe(true);
  const { seen } = await draw(w, { open: `ask/${calls[0]!.id}` });
  const nodes = flat(seen.tree);

  const failures = calls.flatMap((c) => {
    const row = nodes.find((x) => x.id === c.handle);
    if (!row) return [`the list has no row ${c.handle} (#${c.issue})`];
    const time = nodes.find((x) => x.id === `${c.handle}:time`);
    const said = time?.name?.replace(/\s+/g, ' ').trim();
    if (!time || !said) return [`${c.handle} (#${c.issue}): its row has no time slot saying when its recommended answer applies`];
    const width = time.bounds[2] ?? 0;
    return width > 0 ? [] : [`${c.handle} (#${c.issue}): its row draws its time "${said}" 0 wide in a ${row.bounds[2]}-wide row, so no one sees it`];
  });
  expect(failures).toEqual([]);
}, 150 * MIN);
