// #1938.f19b61dd, Oracle lane: the WCAG 2 contrast ratio and its 4.5:1 minimum for normal text, as the upstream
// accessibility library's tests hold them, run against our output (#136: a linked test counts only when run against our
// output). The oracle page (doneright/oracles/issues/1938.md) links three files to criterion 1, pinned at commit
// e797173108eadfa4355fe06af331791734e1757f: test/commons/color/has-valid-contrast-ratio.js,
// test/commons/color/get-contrast.js and test/checks/color/color-contrast.js. Its use is "port": the formula is
// re-expressed below, and no upstream code is copied or run.
//
// The formula, re-expressed (WCAG 2's contrast ratio): each sRGB channel v (0 to 255) decodes to linear light as
// c = v ÷ 255, c ÷ 12.92 when c ≤ 0.04045, else ((c + 0.055) ÷ 1.055)^2.4; a color's relative luminance is
// L = 0.2126 R + 0.7152 G + 0.0722 B in linear light; and two colors' contrast ratio is (L1 + 0.05) ÷ (L2 + 0.05),
// L1 the lighter. Normal text passes at 4.5 or more.
//
// Upstream's assertions, and what each is here (every board: helpers.ts `lineBoard`, one line "Contrast, measured" in
// the look's body face at 20 u, regular weight, normal text by WCAG's measure, on the clean look's ground or on a rect):
//   - black on white is valid, its ratio over 4.5 → a line in ink (#1b1d22) on the ground (#ffffff), 16.86:1, passes;
//   - white and gray 128 in 8 pt text that isn't bold are invalid, the ratio under 4.5 though over 3, the minimum 4.5 →
//     a line in muted (#8b8f97), 3.24:1, fails;
//   - yellow on white is invalid → a line in accent (#1aa3c8), 2.95:1, fails;
//   - black on black has the ratio 1 and is invalid: a 1:1 text counts, it isn't passed as hidden → a line in the
//     ground's own role fails at 1:1;
//   - the ratio is reversible, and the background is what is drawn under the text, not its parent's or the page's →
//     the ground's role on an accent rect fails at 2.95:1, the same ratio as accent on the ground, naming the line, not
//     the rect;
//   - the check reports the ratio it measured (21.00 for black on white), more contrast gives a higher ratio and one
//     color on itself gives 1 → each failure reports its ratio, the formula's within 0.05;
//   - the minimum is 4.5 → a line in term_bright_magenta (#d610d8), 4.26:1, fails, and one in session_readout
//     (#b0207f), 6.25:1, under 7:1, passes.
// Every color is the clean look's light theme (helpers.ts CLEAN_LIGHT). Each board is the one deliverable of its own
// claim of alpha's, whose one requirement is `{kind: render.contrast}`, judged with `verdict` in one run. A passing
// board's row PASSes with no error or warning; a failing board's row FAILs, every error and warning on it is an error
// of render.contrast with a non-empty `code` naming exactly the line, and each reports the formula's ratio within 0.05.
// Not ported: the large-text minimum of 3:1 (the design's render.contrast has one `min`, 4.5, and every line here is
// normal text by WCAG's measure, so neither reading changes a result); the check-level cases that read a web page's
// styles (hidden elements, text shadows, color functions with `none`, inline elements across lines, images).
//
// The formula is first held to upstream's own assertions (`formulaKeepsUpstreamAssertions`), so a port that broke it
// fails before the binary is asked.
import { describe, expect, it } from 'vitest';
import {
  CLEAN_LIGHT, PLATE, TIMEOUT, WORDS, brief, claimId, claimOf, decided, docId, faultFailures, lineBoard, none, passFailures, raised,
  ratioOf, reqId, rowOf, run, scenarioOf, useBuild, useFolders, verdict,
} from './helpers.ts';

/** The criterion's ID: `#1938.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1938.f19b61dd';
const bin = useBuild();
const folder = useFolders();

/** WCAG 2's minimum for normal text, render.contrast's `min`. */
const MIN = 4.5;
/** How far a reported ratio may sit from the formula's. */
const TOLERANCE = 0.05;

