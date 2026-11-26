// The panel@1 kit (#349): a plug-in's view drawn headless. A panel declares what it needs, and draws an element
// tree for a frame, given the question card's place and whether your gesture is in it: it never asks for the
// network or a program, draws only inside its frame, never over the question card, and moves focus or shows a
// toast only right after your gesture there. The app's panel runtime holds the same rules live (#35); this kit
// is what an extension's tests and the install run on the panel's draw alone, with no app. Revision 2 (#3233) holds
// what a person can read and reach: an element that takes a press or text has a name, text whose color the panel
// set clears the look's ink floor on the fill under it, and every press has a key.
import type { JsonValue } from '@deepbuild/contracts';
import type { Random } from '../generator.js';
import { fail } from '../slot-types.js';
import type { Fixture, PlantedFill, SlotCase, SlotFill, SlotKitImpl, SlotRule } from '../slot-types.js';
import { list, object } from './shared.js';

const PANEL = 'panel@1';

interface Rect { x: number; y: number; w: number; h: number }
/** What a draw sees: the panel's frame, the question card's place or null when none shows, and your gesture's serial in the panel or null. */
interface Frame { frame: Rect; card: Rect | null; gesture: number | null }
/**
 * One drawn element. From revision 2 it also says the text it shows and its label; its text's color and its own fill
 * as `#rrggbb`, where the panel set them; whether it takes a press or text; and how many times Enter or Space runs
 * its press once it has keyboard focus, absent when it can't take focus.
 */
interface Element { kind: string; x: number; y: number; w: number; h: number; text?: string; label?: string; ink?: string; fill?: string; takes?: 'press' | 'text'; keys?: number }
/** What a draw gives: its elements, in the frame's coordinates, and whether it takes focus or toasts now. */
interface Drawn { elements: Element[]; focus: boolean; toast: boolean }
interface PanelFill extends SlotFill {
  slot: 'panel@1';
  name: string;
  area: string;
  /** The access words it needs; `network` and `programs` are never granted to a panel. */
  needs: string[];
  draw(frame: Frame): Drawn;
}
type Input = Frame;

const RULES = {
  network: { id: 'no-network', rule: 'A panel never reaches the network: its needs never name it.', message: 'asks for the network' },
  programs: { id: 'no-programs', rule: 'A panel never runs a program: its needs never name one.', message: 'asks to run a program' },
  focus: { id: 'focus-on-gesture', rule: 'A panel moves focus, or shows a toast, only right after your gesture in it.', message: 'moved focus or toasted without your gesture' },
  inside: { id: 'inside-its-panel', rule: 'Every element a panel draws lies inside its frame.', message: 'drew outside its panel' },
  card: { id: 'never-over-the-card', rule: 'No element a panel draws covers the question card.', message: 'drew over the question card' },
  name: { id: 'names-what-it-presses', rule: "Names what it presses. Every element that takes a press or text has a name: its own text, the text under it, or its label. A name that is only its kind's word counts as none.", message: 'took a press or text with no name' },
  contrast: { id: 'reads-on-its-fill', rule: "Reads on its fill. Text whose color the panel set clears 4.5:1 against the nearest fill under it. Where the panel set no fill there, it is the shipped look's ground and raised, in light and dark, and the worse pair decides.", message: 'drew text under the ink floor' },
  key: { id: 'reaches-by-key', rule: 'Reaches by key. Every element that takes a press can take keyboard focus, and Enter or Space on it runs the same handler once.', message: 'took a press no key reaches' },
};
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));
const FORBIDDEN: Record<string, keyof typeof RULES> = { network: 'network', programs: 'programs' };

const within = (e: Element, r: Rect): boolean => e.x >= r.x && e.y >= r.y && e.x + e.w <= r.x + r.w && e.y + e.h <= r.y + r.h;
const overlaps = (e: Element, r: Rect): boolean => e.x < r.x + r.w && e.x + e.w > r.x && e.y < r.y + r.h && e.y + e.h > r.y;

