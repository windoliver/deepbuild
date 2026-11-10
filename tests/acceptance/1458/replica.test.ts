// AC1, AC4, AC7, AC8, AC9, AC10, AC11 and AC12: what the shipped pages draw, read from the replica's snapshot (README,
// Pinned 1 to 3) over the fixture record, and each planted wrong program the criterion names failing the same judge.
// Each plant's test holds the clean run to the judge first, so a program that already fails can't make its plant look
// caught; a plant the build ignores fails as "wasn't caught".
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC, CANVAS_FACE, CARD, CHECKOUT, CHOICE, CODE_FACE, HEADER, NEEDS_YOU, OPENING, SESSION_PAGE, SIDEBAR, SYSTEM_FACES, BATCH,
  cleanup, faceFailures, fitFailures, flat, launched, lookGuard, moments, renderPages, runsIn, runsOf, shippedPages, sizeFailures,
  stillFailures, stringsOf, switchFailures, tickFailures, timeWordFailures, driveBinaries, MINUTES, type Page, type Snapshot,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const T = 120 * MINUTES;

let reference: Promise<Page[]> | undefined;
/** Every shipped page and the card at the reference window, light: the clean run several criteria read. */
const pages = (): Promise<Page[]> => (reference ??= renderPages());
const caught = (failures: readonly string[], ...words: string[]): boolean => failures.some((f) => words.every((w) => f.includes(w)));

