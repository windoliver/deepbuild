// The panel@1 kit (#349): a plug-in's view drawn headless. A panel declares what it needs, and draws an element
// tree for a frame, given the question card's place and whether your gesture is in it: it never asks for the
// network or a program, draws only inside its frame, never over the question card, and moves focus or shows a
// toast only right after your gesture there. The app's panel runtime holds the same rules live (#35); this kit
// is what an extension's tests and the install run on the panel's draw alone, with no app.
import type { JsonValue } from '@deepbuild/contracts';
import type { Random } from '../generator.js';
import { fail } from '../slot-types.js';
import type { Fixture, PlantedFill, SlotCase, SlotFill, SlotKitImpl, SlotRule } from '../slot-types.js';
import { list, object } from './shared.js';

export const PANEL = 'panel@1';

export interface Rect { x: number; y: number; w: number; h: number }
/** What a draw sees: the panel's frame, the question card's place or null when none shows, and your gesture's serial in the panel or null. */
export interface Frame { frame: Rect; card: Rect | null; gesture: number | null }
export interface Element { kind: string; x: number; y: number; w: number; h: number }
/** What a draw gives: its elements, in the frame's coordinates, and whether it takes focus or toasts now. */
export interface Drawn { elements: Element[]; focus: boolean; toast: boolean }
export interface PanelFill extends SlotFill {
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
};
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));
const FORBIDDEN: Record<string, keyof typeof RULES> = { network: 'network', programs: 'programs' };

const within = (e: Element, r: Rect): boolean => e.x >= r.x && e.y >= r.y && e.x + e.w <= r.x + r.w && e.y + e.h <= r.y + r.h;
const overlaps = (e: Element, r: Rect): boolean => e.x < r.x + r.w && e.x + e.w > r.x && e.y < r.y + r.h && e.y + e.h > r.y;

type Fault = 'none' | 'network' | 'program' | 'focus' | 'outside' | 'card';
/** The reference panel: a title and a list that fill the frame but step around the card; focus only on a gesture. */
function reference(fault: Fault = 'none'): PanelFill {
  return {
    slot: PANEL, revision: 1, name: 'reference', area: 'sidebar',
    needs: fault === 'network' ? ['record', 'network'] : fault === 'program' ? ['record', 'programs'] : ['record'],
    draw({ frame, card, gesture }) {
      const title: Element = { kind: 'text', x: frame.x, y: frame.y, w: frame.w, h: 20 };
      const body: Element = { kind: 'list', x: frame.x, y: frame.y + 20, w: frame.w, h: frame.h - 20 };
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
}

export const panelKit = (): SlotKitImpl<PanelFill> => ({
  slot: PANEL, fills: 'many', revision: 1, rules, fixtures, planted: plantedFills(),
  clean: () => [reference()], generate, judge,
});
