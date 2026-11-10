// AC19: one row anatomy. Each row's state word is a slot of its own, read from the replica's snapshot by the slots' ids
// (README, Pinned 1). AC19 reads #328's fixture, the replica's own default (#338's record, with its held ask). AC10 and
// AC27 are in redraft/rows.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, ID, listRows, MIN, REPO, Replica, replicaOf, slot, wordsOf, type Snapshot } from './helpers.ts';

afterAll(cleanup, 60_000);
// AC10 and AC27 were swapped for their blind redraft, redraft/rows.test.ts, with the owner's approval: this file's world
// raised an approval without a plan, which the asks core refuses, so neither could run. AC19 stays here.

async function seen(launch: Record<string, unknown>, plant?: string, w: { home: string } | null = null): Promise<Snapshot> {
  const r: Replica = await replicaOf(w, launch, plant);
  try { await r.wait(1000); return (await r.see()).snapshot; } finally { await r.stop(); }
}

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
