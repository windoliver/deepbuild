// #1725.cdf8a813: "`deep_show` with `mode: bounds` on that document answers with a `display_only` snapshot and its numbers. On
// the merge base it is refused `unlisted_field` at `/params/arguments/mode`."
//
// "That document" is criterion 1's: the red-box fixture the Claude Code session drew through its own deep_show. The mode call
// carries no document, so it draws the session's current revision (#411, #427: a mode call without a document mints none). Its
// snapshot is display only and kept by its hash in the hub's evidence store; its numbers are the `drawn` rows, each item's
// evaluated bounds: the red box's and the slab's are where the document puts them, centre ± half the size.
import { afterEach, expect, test } from 'vitest';
import {
  AC, BOX, BOX_POS, BOX_SIZE, CLAUDE, DOC, HEX64, SLAB, SLAB_POS, SLAB_SIZE, TEST_MS, brief, call, cleanup, draw, isObject, isPng, openWorld, readEvidence, redBox,
  sha256Of, taken, within, type JsonObject,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const lo = (pos: number[], size: number[]): number[] => pos.map((p, k) => p - size[k]! / 2);
const hi = (pos: number[], size: number[]): number[] => pos.map((p, k) => p + size[k]! / 2);

test(`${AC.bounds} deep_show with mode: bounds on the session's document answers a display_only snapshot and each item's bounds as numbers`, async () => {
  const w = await openWorld();
  await draw(w, CLAUDE, DOC.a, redBox());
  const reply = taken(await call(w, CLAUDE, 'deep_show', { doc: DOC.a, mode: 'bounds', t: '0s', include: ['issues', 'pixels'] }), `deep_show with mode: bounds on ${DOC.a}`);
  expect(reply['outcome'], `the bounds mode is presented: ${brief(reply)}`).toBe('presented');

  const shots = Array.isArray(reply['snapshots']) ? reply['snapshots'].filter(isObject) : [];
  expect(shots.length, `the mode answers a snapshot: ${brief(reply)}`).toBeGreaterThan(0);
  for (const shot of shots) {
    expect(shot['display_only'], `the mode's snapshot is display_only: ${brief(shot)}`).toBe(true);
    const sha = String(shot['sha256']);
    expect(sha, 'the snapshot is named by its SHA-256').toMatch(HEX64);
    const bytes = await readEvidence(w.home, sha);
    expect(isPng(bytes) && sha256Of(bytes) === sha, `the hub's evidence store holds the snapshot ${sha} as a PNG under its hash`).toBe(true);
  }

  const rows = Array.isArray(reply['drawn']) ? reply['drawn'].filter(isObject) : [];
  const row = (id: string): JsonObject | undefined => rows.find((r) => r['id'] === id);
  for (const [id, pos, size] of [[BOX, BOX_POS, BOX_SIZE], [SLAB, SLAB_POS, SLAB_SIZE]] as const) {
    const r = row(id);
    expect(r, `the mode's numbers hold ${id}'s bounds (drawn: ${brief(reply['drawn'])})`).toBeDefined();
    expect(within(r!['min'], lo([...pos], [...size]), 1e-6) && within(r!['max'], hi([...pos], [...size]), 1e-6),
      `${id}'s bounds are [${lo([...pos], [...size]).join(', ')}]–[${hi([...pos], [...size]).join(', ')}] m: ${brief(r)}`).toBe(true);
  }
}, TEST_MS);
