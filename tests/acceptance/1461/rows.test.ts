// AC10, AC19 and AC27: one row anatomy. Every list row is one line of fixed slots (mark, title, then state word and time
// at the right edge), read from the replica's snapshot by the slots' ids (README, Pinned 1). AC10 and AC27 read a copy
// of a real hub's record; AC19 reads #328's fixture, the replica's own default (#338's record, with its held ask).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  askOf, cleanup, headings, ID, listOf, listRows, makeWorld, MIN, px, REPO, Replica, replicaOf, slot, wordsOf,
  type SessionSpec, type Snapshot, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const APPROVAL = 'Push feat/cart to origin?';
const CHOICE = 'Keep the cart on SQLite or plain files?';
const SPECS: SessionSpec[] = [
  { key: 'r1', project: 'shop', title: 'Cart totals', state: 'finished', asks: [{ kind: 'authority', question: APPROVAL }] },
  { key: 'r2', project: 'shop', title: 'Checkout page', state: 'finished', asks: [{ kind: 'choice', question: CHOICE }] },
  { key: 'r3', project: 'shop', title: 'Billing page' },
  { key: 'r4', project: 'docs', title: 'Release notes', state: 'finished' },
  { key: 'r5', project: 'docs', title: 'API guide', state: 'failed' },
];
let world: World;
beforeAll(async () => { world = await makeWorld(SPECS); }, 10 * MIN);
const pt = (v: number): string => `${v / 2} pt`;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;

/** AC10: each row 32 tall, inset 8 in the list; mark 16 at the row's inset with 8 after it; state word then a time at least 32, at the right edge; headings 32 with 8 above; no gap between rows. */
function slotFailures(s: Snapshot): string[] {
  const list = listOf(s);
  if (!list) return ['the window has no list (a node with id "list")'];
  const rows = listRows(s);
  if (!rows.length) return ['the list draws no rows with ids'];
  const [lx, , lw] = list.bounds as [number, number, number];
  const out: string[] = [];
  for (const row of rows) {
    const id = String(row.id);
    const [x, y, w, h] = row.bounds as [number, number, number, number];
    if (!near(h, px(32))) out.push(`row ${id} is ${pt(h)} tall, not 32 pt`);
    if (!near(x, lx + px(8)) || !near(x + w, lx + lw - px(8))) out.push(`row ${id} spans ${pt(x - lx)} to ${pt(x + w - lx)} of the list, not 8 pt in from each edge`);
    const [mark, title, word, time] = (['mark', 'title', 'word', 'time'] as const).map((p) => slot(s, id, p));
    if (!mark || !title || !word || !time) { out.push(`row ${id} lacks a slot: ${(['mark', 'title', 'word', 'time'] as const).filter((_, i) => ![mark, title, word, time][i]).map((p) => `${id}:${p}`).join(', ')}`); continue; }
    for (const [name, n] of [['mark', mark], ['title', title], ['word', word], ['time', time]] as const) {
      if (n.bounds[1]! < y - 1 || n.bounds[1]! + n.bounds[3]! > y + h + 1) out.push(`row ${id}'s ${name} slot isn't inside its one line`);
    }
    if (!near(mark.bounds[0]!, x + px(8)) || !near(mark.bounds[2]!, px(16))) out.push(`row ${id}'s mark slot is ${pt(mark.bounds[2]!)} wide at ${pt(mark.bounds[0]! - x)} into the row, not 16 pt at 8 pt`);
    if (!near(title.bounds[0]!, mark.bounds[0]! + px(24))) out.push(`row ${id}'s title starts ${pt(title.bounds[0]! - mark.bounds[0]! - mark.bounds[2]!)} after its mark slot, not 8 pt`);
    if (!near(time.bounds[0]! + time.bounds[2]!, x + w - px(8))) out.push(`row ${id}'s time ends ${pt(x + w - time.bounds[0]! - time.bounds[2]!)} before the row's edge, not 8 pt`);
    if (time.bounds[2]! < px(32) - 1) out.push(`row ${id}'s time slot is ${pt(time.bounds[2]!)} wide, under 32 pt`);
    if (word.bounds[0]! + word.bounds[2]! > time.bounds[0]! + 1 || word.bounds[0]! < title.bounds[0]!) out.push(`row ${id}'s state word isn't between its title and its time`);
  }
  // Headings 32 with 8 above them; rows with no gap between them.
  const lines = [...headings(s), ...rows].sort((a, b) => a.bounds[1]! - b.bounds[1]!);
  for (const [i, n] of lines.entries()) {
    const id = String(n.id);
    const before = lines[i - 1];
    if (id.startsWith('heading:')) {
      if (!near(n.bounds[3]!, px(32))) out.push(`heading ${id} is ${pt(n.bounds[3]!)} tall, not 32 pt`);
      if (before && !near(n.bounds[1]! - before.bounds[1]! - before.bounds[3]!, px(8))) out.push(`heading ${id} has ${pt(n.bounds[1]! - before.bounds[1]! - before.bounds[3]!)} above it, not 8 pt`);
    } else if (before && !String(before.id).startsWith('heading:') && !near(n.bounds[1]!, before.bounds[1]! + before.bounds[3]!)) {
      out.push(`row ${id} has ${pt(n.bounds[1]! - before.bounds[1]! - before.bounds[3]!)} between it and the row above, not none`);
    }
  }
  return out;
}

