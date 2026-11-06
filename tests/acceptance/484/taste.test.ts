// #484.b58c79f0: "Shown to you: screenshots of the 100,000-tree forest drawn from GPU counts and the composed crowd of
// 2,000 kept agents, taken by the check run from the renderer's own output, are attached to the PR and shown to you in
// the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS,
// and no criterion above reads a picture to judge it"
//
// One run draws the forest at frame 0 and the crowd (helpers: forest, crowdDoc), the fixtures the criteria use, on the
// shipped path. It copies each final target, the renderer's own PNG byte for byte, to `docs/evidence/484/` (README: The
// taste call), printing each SHA-256. It then reads `tests/acceptance/484/TASTE.json`: none, or one made on other
// pictures (another SHA-256), is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these pictures passes. No
// other test reads these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, CROWD_SIZE, FOREST_SIZE, REPO, crowdDoc, forest, frameAt, framesOf, inconclusive, namedFile, requireGpu, run, sha256, useGpu, useOut, view3dCall, writeJson, type JsonValue } from './helpers.ts';

const bin = useGpu();
const dir = useOut();
const SHOTS = join(REPO, 'docs', 'evidence', '484');
const TASTE = join(REPO, 'tests', 'acceptance', '484', 'TASTE.json');
const NAMES = ['forest.png', 'crowd.png'] as const;

describe(`${AC[5]} the screenshots and the one taste call on them`, () => {
  it(`${AC[5]} the run writes the 100,000-tree forest and the 2,000-agent crowd from the renderer's own output, and the owner's recorded call on exactly those says they look right`, () => {
    requireGpu();
    const out = dir();
    const replies = run(bin(), out, [
      view3dCall({ doc: writeJson(out, 'forest', forest().doc), size: FOREST_SIZE, targets: ['final'] }),
      view3dCall({ doc: crowdDoc(bin(), out), size: CROWD_SIZE, targets: ['final'] }),
    ]);
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    NAMES.forEach((name, i) => {
      const bytes = namedFile(out, frameAt(framesOf(replies[i]!, name), 0, name).final, 'png', name);
      writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes);
    });
    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '484', n)}  ${hashes[n]}`).join('\n');
    console.log(`${AC[5]}: screenshots written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/484/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(484);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(AC[5]);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the two screenshots').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${AC[5]}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 3_600_000);
});