/** One sRGB channel (0 to 255) in linear light. */
function linear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
/** The relative luminance of an opaque `#rrggbb`. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * linear((n >> 16) & 255) + 0.7152 * linear((n >> 8) & 255) + 0.0722 * linear(n & 255);
}
/** Two colors' contrast ratio, the lighter's luminance over the darker's, each plus 0.05. */
function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Upstream's assertions on the formula itself, with its own colors. */
function formulaKeepsUpstreamAssertions(): void {
  const [black, white, gray, yellow] = ['#000000', '#ffffff', '#808080', '#ffff00'];
  expect(contrastRatio(black, white), 'black on white is over 4.5').toBeGreaterThan(MIN);
  expect(contrastRatio(black, white).toFixed(2), 'black on white reads 21.00').toBe('21.00');
  expect(contrastRatio(white, gray), 'white and gray 128 are under 4.5').toBeLessThan(MIN);
  expect(contrastRatio(white, gray), 'white and gray 128 are over 3').toBeGreaterThan(3);
  for (const c of [black, white, yellow]) expect(contrastRatio(c, c), `${c} on itself is 1`).toBe(1);
  expect(contrastRatio(yellow, black), 'reversible: yellow and black').toBe(contrastRatio(black, yellow));
  expect(contrastRatio(yellow, white), 'reversible: yellow and white').toBe(contrastRatio(white, yellow));
  expect(contrastRatio(yellow, white), 'yellow on white is under yellow on black').toBeLessThan(contrastRatio(yellow, black));
  expect(contrastRatio(yellow, black), 'yellow on black is under white on black').toBeLessThan(contrastRatio(white, black));
}

/** A board: the line's role, the role of the rect under it when there is one, and the ratio the formula gives, to two places. */
interface Case { name: string; role: string; under?: string; about: number }
const CASES: readonly Case[] = [
  { name: 'ink on the ground', role: 'ink', about: 16.86 },
  { name: 'muted on the ground', role: 'muted', about: 3.24 },
  { name: 'accent on the ground', role: 'accent', about: 2.95 },
  { name: "the ground's role on the ground", role: 'ground', about: 1 },
  { name: "the ground's role on an accent rect", role: 'ground', under: 'accent', about: 2.95 },
  { name: 'term_bright_magenta on the ground', role: 'term_bright_magenta', about: 4.26 },
  { name: 'session_readout on the ground', role: 'session_readout', about: 6.25 },
];
const ratioOfCase = (c: Case): number => contrastRatio(CLEAN_LIGHT[c.role]!, CLEAN_LIGHT[c.under ?? 'ground']!);

describe(`${ID} oracle: the WCAG 2 contrast ratio and its 4.5:1 minimum, run against render.contrast`, () => {
  it(`${ID} text at or over 4.5:1 by WCAG 2's ratio passes render.contrast and text under it fails, naming the text with the formula's ratio`, () => {
    formulaKeepsUpstreamAssertions();
    for (const c of CASES) expect(Math.abs(ratioOfCase(c) - c.about), `${c.name} is ${c.about}:1 by the formula`).toBeLessThan(0.005);

    const docs = Object.fromEntries(CASES.map((c, i) => [docId(i + 1), lineBoard(c.role, c.under)]));
    const claims = Object.fromEntries(CASES.map((_, i) => [claimId(i + 1), claimOf(docId(i + 1), reqId(i + 1))]));
    const replies = run(bin(), scenarioOf(folder(), docs, claims, CASES.map((_, i) => verdict(claimId(i + 1)))));

    const failures: string[] = [];
    const reported = new Map<string, number[]>();
    CASES.forEach((c, i) => {
      const what = `render.contrast on ${c.name} (${c.about}:1)`;
      const row = rowOf(replies[i]!, reqId(i + 1), c.name);
      decided(row, what);
      if (ratioOfCase(c) >= MIN) { failures.push(...passFailures(row, what)); return; }
      failures.push(...faultFailures(row, WORDS, what));
      const ratios = raised(row).map((issue) => {
        const r = ratioOf(issue);
        if (r === null) failures.push(`${what} reports no ratio (\`actual\`, \`actual.ratio\` or \`ratio\`): ${brief(issue.raw, 600)}`);
        else if (Math.abs(r - ratioOfCase(c)) > TOLERANCE) failures.push(`${what} reports ${r}:1, not the formula's ${ratioOfCase(c).toFixed(4)}:1 within ${TOLERANCE}`);
        return r;
      });
      reported.set(c.name, ratios.filter((r): r is number => r !== null));
    });
    none(failures, `each board passes at or over ${MIN}:1 and fails under it, naming the line (never the ${PLATE}) with the formula's ratio`);

    // Reversible: the same two colors, swapped between the line and what is under it, report one ratio.
    const [onGround, onRect] = [reported.get('accent on the ground')!, reported.get("the ground's role on an accent rect")!];
    for (const r of onRect) for (const s of onGround) expect(Math.abs(r - s), `accent under white text reports the ratio white under accent text does: ${r} and ${s}`).toBeLessThanOrEqual(TOLERANCE);
  }, TIMEOUT);
});