describe('#1458 what the shipped pages draw', () => {
  it(`${AC.sizes}: every string the shipped pages draw is 11, 13 or 15 pt; a planted view with a fourth size fails, naming the view and the size`, async () => {
    expect.soft(sizeFailures(await pages()), 'every string drawn is one of the three sizes').toEqual([]);
    const planted = sizeFailures(await renderPages({ plant: 'fourth-text-size', only: [SESSION_PAGE] }));
    expect(caught(planted, SESSION_PAGE, '17'), `the planted 17 pt title on ${SESSION_PAGE} wasn't caught: ${JSON.stringify(planted)}`).toBe(true);
  }, T);

  it(`${AC.fits}: every shipped page at 960×640 has no clipped text and nothing wider than its pane; a planted 600 pt wide element fails, naming the element and the window`, async () => {
    const size = OPENING;
    expect.soft(fitFailures(await renderPages({ size })), 'every page at 960×640').toEqual([]);
    const planted = fitFailures(await renderPages({ size, plant: 'list-600pt-element', only: [NEEDS_YOU] }));
    expect(caught(planted, 'planted-wide', '960×640'), `the planted 600 pt element wasn't caught: ${JSON.stringify(planted)}`).toBe(true);
  }, T);

  it(`${AC.face}: every chrome string draws in the chrome face, named in the clean look; a planted label in the canvas face on a row fails, naming the view`, async () => {
    const [clean] = await lookGuard([{ look: 'clean' }]);
    const fonts = clean?.look?.chrome_fonts as { text?: unknown; code?: unknown } | undefined;
    expect(fonts, `the clean look names the chrome's faces as chrome_fonts {text, code} (README, Pinned 5); its keys: ${Object.keys(clean?.look ?? {}).join(', ')}`).toBeTypeOf('object');
    expect(fonts!.code, 'the chrome face for code').toBe(CODE_FACE);
    expect(SYSTEM_FACES, `the chrome face for text is the system face, not ${JSON.stringify(fonts!.text)}`).toContain(fonts!.text);
    const faces = [String(fonts!.text), CODE_FACE];
    expect.soft(faceFailures(await pages(), faces), 'every string drawn in the chrome face').toEqual([]);
    const planted = faceFailures(await renderPages({ plant: 'row-label-canvas-face', only: [NEEDS_YOU] }), faces);
    expect(caught(planted, SIDEBAR, CANVAS_FACE), `the planted row label in ${CANVAS_FACE} wasn't caught: ${JSON.stringify(planted)}`).toBe(true);
  }, T);

  it(`${AC.tick}: a time ticking from 9 s to 10 s moves no other glyph in its row`, async () => {
    const tick = async (plant?: string): Promise<string[]> => {
      const drive = await launched({ center: NEEDS_YOU, plant });
      try {
        const before = await drive.see();
        await drive.wait(1000);
        return tickFailures(before, await drive.see(), `session:${CHECKOUT}`);
      } finally {
        await drive.stop();
      }
    };
    expect.soft(await tick(), '"Checkout page"\'s row as its time ticks').toEqual([]);
    const planted = await tick('time-flows-inline');
    expect(caught(planted, 'moved'), `the planted row whose time pushes its neighbours wasn't caught: ${JSON.stringify(planted)}`).toBe(true);
  }, T);

  it(`${AC.tooltip}: a kit tooltip on a shipped page draws in one of the three sizes`, async () => {
    /** Hovers each control with an id on each page until the kit shows tooltips; each tooltip's strings, as a page. */
    const tooltips = async (plant?: string): Promise<{ shown: Page[]; hovered: number }> => {
      const shown: Page[] = [];
      let hovered = 0;
      for (const page of await shippedPages((await driveBinaries()).plain)) {
        const drive = await launched({ center: page, plant });
        try {
          const seen = await drive.see();
          const controls = flat(seen.tree).filter((n) => n.id && ['button', 'switch', 'check_box', 'link', 'tab', 'menu_item', 'image'].includes(n.role)).slice(0, 12);
          for (const control of controls) {
            hovered += 1;
            const reply = await drive.call({ call: 'act', locator: { id: control.id }, act: { kind: 'hover' } });
            if (!reply.ok) continue;
            await drive.wait(2000);
            const s = await drive.see();
            const tips = flat(s.tree).filter((n) => n.role === 'tooltip');
            const runs = runsOf(s);
            for (const tip of tips) shown.push({ page: `${page}, hovering ${control.id}`, snapshot: { ...s, runs: typeof runs === 'string' ? runs : runsIn(runs, tip.bounds) } as Snapshot });
            if (tips.length) break;
          }
        } finally {
          await drive.stop();
        }
      }
      return { shown, hovered };
    };
    const clean = await tooltips();
    expect(clean.shown.length, `a kit tooltip shows on some shipped page after hovering ${clean.hovered} of their controls`).toBeGreaterThan(0);
    expect.soft(sizeFailures(clean.shown), 'every tooltip\'s strings').toEqual([]);
    const planted = sizeFailures((await tooltips('tooltip-kit-size')).shown);
    expect(caught(planted, '14 pt'), `the planted tooltip at the kit's own 14 pt wasn't caught: ${JSON.stringify(planted)}`).toBe(true);
  }, T);

  it(`${AC.still}: a planted 250 ms transition on a page change fails, naming the view`, async () => {
    const change = async (plant?: string): Promise<string[]> => {
      const drive = await launched({ center: NEEDS_YOU, plant });
      try {
        await drive.must({ call: 'motion', motion: { action: 'start' } });
        await drive.must({ call: 'act', locator: { id: `session:${HEADER}` }, act: { kind: 'click' } });
        await drive.wait(1000);
        return stillFailures((await drive.must({ call: 'motion', motion: { action: 'stop' } })).recording as Record<string, any>);
      } finally {
        await drive.stop();
      }
    };
    expect.soft(await change(), 'opening "Header layout"\'s page from the list snaps').toEqual([]);
    const planted = await change('page-fades-250ms');
    expect(caught(planted, SESSION_PAGE), `the planted 250 ms fade on ${SESSION_PAGE} wasn't caught: ${JSON.stringify(planted)}`).toBe(true);
  }, T);

  it(`${AC.time}: no row reads "… ago" or "in …", a planted one fails naming the string, and an ask's row, card and notification show one moment in one form`, async () => {
    /** The strings of every page and the card, and the notifications posted 3 s into a replica on Needs you. */
    const shownAll = async (plant?: string): Promise<{ failures: string[]; seen: Page[]; notified: string[] }> => {
      const seen = plant ? await renderPages({ plant, only: [NEEDS_YOU] }) : await pages();
      const drive = await launched({ center: NEEDS_YOU, plant });
      let notified: string[] = [];
      try {
        await drive.wait(3000);
        const closed = await drive.must({ call: 'close' });
        const trace = JSON.parse(readFileSync(String(closed.trace?.path), 'utf8')) as { notifications?: { ask?: string; text?: string }[] };
        notified = (trace.notifications ?? []).filter((n) => n.ask === CHOICE.handle).map((n) => String(n.text));
      } finally {
        await drive.stop();
      }
      const failures = [...seen.flatMap((p) => timeWordFailures(p.page, stringsOf(p.snapshot))), ...timeWordFailures('its notification', notified)];
      return { failures, seen, notified };
    };
    const clean = await shownAll();
    expect.soft(clean.failures, 'no string reads a time as "… ago" or "in …"').toEqual([]);
    // One moment in one form: the ask's row on Needs you, its card and its notification each name 12:00 and nothing else.
    const page = clean.seen.find((p) => p.page === NEEDS_YOU)!.snapshot;
    const card = clean.seen.find((p) => p.page === CARD)!.snapshot;
    const textIn = (s: Snapshot, id: string): string => {
      const node = flat(s.tree).find((n) => n.id === id);
      if (!node) return '';
      const runs = runsOf(s);
      return [...flat(node).map((n) => n.name ?? ''), ...(typeof runs === 'string' ? [] : runsIn(runs, node.bounds).map((r) => r.text))].join(' · ');
    };
    const said = { row: textIn(page, CHOICE.handle), card: textIn(card, 'question-card'), notification: clean.notified.join(' · ') };
    const momentFailures = Object.entries(said).flatMap(([where, text]) => {
      const found = [...new Set(moments(text))];
      return found.length === 1 && found[0] === CHOICE.moment ? [] : [`the ask's ${where} names ${found.length ? JSON.stringify(found) : 'no moment'}, not ${CHOICE.moment} alone, in ${JSON.stringify(text.slice(0, 300))}`];
    });
    expect.soft(momentFailures, 'the ask\'s row, card and notification show one moment in one form').toEqual([]);
    for (const [plant, words] of [['row-says-ago', '2 min ago'], ['row-says-in', 'in 4 h']] as const) {
      const planted = (await shownAll(plant)).failures;
      expect.soft(caught(planted, words), `the planted row reading "${words}" wasn't caught: ${JSON.stringify(planted)}`).toBe(true);
    }
  }, T);

  it(`${AC.switch}: a step's switch on a card has the switch role with its state as a value; a planted switch whose state is a word in its label fails, naming it`, async () => {
    const card = async (plant?: string): Promise<string[]> => {
      const drive = await launched({ center: NEEDS_YOU, plant });
      try {
        await drive.must({ call: 'act', locator: { id: BATCH.handle }, act: { kind: 'click' } });
        await drive.wait(500);
        return switchFailures(await drive.see());
      } finally {
        await drive.stop();
      }
    };
    expect.soft(await card(), `the steps on "${BATCH.question}"'s card`).toEqual([]);
    const planted = await card('step-state-in-label');
    expect(caught(planted, 'says its state as a word'), `the planted switch with its state in its label wasn't caught: ${JSON.stringify(planted)}`).toBe(true);
  }, T);
});
