// #1725.8867fb84: "`deep_show` with a contact sheet of the six named views (front, back, left, right, top and three-quarter), on
// the red-box fixture of #1719, returns one snapshot per view, each with its own `visible` table, from one call. On the merge
// base the field is refused at `/params/arguments`."
//
// The Claude Code session draws the red-box fixture on its document, then asks one deep_show for a contact sheet of the six
// named views of it (`sheet: {views}`, README: Assumed surfaces), with no document, as a render-back of its current revision.
// The one reply holds six snapshots by hash, one per view, each naming its view and carrying the visible table of its own
// frame: the red box is in every one, and since it sits off the slab's centre no two views see it alike, so no two tables match.
import { afterEach, expect, test } from 'vitest';
import { AC, BOX, CLAUDE, DOC, HEX64, TEST_MS, VIEWS, brief, call, cleanup, draw, isObject, openWorld, redBox, taken } from './helpers.ts';

afterEach(cleanup, 60_000);

test(`${AC.sheet} one deep_show of a contact sheet of the six named views returns one snapshot per view, each with its own visible table`, async () => {
  const w = await openWorld();
  await draw(w, CLAUDE, DOC.a, redBox());
  const reply = taken(await call(w, CLAUDE, 'deep_show', { doc: DOC.a, sheet: { views: [...VIEWS] }, include: ['issues', 'pixels'] }), `deep_show with a contact sheet of the six named views (sheet) on ${DOC.a}`);
  expect(reply['outcome'], `the contact sheet is presented: ${brief(reply)}`).toBe('presented');

  const shots = Array.isArray(reply['snapshots']) ? reply['snapshots'].filter(isObject) : [];
  expect(shots.map((s) => s['view']).sort(), `one snapshot per named view, from the one call: ${brief(shots, 2000)}`).toEqual([...VIEWS].sort());
  for (const shot of shots) {
    expect(String(shot['sha256']), `the ${String(shot['view'])} view's snapshot is named by its SHA-256`).toMatch(HEX64);
    const visible = Array.isArray(shot['visible']) ? shot['visible'].filter(isObject) : undefined;
    expect(visible, `the ${String(shot['view'])} view's snapshot carries its own visible table: ${brief(shot)}`).toBeDefined();
    expect(visible!.map((r) => r['id']), `the ${String(shot['view'])} view sees the red box`).toContain(BOX);
  }
  expect(new Set(shots.map((s) => s['sha256'])).size, 'six views, six pictures').toBe(VIEWS.length);
  const tables = shots.map((s) => JSON.stringify(s['visible']));
  const same = shots.flatMap((a, i) => shots.slice(i + 1).filter((_, k) => tables[i] === tables[i + 1 + k]).map((b) => `${String(a['view'])} and ${String(b['view'])}`));
  expect(same, 'each view\'s visible table is its own frame\'s: no two views share one').toEqual([]);
}, TEST_MS);
