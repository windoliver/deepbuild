// AC4: "A card whose tilt driver reads `hover_at` tilts toward a replica's hover at (0.9, 0.5) of its bounds live, while
// its golden and its export draw it flat, since `hover_at` reads (−1, −1) there; a logic item that reads it, directly or
// through a driver, is refused at check, naming the item; a planted export that keeps the live hover tilts the card and
// fails the golden, naming the item"
//
// The fixture (helpers.ts: cardDoc): a 640 × 400 u figure shown 1:1 in its panel. `card` is a 400 × 240 u rect turning
// about its middle; its driver `tilt` writes `hover_at(card).x < 0 ? 0 : 30 * (hover_at(card).x - 0.5)` to its turn,
// so (0.9, 0.5) leans it 12° clockwise, toward the pointer on its right half, and (−1, −1) leaves it flat. `probe`, a
// square kept off the page, carries what `hover_at(card)` reads: its drivers write −64 plus each axis to its position.
// Through `deep-show run` (a headless copy of the core on a virtual clock, the design's replica): `eval` at 1 s with a
// picture and the three paths' values (the fixture's golden: the document's own frame); the pointer moved, no button
// down, to the page point (480, 200), which is (0.9, 0.5) of the card's bounds; the panel's live `view`; `eval` again;
// the export of the whole span as a PNG sequence at 4 frames a second.
//
// asserts:
//   - the golden, before and after the hover: the tilt's value is 0 and the probe's place is (−65, −65), so `hover_at`
//     reads (−1, −1) there; its picture shows the flat card (the card's color at `flat`, the page's at `toward`);
//   - the live view with the pointer there: the card's color at `toward`, where only the card leaned clockwise by
//     10.5° to 12.5° reaches, and the page's at `flat` and at `away`: it tilts, and toward the pointer;
//   - every exported frame shows the flat card at `flat` and `toward`;
//   - the card with a logic item `peek` that reads nothing is presented; with `peek` reading `hover_at(card)`, the
//     driver `drivers/tilt`, or the path that driver writes, each is refused at check with an error naming `peek`;
//   - planted `export_keeps_live_hover_at`: an exported frame shows the tilted card, and the failure names `card`.
// Colors are compared as #539's suite compares them: within 3 code values is the same, more than 40 is another.
// Wrong programs: the base (it has no `hover_at`, so the card is refused); `hover_at` in pixels, or measured from the
// card's middle, or mirrored; a hover that reaches the golden or the export; a check that lets logic read it.
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CARD, CARD_HOVER, CARD_PROBES, CARD_TILT, DOC, FLICKS, PROBE_PATHS, Show, TILT_PATH, cardDoc, codeOff, decodePng, failsNaming, getEvidence, inconclusive,
  insideCard, none, pagePixel, presented, putEvidence, refusedNamingItem, runShow, scopeView, show, showScenario, stateOf, tickerProgram, toPanel, useBins,
  useDir, TIMEOUT, type Image, type JsonObject, type Pt, type Rgb, type ShowPlanted,
} from './helpers.ts';

/** This criterion's ID: `#298.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs: criterionId). */
const ID = 'AC4 #298.fd687640';

const bin = useBins(['deep-show']);
const dir = useDir();
const D = DOC(4);
const RECT: [number, number, number, number] = [0, 0, ...CARD.page];
/** The golden's time: 1 s into the 2 s span. */
const T = FLICKS;
const PATHS = [TILT_PATH, ...PROBE_PATHS];
const same = (a: Rgb, b: Rgb): boolean => codeOff(a, b) <= 3;
const point = (p: Pt): string => `(${p[0]}, ${p[1]})`;

/** The probes' own geometry: it holds whatever the program does. */
function guards(): void {
  expect(CARD_HOVER, 'the fixture: (0.9, 0.5) of the card bounds is the page point (480, 200)').toEqual([480, 200]);
  expect(CARD_TILT, 'the fixture: the driver leans the card 12° at (0.9, 0.5)').toBeCloseTo(12, 9);
  expect(insideCard(CARD_PROBES.flat, 0) >= 5 && insideCard(CARD_PROBES.toward, 0) <= -5 && insideCard(CARD_PROBES.away, 0) <= -5, 'the fixture: the flat card covers `flat` and neither `toward` nor `away`, each by 5 u or more').toBe(true);
  for (const deg of [10.5, 12, 12.5]) {
    expect(insideCard(CARD_PROBES.toward, deg) >= 5 && insideCard(CARD_PROBES.flat, deg) <= -5 && insideCard(CARD_PROBES.away, deg) <= -5, `the fixture: the card leaned ${deg}° clockwise covers \`toward\` and neither \`flat\` nor \`away\`, each by 5 u or more`).toBe(true);
    expect(insideCard(CARD_HOVER, deg), `the fixture: the card leaned ${deg}° still lies under the pointer`).toBeGreaterThan(20);
  }
  expect(insideCard(CARD_PROBES.away, -CARD_TILT) >= 5 && insideCard(CARD_PROBES.toward, -CARD_TILT) <= -5, 'the fixture: a card leaned the other way covers `away`, not `toward`').toBe(true);
}

