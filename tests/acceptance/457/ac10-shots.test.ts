// #457.08351b79: "Shown to you: screenshots of the castle shot with the tower behind the market stall before and after
// its fix, and the piston with the half-section cutaway on and off, taken by the check run from the renderer's own
// render-back, are attached to the PR and shown to you in the session. Whether they look right is one taste call,
// recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// Fixtures: criterion 1's castle shot and criterion 4's engine, with and without its half-section (helpers.ts).
// One run asks camera.framing for the hidden tower's fix (`verdict`). The next, in one `deep-show run`, has render-back
// draw the castle at the revision the check judged, sends the fix as alpha's patch, has render-back draw the revision
// the patch made, and draws the engine with its cutaway and the engine whole.
// asserts:
//   - each picture is render-back's own snapshot: the evidence store holds bytes of the hash render-back names, and
//     they decode as a PNG of the size it names;
//   - the run writes them to `docs/evidence/457/` as castle-before.png, castle-after.png, piston-cutaway-on.png and
//     piston-cutaway-off.png; each file exists, decodes, and hashes to render-back's SHA-256; their hashes are printed;
//   - then the recorded call, `tests/acceptance/457/TASTE.json` (#456's and #468's convention): none, or one made on
//     other pictures, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these pictures passes.
// No other test reads these pictures or the call. Attaching them to the PR and showing them in the session is the
// implementer's, outside any test.
// Wrong programs: the base (no occlusion failure, so no fix to draw after); the run without a recorded call
// (INCONCLUSIVE); a call recorded on other pictures (INCONCLUSIVE); a picture that isn't render-back's own.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng, readEvidence } from '../456/helpers.ts';
import {
  CASTLE_CHECK, REPO, TIMEOUT, TOWER, brief, castle, claimId, claimOn, docId, engine, fixOps, inconclusive, judgedRev, none, occlusionIssues, patch,
  patchId, renderBack, reqId, requireMetal, rowOf, run, scenarioOf, sha256, snapshotOf, useBuilds, useFolders, verdict, type JsonValue,
} from './helpers.ts';

const ID = '#457.08351b79';
const builds = useBuilds();
const folder = useFolders();
const SHOTS_DIR = join(REPO, 'docs', 'evidence', '457');
const TASTE = join(REPO, 'tests', 'acceptance', '457', 'TASTE.json');
const NAMES = ['castle-before.png', 'castle-after.png', 'piston-cutaway-on.png', 'piston-cutaway-off.png'] as const;
const [CASTLE, CUT, WHOLE] = [docId(1), docId(2), docId(3)];
const [CLAIM, REQ] = [claimId(1), reqId(1)];

describe(`${ID} screenshots of the castle before and after its fix and the piston with its cutaway on and off, and the one taste call on them`, () => {
  it(`${ID} the check run writes render-back's own pictures of the castle before and after its fix and the piston with the cutaway on and off, and the recorded call on exactly those says they look right`, () => {
    requireMetal('render-back of the castle and the engine');
    const claims = { [CLAIM]: claimOn(CASTLE, [[REQ, CASTLE_CHECK]]) };
    const docs = { [CASTLE]: castle(), [CUT]: engine(true), [WHOLE]: engine(false) };
    const [judged] = run(builds.debug(), scenarioOf(folder(), docs, claims, [verdict(CLAIM)]));
    const failing = occlusionIssues(rowOf(judged!, REQ, 'the castle shot'), TOWER.id).find((i) => fixOps(i) !== null);
    expect(failing, `the castle shot names the hidden tower's fix as patch ops: ${brief(judged!)}`).toBeDefined();
    const base = judgedRev(judged!, CASTLE) ?? 0;
    const evidence = folder();
    const replies = run(builds.debug(), scenarioOf(evidence, docs, claims, [
      renderBack(CASTLE, base), patch(CASTLE, patchId(1), base, fixOps(failing!)!, "camera.framing's fix for the hidden tower"), renderBack(CASTLE, base + 1),
      renderBack(CUT, 0), renderBack(WHOLE, 0),
    ]));
    expect(replies[1]!['outcome'], `the fix is applied: ${brief(replies[1]!)}`).toBe('applied');
    const drawn: [string, number, number][] = [[NAMES[0], 0, base], [NAMES[1], 2, base + 1], [NAMES[2], 3, 0], [NAMES[3], 4, 0]];
    mkdirSync(SHOTS_DIR, { recursive: true });
    const hashes: Record<string, string> = {};
    const failures: string[] = [];
    for (const [name, k, rev] of drawn) {
      const snap = snapshotOf(replies[k]!, rev, name);
      if (typeof snap === 'string') { failures.push(snap); continue; }
      const bytes = readEvidence(evidence, snap.sha);
      if (!bytes || sha256(bytes) !== snap.sha) { failures.push(`${name}: the evidence store holds no bytes of render-back's hash ${snap.sha}`); continue; }
      const path = join(SHOTS_DIR, name);
      writeFileSync(path, bytes);
      if (!existsSync(path)) { failures.push(`${path} isn't written`); continue; }
      const written = readFileSync(path);
      const png = decodePng(written);
      if (typeof png === 'string' || png.w !== snap.w || png.h !== snap.h) { failures.push(`${name} doesn't decode as a ${snap.w} × ${snap.h} PNG: ${typeof png === 'string' ? png : `${png.w} × ${png.h}`}`); continue; }
      if (sha256(written) !== snap.sha) { failures.push(`${name} isn't render-back's own picture by hash`); continue; }
      hashes[name] = snap.sha;
    }
    none(failures, "each picture is render-back's own snapshot, written and decoded");

    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '457', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots written from this check run's render-backs:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/457/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(457);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the four screenshots this run writes').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 2 * TIMEOUT);
});
