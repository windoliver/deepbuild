// The state-source@1 kit (#67): what a workspace touches. A read of a host or an account can be held to a kit only on a
// fixture of its own, so every source brings one, and only the kit calls it. For each change the fixture offers, on a
// fresh fixture: a read, the change made, a read that must show it, a compare that must name it, then the source's
// undo. A `cannot` ends the case, an honest answer; a plan is carried out on the fixture and a last read must match the
// first, so a change called undoable is one that was undone.
import type { JsonValue } from '@deepbuild/contracts';
import { fail } from '../slot-types.js';
import type { Fixture, PlantedFill, SlotCase, SlotFill, SlotKitImpl, SlotRule } from '../slot-types.js';
import { list, object, same, text } from './shared.js';

const STATE_SOURCE = 'state-source@1';

/** One thing a source reads, and its value now. */
export interface StateItem { id: string; value: JsonValue }
/** What differs from what's expected; `changed` is empty when the item holds it. */
export interface StateDiff { item: string; changed: { what: string; was: JsonValue; now: JsonValue }[] }
export interface StateChange { id: string; item: string; was: JsonValue; to: JsonValue }
/** A plan as the asks core takes one: its steps, and the digest of the diff they show. */
export interface StatePlan { steps: { does: string; changes: string[]; undo: string | null; public: boolean; cost: number }[]; diff: string }
export type StateUndo = { plan: StatePlan } | { cannot: string };
export interface StateFixture {
  /** A fresh fixture: read, compare and undo answer from it from now on. Answers the changes to try. */
  start(): StateChange[] | Promise<StateChange[]>;
  /** The world makes this change to the fixture. */
  make(change: StateChange): void | Promise<void>;
  /** Carries out the plan undo gave for this change, on the fixture. */
  run(change: StateChange, plan: StatePlan): void | Promise<void>;
}
export interface StateSource {
  read(): StateItem[] | Promise<StateItem[]>;
  compare(item: StateItem, expected: JsonValue): StateDiff | Promise<StateDiff>;
  undo(change: StateChange): StateUndo | Promise<StateUndo>;
  fixture: StateFixture;
}
export interface StateSourceFill extends SlotFill, StateSource { slot: 'state-source@1'; name: string }

const RULES = {
  fresh: { id: 'read-is-now', rule: "read answers what the thing is now: a change to the fixture shows in the next read, naming its item.", message: 'read answered an old value' },
  named: { id: 'compare-names-the-change', rule: 'compare names what differs from what is expected.', message: 'compare named no change' },
  undone: { id: 'undoable-means-undone', rule: 'A change a source calls undoable is undone on the fixture: its plan runs and the next read is the first.', message: 'called a change undoable and its undo failed' },
};
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));

const planFor = (change: StateChange): StatePlan => ({ steps: [{ does: `Set ${change.item} back to ${String(change.was)}`, changes: [change.item], undo: `Set ${change.item} to ${String(change.to)}`, public: false, cost: 0 }], diff: '0'.repeat(64) });
const CHANGES: StateChange[] = [{ id: 'set-level', item: 'level', was: 1, to: 2 }, { id: 'drop-log', item: 'log', was: 'kept', to: 'dropped' }];

type Fault = 'none' | 'undo-fails' | 'first-read-kept' | 'compare-sees-nothing';
/** A small world in memory: `level` can be set back, a dropped `log` has no copy. */
function reference(fault: Fault = 'none'): StateSourceFill {
  let world: Record<string, JsonValue> = {};
  let first: StateItem[] | undefined;
  return {
    slot: STATE_SOURCE, revision: 1, name: 'reference',
    read() {
      const now = Object.entries(world).map(([id, value]) => ({ id, value }));
      if (fault !== 'first-read-kept') return now;
      return (first ??= now);
    },
    compare: (item, expected) => ({ item: item.id, changed: fault === 'compare-sees-nothing' || same(item.value, expected) ? [] : [{ what: item.id, was: expected, now: item.value }] }),
    undo: (change) => (change.id === 'drop-log' && fault !== 'undo-fails' ? { cannot: 'a dropped log has no copy' } : { plan: planFor(change) }),
    fixture: {
      start() { world = { level: 1, log: 'kept' }; return CHANGES; },
      make(change) { world[change.item] = change.to; },
      run(change) { if (!(fault === 'undo-fails' && change.id === 'drop-log')) world[change.item] = change.was; },
    },
  };
}