const evalImage = (ev: string, reply: JsonObject, what: string): Image => {
  expect(reply['outcome'], `${what} is evaluated: ${show(reply, 1200)}`).toBe('evaluated');
  const snaps = reply['snapshots'];
  const first = Array.isArray(snaps) && typeof snaps[0] === 'object' && snaps[0] !== null && !Array.isArray(snaps[0]) ? snaps[0]['sha256'] : undefined;
  expect(typeof first, `${what}: snapshots[0].sha256`).toBe('string');
  return decodePng(getEvidence(ev, first as string, what));
};
const valuesOf = (reply: JsonObject): Record<string, unknown> => {
  const v = reply['values'];
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {};
};

function judge(planted?: ShowPlanted): { failures: string[]; exported: number } {
  const ev = join(dir(), 'evidence');
  mkdirSync(ev);
  const out = join(dir(), 'frames');
  const doc = cardDoc();
  const view = scopeView(bin('deep-show'), ev, D, doc, { rect: RECT }, 'AC4 the card');
  const s = new Show();
  s.present(D, doc);
  s.scope();
  const golden = s.eval(D, T, PATHS);
  s.move(toPanel(view, CARD_HOVER));
  const live = s.view();
  const hovered = s.scope();
  const goldenAfter = s.eval(D, T, PATHS);
  const exported = s.export(D, out, 4);
  const what = `AC4 the card under the pointer${planted ? ` (planted ${planted})` : ''}`;
  const r = runShow(bin('deep-show'), showScenario(ev, [D], s.calls, RECT, planted), what);
  presented(r[0]!, 'the card with its tilt driver over hover_at');

  const failures: string[] = [];
  const at = (im: Image, p: Pt): Rgb => pagePixel(im, CARD.page, p);
  // The golden before any hover: what the card and the page look like, and what hover_at reads there.
  const g = evalImage(ev, r[golden]!, 'the golden before any hover');
  const card = at(g, CARD_PROBES.middle);
  const page = at(g, CARD_PROBES.toward);
  expect(codeOff(card, page), `the fixture: the golden shows the card's color ${show(card)} at its middle and the page's ${show(page)} beside it, more than 40 code values apart`).toBeGreaterThan(40);
  const flat = (im: Image, which: string): void => {
    if (!same(at(im, CARD_PROBES.flat), card)) failures.push(`${which} differs from the flat card inside the item card's box: at ${point(CARD_PROBES.flat)}, by its top right corner, it shows ${show(at(im, CARD_PROBES.flat))}, not the card's ${show(card)}`);
    if (!same(at(im, CARD_PROBES.toward), page)) failures.push(`${which} shows the item card tilted: at ${point(CARD_PROBES.toward)}, beside the flat card's right side, it shows ${show(at(im, CARD_PROBES.toward))}, not the page's ${show(page)}`);
  };
  const reads = (reply: JsonObject, which: string): void => {
    const v = valuesOf(reply);
    if (v[TILT_PATH] !== 0) failures.push(`${which} evaluates the item card's tilt (${TILT_PATH}) as ${show(v[TILT_PATH])}, not 0`);
    if (v[PROBE_PATHS[0]] !== -65 || v[PROBE_PATHS[1]] !== -65) failures.push(`${which} evaluates hover_at(card) as (${show(v[PROBE_PATHS[0]])} + 64, ${show(v[PROBE_PATHS[1]])} + 64), not (−1, −1): the probe sits at (${show(v[PROBE_PATHS[0]])}, ${show(v[PROBE_PATHS[1]])}), not (−65, −65)`);
  };
  flat(g, 'the golden before any hover');
  reads(r[golden]!, 'the golden before any hover');

  // Live: the card leans toward the pointer at (0.9, 0.5) of its bounds.
  const snapshot = r[live]!['snapshot'];
  const sha = typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot) ? snapshot['sha256'] : undefined;
  if (r[live]!['code'] === 'unsupported_platform') inconclusive("the panel's live view reports unsupported_platform");
  expect(typeof sha, `the live view's snapshot: ${show(r[live], 600)}`).toBe('string');
  const l = decodePng(getEvidence(ev, sha as string, 'the live view'));
  const over = `with the pointer at ${point(CARD_HOVER)}, (0.9, 0.5) of the card's bounds (the scope's hover: ${show(stateOf(r[hovered]!, 'the scope after the move')['hover'])})`;
  if (!same(at(l, CARD_PROBES.toward), card)) failures.push(`the live view ${over} shows ${show(at(l, CARD_PROBES.toward))} at ${point(CARD_PROBES.toward)}, not the card's ${show(card)}: the item card doesn't lean ${CARD_TILT}° toward the pointer`);
  if (!same(at(l, CARD_PROBES.flat), page)) failures.push(`the live view ${over} shows ${show(at(l, CARD_PROBES.flat))} at ${point(CARD_PROBES.flat)}, not the page's ${show(page)}: the item card's top right corner hasn't swung away`);
  if (!same(at(l, CARD_PROBES.away), page)) failures.push(`the live view ${over} shows ${show(at(l, CARD_PROBES.away))} at ${point(CARD_PROBES.away)}, not the page's ${show(page)}: the item card leans away from the pointer`);

  // The golden after the hover, and every exported frame: hover_at reads (−1, −1), so the card lies flat.
  flat(evalImage(ev, r[goldenAfter]!, 'the golden after the hover'), 'the golden after the hover');
  reads(r[goldenAfter]!, 'the golden after the hover');
  const e = r[exported]!;
  if (e['outcome'] !== 'exported') failures.push(`the export is ${String(e['outcome'])}: ${show(e, 800)}`);
  const files = e['outcome'] === 'exported' ? readdirSync(out).filter((f) => f.toLowerCase().endsWith('.png')).sort() : [];
  if (e['outcome'] === 'exported' && files.length === 0) failures.push('the export wrote no frame');
  files.forEach((f, k) => flat(decodePng(readFileSync(join(out, f))), `export frame ${k}`));
  return { failures, exported: files.length };
}

