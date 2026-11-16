// #456.95e1edbb: "Shown to you: screenshots of one snapshot with its ID view numbered at each item's visible centre,
// taken by the check run from the renderer's own output, are attached to the PR and shown to you in the session.
// Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no
// criterion above reads a picture to judge it"
//
// Fixture (helpers.ts): the review room and its render.review claim (criterion 1's). One `deep-show run` judges
// revision 0 (the stub model finds nothing) and has render-back draw the same revision at the same size and t.
// asserts:
//   - the reading's snapshot is the renderer's own output: its SHA-256 and size are render-back's snapshot's;
//   - the run writes the snapshot and its ID view, read from the evidence store by the hashes the reading names, to
//     `docs/evidence/456/snapshot.png` and `docs/evidence/456/id-view.png`; each file exists, decodes as a PNG of the
//     snapshot's size, and hashes to the reading's SHA-256; the ID view's numbers are printed beside them;
//   - then the recorded call, `tests/acceptance/456/TASTE.json`: none, or one made on other pictures, is
//     INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these pictures passes.
// No other test reads these pictures or the call. Attaching them to the PR and showing them in the session is the
// implementer's, outside any test.
// Wrong programs: the base (no reading, so no pictures); the run without a recorded call (INCONCLUSIVE); a call
// recorded on other pictures (INCONCLUSIVE); a reading whose snapshot isn't render-back's.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  QUIET, REPO, ROOM_CLAIM, ROOM_DOC, ROOM_REVIEW, SIZE, TIMEOUT, brief, decodePng, idViewOf, inconclusive, listOf, readEvidence, readingOf, renderBack,
  requireMetal, reviewRoom, roomClaim, rowOf, run, scenarioOf, sha256, useBuild, useFolders, verdict, type JsonValue,
} from './helpers.ts';

/** The criterion's ID: `#456.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#456.95e1edbb';
const bin = useBuild();
const folder = useFolders();
const SHOTS_DIR = join(REPO, 'docs', 'evidence', '456');
const TASTE = join(REPO, 'tests', 'acceptance', '456', 'TASTE.json');
const NAMES = ['snapshot.png', 'id-view.png'] as const;

describe(`${ID} screenshots of one snapshot and its numbered ID view, and the one taste call on them`, () => {
  it(`${ID} the check run writes the renderer's own snapshot and its ID view, and the recorded call on exactly those says they look right`, () => {
    requireMetal('the review room');
    const evidence = folder();
    const out = run(bin(), scenarioOf(evidence, { [ROOM_DOC]: reviewRoom() }, roomClaim(), [verdict(ROOM_CLAIM), renderBack(ROOM_DOC, 0)], { replies: [QUIET] }));
    const what = 'render.review of the review room';
    const reading = readingOf(rowOf(out[0]!, ROOM_REVIEW, what), what);
    const snapshot = listOf(reading, 'snapshots', what)[0];
    expect(snapshot, `${what}: the reading names its snapshot`).toBeDefined();
    const view = idViewOf(reading, what);
    const drawn = out[1]!;
    const own = Array.isArray(drawn['snapshots']) ? (drawn['snapshots'] as JsonValue[])[0] : undefined;
    expect(drawn['outcome'], `render-back presents revision 0: ${brief(drawn, 800)}`).toBe('presented');
    expect([snapshot!['sha256'], snapshot!['w'], snapshot!['h']], "the reading's snapshot is the renderer's own output, render-back's snapshot of the same revision, size and t")
      .toEqual([(own as Record<string, JsonValue>)['sha256'], SIZE[0], SIZE[1]]);

    mkdirSync(SHOTS_DIR, { recursive: true });
    const hashes: Record<string, string> = {};
    for (const [name, sha] of [[NAMES[0], String(snapshot!['sha256'])], [NAMES[1], view.sha256]] as const) {
      const bytes = readEvidence(evidence, sha);
      expect(bytes !== null && sha256(bytes) === sha, `${name}: the evidence store holds the bytes of ${sha}`).toBe(true);
      const path = join(SHOTS_DIR, name);
      writeFileSync(path, bytes!);
      expect(existsSync(path), `${path} is written`).toBe(true);
      const written = readFileSync(path);
      const png = decodePng(written);
      expect(typeof png === 'string' ? png : [png.w, png.h], `${name} decodes as a PNG of the snapshot's size`).toEqual([...SIZE]);
      expect(sha256(written), `${name} is the reading's own picture, by hash`).toBe(sha);
      hashes[name] = sha;
    }
    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '456', n)}  ${hashes[n]}`).join('\n');
    const numbers = view.numbers.map((x) => `  ${x.n}: ${x.id} (${x.kind}, ${x.material}) ${x.at ? `at ${x.at.map((c) => c.toFixed(1)).join(', ')}` : 'no mark'}`).join('\n');
    console.log(`${ID}: screenshots written from this check run:\n${listed}\nthe ID view's numbers:\n${numbers}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/456/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(456);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names both screenshots this run writes').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, TIMEOUT);
});
