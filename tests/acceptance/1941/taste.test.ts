// #1941.afbf01b2: "Shown to you: screenshots of each planted-fault scene before and after its named fix is applied,
// taken by the check run from the renderer's own output, are attached to the PR and shown to you in the session.
// Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no
// criterion above reads a picture to judge it"
//
// Scenes (helpers.ts `SHOTS`): each planted-fault scene of #1938 (the nine), #1936 (a wall added twice, a kit piece
// 0.05 m off the grid, a kit wall moved 2 mm) and #1937 (a showpiece over its class), as the issue's scope lists them.
// For each, this run asks the scene's check for its fix (`verdict`), then in one `deep-show run` has render-back draw
// the revision the check judged, sends the fix as alpha's patch, and has render-back draw the revision the patch made.
// The pictures are render-back's own snapshots, read from the evidence store by the hash its reply names, and written
// to `docs/evidence/1941/` as `<scene>-before.png` and `<scene>-after.png` (the reseeding fill also one frame later,
// `-before-next-frame.png` and `-after-next-frame.png`, since a still can't show a fill that changes each frame). The run
// prints each one's SHA-256. It then reads the recorded call, `tests/acceptance/1941/TASTE.json` (the convention of
// tests/acceptance/226): none, or one made on other pictures, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on
// exactly these pictures passes.
//
// No other test reads these pictures or the call: criteria 1 to 3 read verdict rows and patch replies only.
// Wrong programs: the base without a recorded call (INCONCLUSIVE); a call recorded on other pictures (INCONCLUSIVE); a
// snapshot whose bytes aren't the hash render-back names, or no snapshot; a fix that isn't applied.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AS_ALPHA, FRAME, REPO, SHOTS, TIMEOUT, appliedFailures, brief, claimId, claimOf, docId, fixBase, inconclusive, judgedRev, namedFix, none, patch,
  patchId, pngSize, readEvidence, renderBack, reqId, requireMetal, rowOf, run, scenarioOf, sha256, useBuild, useFolders, verdict,
  type JsonObject, type JsonValue,
} from './helpers.ts';

/** The criterion's ID: `#1941.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1941.afbf01b2';
const bin = useBuild();
const folder = useFolders();
const SHOTS_DIR = join(REPO, 'docs', 'evidence', '1941');
const TASTE = join(REPO, 'tests', 'acceptance', '1941', 'TASTE.json');
/** The scene whose fault shows only between frames. */
const MOVING = 'noise-reseeds';
const NAMES: readonly string[] = SHOTS.flatMap((s) => (s.slug === MOVING
  ? [`${s.slug}-before.png`, `${s.slug}-before-next-frame.png`, `${s.slug}-after.png`, `${s.slug}-after-next-frame.png`]
  : [`${s.slug}-before.png`, `${s.slug}-after.png`]));

describe(`${ID} screenshots of each planted-fault scene before and after its named fix, and the one taste call on them`, () => {
  it(`${ID} the run writes each planted-fault scene before and after its named fix from render-back's own snapshots, and the recorded call on exactly those says they look right`, () => {
    requireMetal('the 3D planted-fault scenes');
    mkdirSync(SHOTS_DIR, { recursive: true });
    const hashes: Record<string, string> = {};
    const failures: string[] = [];
    const [doc, claim, req] = [docId(1), claimId(1), reqId(1)];
    for (const s of SHOTS) {
      const evidence = folder();
      const claims = { [claim]: claimOf(doc, [[req, s.check]]) };
      const [v0] = run(bin(), scenarioOf(evidence, { [doc]: s.doc() }, claims, [verdict(claim)]));
      const fix = namedFix(rowOf(v0!, req, `${s.slug} at revision 0`), s.fault, `${s.fault.kind} on ${s.from}'s ${s.slug} at revision 0`);
      const base = fixBase(fix.issue, judgedRev(v0!, doc) ?? 0);
      const times = s.slug === MOVING ? [0, FRAME] : [0];
      const shots = (rev: number): JsonObject[] => times.map((t) => renderBack(doc, rev, t));
      const replies = run(bin(), scenarioOf(evidence, { [doc]: s.doc() }, claims, [...shots(base), patch(AS_ALPHA, doc, patchId(1), base, fix.ops), ...shots(base + 1)]));
      failures.push(...appliedFailures(replies[times.length]!, `${s.slug}'s named fix`));
      const drawn = [...replies.slice(0, times.length).map((r) => ['before', base, r] as const), ...replies.slice(times.length + 1).map((r) => ['after', base + 1, r] as const)];
      drawn.forEach(([when, rev, r], k) => {
        const name = `${s.slug}-${when}${k % times.length === 1 ? '-next-frame' : ''}.png`;
        const snap = Array.isArray(r['snapshots']) ? (r['snapshots'] as JsonValue[])[0] : undefined;
        if (r['outcome'] !== 'presented' || r['rev'] !== rev || typeof snap !== 'object' || snap === null || Array.isArray(snap)) {
          failures.push(`render-back of ${s.slug} ${when} its fix (revision ${rev}) isn't presented with a snapshot: ${brief(r, 600)}`);
          return;
        }
        const sha = String(snap['sha256']);
        const bytes = readEvidence(evidence, sha);
        if (!bytes || sha256(bytes) !== sha) { failures.push(`${name}: the evidence store holds no bytes of hash ${sha}`); return; }
        const size = pngSize(bytes);
        if (!size || size[0] !== snap['w'] || size[1] !== snap['h']) { failures.push(`${name}: not a ${brief(snap['w'])} × ${brief(snap['h'])} PNG: ${brief(size)}`); return; }
        writeFileSync(join(SHOTS_DIR, name), bytes);
        hashes[name] = sha;
      });
    }
    none(failures, 'each planted-fault scene is drawn by render-back before and after its named fix is applied');

    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '1941', n)}  ${hashes[n] ?? '(not drawn)'}`).join('\n');
    console.log(`${ID}: screenshots written from this run's render-backs:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/1941/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(1941);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names every screenshot this run writes').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 2 * TIMEOUT);
});