/** The look's ink floor, and the shipped look's ground and raised in each theme (crates/deep-canvas-marks/looks/clean.json). */
const FLOOR = 4.5;
const LOOK = { light: { ground: '#ffffff', raised: '#f5f5f6' }, dark: { ground: '#040405', raised: '#0d0e10' } };
/** WCAG relative luminance of a `#rrggbb` color, or null when it isn't one. */
function luminance(color: string): number | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) return null;
  const [r, g, b] = m.slice(1).map((hex) => { const c = parseInt(hex, 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** The worst pair a text is read on: its ink on the fill under it, the panel's or, where it set none, the look's in each theme. */
function worstPair(ink: string, fill: string | undefined): { ink: string; fill: string; where: string; ratio: number | null } {
  const pairs = fill !== undefined ? [{ ink, fill, where: '' }]
    : (['light', 'dark'] as const).flatMap((theme) => (['ground', 'raised'] as const).map((role) => ({ ink, fill: LOOK[theme][role], where: ` (the look's ${role} in ${theme})` })));
  const read = pairs.map((pair) => {
    const [a, b] = [luminance(pair.ink), luminance(pair.fill)];
    return { ...pair, ratio: a === null || b === null ? null : (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
  });
  // A color that can't be read can't clear the floor, so it comes first.
  return read.sort((x, y) => (x.ratio ?? 0) - (y.ratio ?? 0))[0]!;
}

type Fault = 'none' | 'network' | 'program' | 'focus' | 'outside' | 'card' | 'name' | 'contrast' | 'pointer';
/**
 * The reference panel: a title and a list that fill the frame but step around the card; focus only on a gesture. The
 * title sets its own ink and fill, and the list takes a press under its own name, which Enter or Space runs once.
 */
function reference(fault: Fault = 'none'): PanelFill {
  return {
    slot: PANEL, revision: 2, name: 'reference', area: 'sidebar',
    needs: fault === 'network' ? ['record', 'network'] : fault === 'program' ? ['record', 'programs'] : ['record'],
    draw({ frame, card, gesture }) {
      const title: Element = { kind: 'text', x: frame.x, y: frame.y, w: frame.w, h: 20, text: 'Reference', ink: fault === 'contrast' ? '#9a9a9a' : '#595959', fill: '#ffffff' };
      const body: Element = { kind: 'list', x: frame.x, y: frame.y + 20, w: frame.w, h: frame.h - 20, text: fault === 'name' ? 'list' : 'Rows', takes: 'press', ...(fault === 'pointer' ? {} : { keys: 1 }) };
      // The card wins: a body the card would cover stops above it, and everything moves below a card on top.
      if (card && fault !== 'card') {
        if (overlaps(title, card)) {
          title.y = card.y + card.h;
          body.y = title.y + 20;
          body.h = Math.max(0, frame.y + frame.h - body.y);
        } else if (overlaps(body, card)) {
          const above = card.y - body.y;
          if (above >= 10) body.h = above;
          else { body.y = card.y + card.h; body.h = Math.max(0, frame.y + frame.h - body.y); }
        }
      }
      if (fault === 'outside') body.w = frame.w + 8;
      const elements = [title, body].filter((e) => e.h > 0 && e.w > 0);
      const asked = gesture !== null;
      return { elements, focus: fault === 'focus' ? true : asked, toast: asked };
    },
  };
}

const plant = (name: string, breaks: keyof typeof RULES, codes: string[], fill: PanelFill): PlantedFill<PanelFill> => ({ name, message: RULES[breaks].message, codes, breaks: RULES[breaks].id, fill });
const plantedFills = (): PlantedFill<PanelFill>[] => [
  plant('reaches-network', 'network', ['panel_network'], reference('network')),
  plant('runs-a-program', 'programs', ['panel_program'], reference('program')),
  plant('moves-focus-unasked', 'focus', ['focus_unasked'], reference('focus')),
  plant('draws-outside', 'inside', ['outside_panel'], reference('outside')),
  plant('covers-the-card', 'card', ['over_card'], reference('card')),
  plant('presses-with-no-name', 'name', ['no_name'], reference('name')),
  plant('draws-faint-text', 'contrast', ['low_contrast'], reference('contrast')),
  plant('presses-by-pointer-only', 'key', ['pointer_only'], reference('pointer')),
];

const toCase = (id: string, part: 'fixed' | 'seeded', input: Input): SlotCase => ({ id, part, input: input as unknown as JsonValue, expected: null });
const FRAME: Rect = { x: 0, y: 0, w: 320, h: 600 };
// In the order the preflight's check meets them, so each planted fill is refused at its first case.
const fixtures: Fixture[] = [
  toCase('idle-no-card', 'fixed', { frame: FRAME, card: null, gesture: null }),
  toCase('card-over-the-body', 'fixed', { frame: FRAME, card: { x: 40, y: 300, w: 240, h: 200 }, gesture: null }),
  toCase('gesture-in-the-panel', 'fixed', { frame: { x: 100, y: 50, w: 300, h: 400 }, card: null, gesture: 7 }),
  toCase('card-on-top', 'fixed', { frame: FRAME, card: { x: 0, y: 0, w: 320, h: 100 }, gesture: null }),
].map(({ id, input, expected }) => ({ id, input, expected }));

/** Three frames from the draw, a card in two of them, a gesture in one. */
const generate = (random: Random): SlotCase[] => [0, 1, 2].map((i) => {
  const frame: Rect = { x: random.int(0, 200), y: random.int(0, 200), w: random.int(200, 600), h: random.int(300, 900) };
  const card = i === 0 ? null : { x: frame.x + random.int(0, 40), y: frame.y + random.int(40, frame.h - 120), w: Math.min(240, frame.w), h: 100 };
  return toCase(`seeded-${i + 1}`, 'seeded', { frame, card, gesture: i === 2 ? random.int(1, 1000) : null });
});

function* judge(fill: PanelFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const input = c.input as unknown as Input;
  for (const need of fill.needs) {
    const broken = FORBIDDEN[need];
    if (broken) throw fail(RULES[broken].message, [broken === 'network' ? 'panel_network' : 'panel_program'], `${fill.name} needs ${need}`);
  }
  const drawn = object('the draw', yield () => fill.draw(structuredClone(input)));
  const elements = list('draw/elements', drawn.elements).map((e, i) => object(`draw/elements/${i}`, e) as unknown as Element);
  if (input.gesture === null && (drawn.focus === true || drawn.toast === true)) throw fail(RULES.focus.message, ['focus_unasked'], `${fill.name} ${drawn.focus ? 'took focus' : 'toasted'} on a frame with no gesture`);
  for (const e of elements) {
    if (!within(e, input.frame)) throw fail(RULES.inside.message, ['outside_panel'], `${e.kind} at ${e.x},${e.y} ${e.w}x${e.h} leaves the frame ${input.frame.x},${input.frame.y} ${input.frame.w}x${input.frame.h}`);
    if (input.card && overlaps(e, input.card)) throw fail(RULES.card.message, ['over_card'], `${e.kind} at ${e.x},${e.y} ${e.w}x${e.h} covers the card at ${input.card.x},${input.card.y} ${input.card.w}x${input.card.h}`);
  }
  const shown = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  elements.forEach((e, at) => {
    const place = `${e.kind} at ${e.x},${e.y} ${e.w}x${e.h}`;
    if (e.takes === 'press' || e.takes === 'text') {
      const under = elements.filter((o) => o !== e && within(o, e)).map((o) => shown(o.text));
      const names = [shown(e.text), shown(e.label), ...under].filter(Boolean);
      if (!names.some((name) => name.toLowerCase() !== String(e.kind).toLowerCase())) throw fail(RULES.name.message, ['no_name'], names.length ? `${place} is named only "${names[0]}", its kind's word` : `${place} has no text, none under it and no label`);
    }
    if (e.takes === 'press' && e.keys !== 1) throw fail(RULES.key.message, ['pointer_only'], e.keys === undefined ? `${place} can't take keyboard focus` : `Enter or Space on ${place} runs its press ${String(e.keys)} times, not once`);
    if (!shown(e.text) || e.ink === undefined) return;
    // The nearest fill under a text: its own, or the last one drawn before it that holds it.
    const fill = e.fill ?? elements.slice(0, at).reverse().find((o) => o.fill !== undefined && within(e, o))?.fill;
    const worst = worstPair(e.ink, fill);
    if (worst.ratio === null) throw fail(RULES.contrast.message, ['low_contrast'], `${place} draws ${String(worst.ink)} on ${String(worst.fill)}${worst.where}, which isn't #rrggbb, so nothing says it reads`);
    if (worst.ratio < FLOOR) throw fail(RULES.contrast.message, ['low_contrast'], `${place} draws ${worst.ink} on ${worst.fill}${worst.where} at ${worst.ratio.toFixed(2)}:1, under ${FLOOR}:1`);
  });
}

export const panelKit = (): SlotKitImpl<PanelFill> => ({
  slot: PANEL, fills: 'many', revision: 2, rules, fixtures, planted: plantedFills(),
  clean: () => [reference()], generate, judge,
});