async function seen(launch: Record<string, unknown>, plant?: string, w: World | null = world): Promise<Snapshot> {
  const r: Replica = await replicaOf(w, launch, plant);
  try { await r.wait(1000); return (await r.see()).snapshot; } finally { await r.stop(); }
}

describe(`AC10 ${ID.rowSlots} every list row is 32 tall with its slots in place`, () => {
  it(`AC10 ${ID.rowSlots}: every list row is 32 tall with its slots at the stated places, read from the snapshot`, async () => {
    expect(slotFailures(await seen({}))).toEqual([]);
  }, 30 * MIN);

  it(`AC10 ${ID.rowSlots} wrong program: a planted 24 row fails, naming it`, async () => {
    expect(slotFailures(await seen({}, 'row-24')).join('\n')).toMatch(/row (ask|session):\S+ is 24 pt tall, not 32 pt/);
  }, 30 * MIN);
});

/** AC27: the two asks' rows read differently in their state-word slots. */
function kindFailures(s: Snapshot): string[] {
  const [a, b] = [askOf(world, APPROVAL), askOf(world, CHOICE)];
  const [wa, wb] = [slot(s, a.handle, 'word'), slot(s, b.handle, 'word')];
  if (!wa || !wb) return [`an ask's row has no state-word slot: ${!wa ? `${a.handle}:word` : ''} ${!wb ? `${b.handle}:word` : ''}`.trim()];
  const [ta, tb] = [wordsOf(s, wa).trim(), wordsOf(s, wb).trim()];
  if (!ta || !tb) return [`an ask's state-word slot is empty: ${a.handle} reads "${ta}", ${b.handle} reads "${tb}"`];
  return ta === tb ? [`the approval ${a.handle} and the choice ${b.handle} both read "${ta}" in their state-word slots`] : [];
}

describe(`AC27 ${ID.askWords} two kinds of ask, two state words`, () => {
  it(`AC27 ${ID.askWords}: two asks of different kinds differ in their rows' state words`, async () => {
    expect(kindFailures(await seen({}))).toEqual([]);
  }, 30 * MIN);

  it(`AC27 ${ID.askWords} wrong program: a planted list that draws both alike fails, naming the pair`, async () => {
    expect(kindFailures(await seen({}, 'ask-words-alike')).join('\n')).toMatch(/the approval ask:\S+ and the choice ask:\S+ both read/);
  }, 30 * MIN);
});

// ---- AC19: #328's fixture, the replica's default record, which holds a folded, a later and a held ask.

const RECORD_338 = join(REPO, 'docs/spikes/338/fixtures/needs-you.events.jsonl');
interface Ev { session_id: string; event: { id: string; kind: string; subject?: string } }
function waiting(): { open: string; folded: string; later: string; held: string } {
  const events = readFileSync(RECORD_338, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Ev);
  const asked = events.filter((e) => e.event.kind === 'ask.created');
  const bySession = new Map<string, string[]>();
  for (const e of asked) bySession.set(e.session_id, [...(bySession.get(e.session_id) ?? []), `ask:${e.event.id}`]);
  // The session past FOLD_AFTER (5, crates/deep-app/src/record.rs): its first ask is open, its sixth folded.
  const folding = [...bySession.values()].find((asks) => asks.length > 5)!;
  const later = events.find((e) => e.event.kind === 'ask.later')!.event.subject!;
  const held = /pub const HELD: &str = "([^"]+)"/.exec(readFileSync(join(REPO, 'crates/deep-replica/src/lib.rs'), 'utf8'))![1]!;
  return { open: folding[0]!, folded: folding[5]!, later, held };
}
function waitFailures(s: Snapshot): string[] {
  const ids = waiting();
  const open = listRows(s).find((n) => n.id === ids.open);
  const openWord = slot(s, ids.open, 'word');
  if (!open || !openWord) return [`the open ask ${ids.open} has no row with a state-word slot`];
  const out: string[] = [];
  for (const state of ['folded', 'later', 'held'] as const) {
    const id = ids[state];
    const row = listRows(s).find((n) => n.id === id);
    const word = slot(s, id, 'word');
    if (!row || !word) { out.push(`row ${id} (${state}) has no row with a state-word slot`); continue; }
    const [value, text] = [String(row.value ?? ''), wordsOf(s, word)];
    if (value === String(open.value ?? '') || text === wordsOf(s, openWord)) out.push(`row ${id} (${state}) differs from the open ask ${ids.open} only by how it's drawn: its value ${JSON.stringify(value)} and state word "${text}"`);
    else if (!new RegExp(state, 'i').test(value) || !new RegExp(state, 'i').test(text)) out.push(`row ${id} (${state}) doesn't name its state: its value ${JSON.stringify(value)} and state word "${text}"`);
  }
  return out;
}

describe(`AC19 ${ID.waitKinds} which kind of waiting`, () => {
  it(`AC19 ${ID.waitKinds}: on #328's fixture with a folded, a later and a held ask, each row's value and state word name its state`, async () => {
    // A window tall enough that every ask's row is laid out.
    expect(waitFailures(await seen({ from: 'fixture', size: [1512, 2400] }, undefined, null))).toEqual([]);
  }, 30 * MIN);

  it(`AC19 ${ID.waitKinds} wrong program: a planted row that differs from an open ask only by ink fails, naming the row`, async () => {
    expect(waitFailures(await seen({ from: 'fixture', size: [1512, 2400] }, 'wait-by-ink', null)).join('\n')).toMatch(/row ask:\S+ \((folded|later|held)\) differs from the open ask \S+ only by how it's drawn/);
  }, 30 * MIN);
});