const plant = (name: string, breaks: keyof typeof RULES, codes: string[], fill: StateSourceFill): PlantedFill<StateSourceFill> => ({ name, message: RULES[breaks].message, codes, breaks: RULES[breaks].id, fill });
const plantedFills = (): PlantedFill<StateSourceFill>[] => [
  plant('undo-fails', 'undone', ['undo_failed'], reference('undo-fails')),
  plant('first-read-kept', 'fresh', ['read_is_old'], reference('first-read-kept')),
  plant('compare-sees-nothing', 'named', ['no_diff'], reference('compare-sees-nothing')),
];

const fixtures: Fixture[] = [{ id: 'every-change', input: null, expected: null }];
const items = (what: string, value: unknown): StateItem[] => list(what, value).map((i) => { const o = object('an item', i); return { id: text("an item's id", o.id), value: o.value as JsonValue }; });
/** `call`'s throw or rejection as a value, so a judge can name what threw; null when it ended. */
function caught(call: () => unknown): { threw: unknown } | null | Promise<{ threw: unknown } | null> {
  try {
    const out = call();
    return out instanceof Promise ? out.then(() => null, (threw: unknown) => ({ threw })) : null;
  } catch (threw) {
    return { threw };
  }
}
const valueOf = (read: StateItem[], id: string): JsonValue | undefined => read.find((i) => i.id === id)?.value;

function* judge(fill: StateSourceFill, _case: SlotCase): Generator<() => unknown, void, unknown> {
  // Each change on a fresh fixture, so one a source can't undo leaves nothing behind for the next.
  const changes = list('start', yield () => fill.fixture.start()) as StateChange[];
  for (const [i, change] of changes.entries()) {
    if (i) yield () => fill.fixture.start();
    const first = items('read', yield () => fill.read());
    yield () => fill.fixture.make(structuredClone(change));
    const after = items('read', yield () => fill.read());
    if (same(valueOf(after, change.item), valueOf(first, change.item))) {
      throw fail(RULES.fresh.message, ['read_is_old'], `${change.item} still reads ${JSON.stringify(valueOf(after, change.item))} after ${change.id} set it to ${JSON.stringify(change.to)}`);
    }
    const item: StateItem = after.find((x) => x.id === change.item) ?? { id: change.item, value: null };
    const diff = object('compare', yield () => fill.compare(structuredClone(item), valueOf(first, change.item) ?? null));
    if (!list("compare's changed", diff.changed).length) throw fail(RULES.named.message, ['no_diff'], `${change.item} changed from ${JSON.stringify(valueOf(first, change.item))} and compare said nothing did`);
    const undo = object('undo', yield () => fill.undo(structuredClone(change)));
    if (typeof undo.cannot === 'string') continue;
    const plan = object("undo's plan", undo.plan) as unknown as StatePlan;
    // A plan that throws is a failed undo, not a broken fill: the failure names the change.
    const ran = (yield () => caught(() => fill.fixture.run(structuredClone(change), plan))) as { threw: unknown } | null;
    if (ran) throw fail(RULES.undone.message, ['undo_failed'], `${change.id}: its plan threw ${String((ran.threw as Error)?.message ?? ran.threw)}`);
    const last = items('read', yield () => fill.read());
    if (!same(last, first)) throw fail(RULES.undone.message, ['undo_failed'], `${change.id}: after its plan ran, ${change.item} reads ${JSON.stringify(valueOf(last, change.item))}, not ${JSON.stringify(valueOf(first, change.item))}`);
  }
}

export const stateSourceKit = (): SlotKitImpl<StateSourceFill> => ({
  slot: STATE_SOURCE, fills: 'many', revision: 1, rules, fixtures, planted: plantedFills(),
  clean: () => [reference()], generate: () => [], judge,
});