describe(`${ID} hover_at is viewer state: a card tilts toward the pointer live, and goldens, exports and logic never see it`, () => {
  it(`${ID} the card whose tilt driver reads hover_at tilts toward a hover at (0.9, 0.5) of its bounds live, while its golden and its export draw it flat, since hover_at reads (−1, −1) there`, () => {
    guards();
    none(judge().failures, 'the card live, in its golden and in its export');
  }, TIMEOUT);

  it(`${ID} a logic item that reads hover_at, directly or through a driver, is refused at check, naming the item`, () => {
    const ev = join(dir(), 'evidence');
    mkdirSync(ev);
    const program = tickerProgram();
    putEvidence(ev, program.bytes);
    const s = new Show();
    const plain = s.present(DOC(41), cardDoc('card-logic-plain', { program, reads: [] }));
    const direct = s.present(DOC(42), cardDoc('card-logic-direct', { program, reads: ['hover_at(card)'] }));
    const byDriver = s.present(DOC(43), cardDoc('card-logic-driver', { program, reads: ['drivers/tilt'] }));
    const byPath = s.present(DOC(44), cardDoc('card-logic-path', { program, reads: [TILT_PATH] }));
    const r = runShow(bin('deep-show'), showScenario(ev, [DOC(41), DOC(42), DOC(43), DOC(44)], s.calls, RECT), 'AC4 the logic reads');
    presented(r[plain]!, 'the card with its drivers over hover_at and a logic item that reads nothing');
    refusedNamingItem(r[direct]!, 'peek', 'a logic item that reads hover_at(card) directly');
    refusedNamingItem(r[byDriver]!, 'peek', 'a logic item whose read names the driver tilt, which reads hover_at(card)');
    refusedNamingItem(r[byPath]!, 'peek', `a logic item whose read names ${TILT_PATH}, the path the driver tilt writes from hover_at(card)`);
  }, TIMEOUT);

  it(`${ID} the planted export that keeps the live hover tilts the card and fails the golden, naming the item`, () => {
    guards();
    const twin = judge('export_keeps_live_hover_at');
    expect(twin.exported, 'the planted export writes its frames').toBeGreaterThan(0);
    failsNaming(twin.failures, [/^export frame \d+ /, /the item card/], 'the export under export_keeps_live_hover_at');
  }, TIMEOUT);
});
