// AC6: "Shown to you: screenshots of clamped overlays at 1920 × 1080 and 390 × 844, an edge arrow, and a card tilted
// toward the pointer, taken by the check run from the canvas's own frames, with a recording of the flythrough, are
// attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it
// the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// One `deep-gpu run` draws, keeping each frame's final PNG byte for byte: the clamp fixture with its arrows flown
// through, at 1.2 s (frame 6 at 5 frames a second), at 1920 × 1080 and at 390 × 844; the still fixture with its arrows
// at 960 × 540, where the tag on the right side points right at its post off the frame (the edge arrow); and the
// recording: the flythrough's 40 frames at 10 a second at 960 × 540, put into one animated PNG unchanged (#449's apng).
// One `deep-show run` draws the card (helpers.ts: cardDoc) live with the pointer at (0.9, 0.5) of its bounds: the
// panel's own `view`, its PNG kept as the evidence store holds it. All five go to `docs/evidence/298/`, each with its
// SHA-256 printed. The test then reads `tests/acceptance/298/TASTE.json`: with none, or one made on other bytes, it is
// INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CARD, CARD_HOVER, CRITERIA, DOC, FLY, REPO, SHA, Show, TIMEOUT, apng, cardDoc, clampDoc, framesOf, getEvidence, inconclusive, presented, readNamed,
  requireGpu, runGpu, runShow, scopeView, sha256, show, showScenario, toPanel, useBins, useDir, view3d, writeJson, type Frame, type JsonValue,
} from './helpers.ts';

/** This criterion's ID: `#298.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs: criterionId). */
const ID = 'AC6 #298.4ae89dd7';

const bin = useBins(['deep-gpu', 'deep-show']);
const dir = useDir();
const SHOTS = join(REPO, 'docs', 'evidence', '298');
const TASTE = join(REPO, 'tests', 'acceptance', '298', 'TASTE.json');
const SCREENSHOTS = ['clamped-1920x1080.png', 'clamped-390x844.png', 'edge-arrow.png', 'card-tilted.png'] as const;
const RECORDINGS = ['flythrough.apng'] as const;
/** The flythrough's frame the two screenshots show: 1.2 s in, tags on three sides and one on its post. */
const SHOWN = 6;
/** The recording: the 4 s flight at 10 frames a second. */
const RECORDED = { fps: 10, frames: FLY.span * 10 } as const;

describe(`${ID} the screenshots and the recording, and the one taste call on them`, () => {
  it(`${ID} the run writes clamped overlays at 1920 × 1080 and 390 × 844, an edge arrow, a card tilted toward the pointer and a recording of the flythrough from the canvas's own frames, and the recorded call on exactly those says they look right`, () => {
    requireGpu();
    const out = dir();
    const fly = writeJson(out, 'fly-arrows', clampDoc({ motion: 'fly', arrows: true }));
    const still = writeJson(out, 'still-arrows', clampDoc({ motion: 'still', arrows: true }));
    const at = { fps: FLY.fps, from: SHOWN, frames: 1, capture: [SHOWN] };
    const replies = runGpu(bin('deep-gpu'), out, [
      view3d({ doc: fly, size: [1920, 1080], ...at }),
      view3d({ doc: fly, size: [390, 844], ...at }),
      view3d({ doc: still, size: [960, 540], fps: FLY.fps, frames: 1, capture: [0] }),
      view3d({ doc: fly, size: [960, 540], fps: RECORDED.fps, frames: RECORDED.frames, capture: 'every' }),
    ]);
    const png = (f: Frame | undefined, what: string): Buffer => {
      expect(f?.final, `${what}: the canvas's final PNG, named by its SHA-256`).toMatch(SHA);
      return readNamed(out, f!.final, 'png', what);
    };
    const recorded = framesOf(replies[3]!, 'the flythrough, recorded');
    expect(recorded.length, 'the recording holds every frame of the flight').toBe(RECORDED.frames);

    // The card, live, with the pointer at (0.9, 0.5) of its bounds.
    const evidence = join(out, 'evidence');
    mkdirSync(evidence);
    const rect: [number, number, number, number] = [0, 0, ...CARD.page];
    const card = cardDoc();
    const view = scopeView(bin('deep-show'), evidence, DOC(6), card, { rect }, 'AC6 the card');
    const s = new Show();
    s.present(DOC(6), card);
    s.move(toPanel(view, CARD_HOVER));
    const live = s.view();
    const r = runShow(bin('deep-show'), showScenario(evidence, [DOC(6)], s.calls, rect), 'AC6 the card under the pointer');
    presented(r[0]!, 'the card with its tilt driver over hover_at');
    const snapshot = r[live]!['snapshot'];
    const sha = typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot) ? snapshot['sha256'] : undefined;
    expect(typeof sha, `the live view's snapshot: ${show(r[live], 600)}`).toBe('string');

    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };
    SCREENSHOTS.slice(0, 3).forEach((name, i) => keep(name, png(framesOf(replies[i]!, name)[0], name)));
    keep('card-tilted.png', getEvidence(evidence, sha as string, 'card-tilted.png'));
    keep('flythrough.apng', apng(recorded.map((f) => png(f, `flythrough.apng: frame ${f.frame}`)), RECORDED.fps, 'flythrough.apng'));
    const listed = [...SCREENSHOTS, ...RECORDINGS].map((n) => `  ${join('docs', 'evidence', '298', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: written from this run's frames:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/298/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(298);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(CRITERIA[6]);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const named = { ...(c['screenshots'] as Record<string, JsonValue> | undefined ?? {}), ...(c['recordings'] as Record<string, JsonValue> | undefined ?? {}) };
    expect(Object.keys(named).sort(), `TASTE.json names the four screenshots and the recording: ${show(named)}`).toEqual([...SCREENSHOTS, ...RECORDINGS].sort());
    const other = Object.keys(hashes).filter((n) => named[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other bytes than this run's: ${other.map((n) => `${n} recorded ${String(named[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
  }, TIMEOUT);
});
