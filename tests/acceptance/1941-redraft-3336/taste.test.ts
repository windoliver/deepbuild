// Blind redraft of tests/acceptance/1941/taste.test.ts for #1941.afbf01b2 (dispute: #3336, criterion #3336.7d4ab4ab:
// "Whatever the run writes goes to a temp or run folder: #1941's screenshots are written outside the checkout, and the
// run names where").
//
// #1941.afbf01b2: "Shown to you: screenshots of each planted-fault scene before and after its named fix is applied,
// taken by the check run from the renderer's own output, are attached to the PR and shown to you in the session.
// Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no
// criterion above reads a picture to judge it"
//
// The same judgement as the first draft, scene for scene (helpers.ts `SHOTS`): for each planted-fault scene the run
// asks the scene's check for its fix (`verdict`), then in one `deep-show run` has render-back draw the revision the
// check judged, sends the fix as alpha's patch, and has render-back draw the revision the patch made. The pictures are
// render-back's own snapshots, read from the evidence store by the hash its reply names, checked to be PNGs of the size
// it names, and written as `<scene>-before.png` and `<scene>-after.png` (the reseeding fill also one frame later).
//
// The one change: the pictures go to a folder made for this run outside the checkout (`mkdtempSync` under the OS temp
// folder), never under the checkout. The run prints that folder first, then each screenshot's name and SHA-256, and
// keeps the folder after the run so the owner can look at the pictures and record the call from the printed hashes.
// It refuses a run folder that resolves inside the checkout. The recorded call is read where the first draft reads it,
// `tests/acceptance/1941/TASTE.json`: none, or one made on other pictures, is INCONCLUSIVE; `looks_wrong` fails;
// `looks_right` on exactly these pictures passes.
//
// Wrong programs: the base without a recorded call (INCONCLUSIVE); a call recorded on other pictures (INCONCLUSIVE); a
// snapshot whose bytes aren't the hash render-back names, or no snapshot; a fix that isn't applied.
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AS_ALPHA, FRAME, REPO, SHOTS, TIMEOUT, appliedFailures, brief, claimId, claimOf, docId, fixBase, inconclusive, judgedRev, namedFix, none, patch,
  patchId, pngSize, readEvidence, renderBack, reqId, requireMetal, rowOf, run, scenarioOf, sha256, useBuild, useFolders, verdict,
  type JsonObject, type JsonValue,
} from '../1941/helpers.ts';

/** The criterion's ID: `#1941.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1941.afbf01b2';
const bin = useBuild();
const folder = useFolders();
/** The recorded call stays where the first draft's README puts it. */
const TASTE = join(REPO, 'tests', 'acceptance', '1941', 'TASTE.json');
/** The scene whose fault shows only between frames. */
const MOVING = 'noise-reseeds';
const NAMES: readonly string[] = SHOTS.flatMap((s) => (s.slug === MOVING
  ? [`${s.slug}-before.png`, `${s.slug}-before-next-frame.png`, `${s.slug}-after.png`, `${s.slug}-after-next-frame.png`]
  : [`${s.slug}-before.png`, `${s.slug}-after.png`]));

/** A folder for this run's screenshots, outside the checkout, kept after the run. */
function runFolder(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1941-taste-')));
  const rel = relative(realpathSync(REPO), dir);
  const inside = rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  expect(inside, `the run folder ${dir} is inside the checkout ${REPO}`).toBe(false);
  return dir;
}

describe(`${ID} screenshots of each planted-fault scene before and after its named fix, and the one taste call on them`, () => {
  it(`${ID} the run writes each planted-fault scene before and after its named fix from render-back's own snapshots to a run folder outside the checkout, and the recorded call on exactly those says they look right`, () => {
    requireMetal('the 3D planted-fault scenes');
    const out = runFolder();
    console.log(`${ID}: this run's screenshots go to ${out} (kept after the run)`);
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
        writeFileSync(join(out, name), bytes);
        hashes[name] = sha;
      });
    }
    const listed = NAMES.map((n) => `  ${n}  ${hashes[n] ?? '(not drawn)'}`).join('\n');
    console.log(`${ID}: screenshots written from this run's render-backs to ${out}:\n${listed}`);
    none(failures, 'each planted-fault scene is drawn by render-back before and after its named fix is applied');

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner the screenshots in ${out}\n${listed}\nand record the answer in tests/acceptance/1941/TASTE.json (tests/acceptance/1941/README.md: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(1941);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recordedShots = c['screenshots'];
    expect(typeof recordedShots === 'object' && recordedShots !== null && !Array.isArray(recordedShots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = recordedShots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names every screenshot this run writes').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's in ${out}: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 2 * TIMEOUT);
});
