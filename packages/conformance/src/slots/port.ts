// The port@1 kit (#2793): a piece's port to one plug-in. A fill is the port once a person's Connect has opened it:
// `entries` and `rows` are what the piece lists, and `send` is asked at each moment of the piece what goes out to
// the plug-in. The kit holds the slot's rule about what a port sends and when: what the piece lists, and nothing
// else, goes out as it plays live, and a seek, a replay or an export sends nothing. Its cases name no entry: each
// offers every name the fill lists and one it doesn't, so a port with other lists is held to the same rule.
import type { JsonValue } from '@deepbuild/contracts';
import type { Random } from '../generator.js';
import { fail } from '../slot-types.js';
import type { Fixture, PlantedFill, SlotCase, SlotFill, SlotKitImpl, SlotRule } from '../slot-types.js';
import { list, same, word } from './shared.js';

const PORT = 'port@1';

/** How the piece reached a moment: playing live, or a seek, a replay or an export passing over it. */
type Play = 'live' | 'seek' | 'replay' | 'export';
/** One moment of the piece: how it was reached, and the entry or occurrence row it holds. */
interface Moment { play: Play; name: string; value: JsonValue }
/** A case: how the moment is reached and the value it holds; the judge offers it once for each name the fill lists and once for a name it doesn't. */
interface Input { play: Play; value: JsonValue }
export interface PortFill extends SlotFill {
  slot: 'port@1';
  name: string;
  entries: string[];
  rows: string[];
  /** What goes out to the plug-in at this moment: each `{name, value}` sent, or none. */
  send(moment: Moment): { name: string; value: JsonValue }[];
}

const RULE = { id: 'live-only', rule: 'A port sends what the piece lists, and nothing else, as it plays live; a seek, a replay or an export sends nothing.', message: 'sent other than what the piece lists as it plays live' };
const rules: SlotRule[] = [{ id: RULE.id, rule: RULE.rule }];

/** The reference port of a piece that lists one entry and one occurrence row; `fault` is the play it wrongly sends on. */
const reference = (fault?: Play): PortFill => {
  const entries = ['tempo'];
  const rows = ['beats'];
  return {
    slot: PORT, revision: 1, name: 'lights', entries, rows,
    send: ({ play, name, value }) => ((play === 'live' || play === fault) && [...entries, ...rows].includes(name) ? [{ name, value }] : []),
  };
};

const plantedFills = (): PlantedFill<PortFill>[] => [
  { name: 'sends-on-seek', message: RULE.message, codes: ['sent_not_listed_live'], breaks: RULE.id, fill: reference('seek') },
];

const toCase = (id: string, part: 'fixed' | 'seeded', input: Input): SlotCase => ({ id, part, input: input as unknown as JsonValue, expected: null });
const cases: SlotCase[] = [
  toCase('live', 'fixed', { play: 'live', value: { t: 2, key: 'kick' } }),
  toCase('seek', 'fixed', { play: 'seek', value: 90 }),
  toCase('replay', 'fixed', { play: 'replay', value: 90 }),
  toCase('export', 'fixed', { play: 'export', value: 90 }),
];
const fixtures: Fixture[] = cases.map(({ id, input, expected }) => ({ id, input, expected }));

/** One value from the draw, live and then passed over by a seek. */
const generate = (random: Random): SlotCase[] => {
  const value = `${word(random, 5)}${random.int(0, 99)}`;
  return [toCase('seeded-live', 'seeded', { play: 'live', value }), toCase('seeded-seek', 'seeded', { play: 'seek', value })];
};

function* judge(fill: PortFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const { play, value } = c.input as unknown as Input;
  const listed = [...fill.entries, ...fill.rows];
  for (const name of [...listed, `unlisted.${listed.join('.')}`]) {
    const expected = play === 'live' && listed.includes(name) ? [{ name, value }] : [];
    const sent = list('what the port sent', yield () => fill.send({ play, name, value }));
    if (!same(sent, expected)) throw fail(RULE.message, ['sent_not_listed_live'], `${fill.name} sent ${JSON.stringify(sent)} for ${name} in ${c.id}, which expects ${JSON.stringify(expected)}`);
  }
}

export const portKit = (): SlotKitImpl<PortFill> => ({
  slot: PORT, fills: 'many', revision: 1, rules, fixtures, planted: plantedFills(),
  clean: () => [reference()], generate, judge,
});
