// AC11 #732.1b8af42a: "Shown to you: screenshots of the four-stage fixture's slides as the pinned reader renders them beside
// the settled frames, taken by the check run from the exported file, are attached to the PR and shown to you in the
// session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no
// criterion above reads a picture to judge it"
//
// The check run (README: The taste call): this test exports the four-stage piece to pptx and each stage's `still
// {marker}`, renders each slide of the exported file with LibreOffice at 1920 × 1080, and writes, per slide,
// docs/evidence/732/slide-<n>.png: LibreOffice's render on the left and the stage's settled frame on the right, on a grey
// gutter, encoded so the same pixels always give the same bytes; it prints their SHA-256s. Then it reads
// tests/acceptance/732/TASTE.json: none, or a call on other pictures, fails `INCONCLUSIVE:`, never a pass; `looks_wrong`
// fails; `looks_right` on exactly these pictures passes. It judges no picture.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FOUR, FULL, REPO, TIMEOUT, beside, deckAt, deliveredOf, encodePng, fourStages, inconclusive, pptxExport, renderSlides, show, showRun, stillExport,
  stillOf, useShow, useTemp, writeEvidence, type JsonValue,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const TASTE = join(REPO, 'tests', 'acceptance', '732', 'TASTE.json');
const CRITERION = AC[11].split(' ')[1]!;
const NAMES = FOUR.stages.map((_, k) => `slide-${k + 1}.png`);

describe(`${AC[11]} the four-stage piece's slides as LibreOffice renders them beside the settled frames, and the one taste call on them`, () => {
  it(`${AC[11]} the check run takes the pictures from the exported file, and the recorded call on exactly those pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    const ev = temp(); const dir = temp(); const frames = temp(); const out = join(dir, 'deck.pptx');
    const replies = showRun(shows.bin(FULL), ev, [[DOC.four, fourStages(ev)]], [
      pptxExport(DOC.four, out),
      ...FOUR.stages.map((s) => stillExport(DOC.four, join(frames, s.marker), s.marker)),
    ], "AC11's check run");
    deliveredOf(replies[0], "the four-stage piece's deck");
    const deck = deckAt(out, "the four-stage piece's deck");
    expect(deck.slides.length, 'one slide per stage').toBe(FOUR.stages.length);
    const renders = renderSlides(deck, FOUR.stages.map((_, k) => k + 1), "the four-stage piece's deck");
    const files = Object.fromEntries(FOUR.stages.map((s, k) => {
      expect(replies[k + 1]?.['outcome'], `stage ${s.marker}'s still is exported: ${show(replies[k + 1], 600)}`).toBe('exported');
      return [NAMES[k]!, encodePng(beside(renders.get(k + 1)!, stillOf(join(frames, s.marker), `stage ${s.marker}'s still`)))];
    }));
    const hashes = writeEvidence(files);
    const listed = NAMES.map((n) => `  docs/evidence/732/${n}  ${hashes[n]}`).join('\n');
    console.log(`${AC[11]}: the check run's pictures (LibreOffice's render left, the settled frame right):\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/732/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'TASTE.json is an object').toBe(true);
    const call = parsed as Record<string, JsonValue>;
    expect(call['issue'], 'TASTE.json: issue').toBe(732);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(CRITERION);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
    expect(typeof call['who'] === 'string' && call['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof call['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(call['when']) && !Number.isNaN(Date.parse(call['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = (call['screenshots'] ?? {}) as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json: screenshots names the four pictures').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(call['who'])}, ${String(call['when'])}) was made on other pictures: ${other.join(', ')} differ from this run's; this run's are written for a new call`);
    if (call['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(call['who'])}, ${String(call['when'])}) says they don't look right${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${AC[11]}: taste call recorded by ${String(call['who'])} at ${String(call['when'])}: looks right`);
  }, TIMEOUT);
});
