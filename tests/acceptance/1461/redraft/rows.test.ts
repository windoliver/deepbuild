// Blind redraft of #1461's AC10, AC19 and AC27 (README.md here): one row's shape, read from the replica's snapshot.
// Worlds are records a real hub built (../helpers.ts `makeWorld`), or #328's fixture, the replica's own default record;
// the window is `deep-drive`'s, and every place, value and word comes from its `see`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { blocked, cleanup, ID, listOf, listRows, makeWorld, MIN, REPO, replicaOf, slot, type SessionSpec, type SNode, type Snapshot, type World, type WorldAsk } from '../helpers.ts';

afterAll(() => cleanup(), MIN);

/** Three projects' sessions, working, finished, flagged and waiting on you, with an approval (a push) and a choice open. */
const ROWS: SessionSpec[] = [
  { key: 'r1', project: 'shop', title: 'Release 1.4', state: 'finished', asks: [{ kind: 'authority', question: 'Push release-1.4 to origin?', plan: { does: 'git push origin release-1.4', changes: ['origin/release-1.4'] } }] },
  { key: 'r2', project: 'shop', title: 'Checkout page' },
  { key: 'r3', project: 'shop', title: 'Billing page', state: 'finished' },
  { key: 'r4', project: 'docs', title: 'Cart store', state: 'finished', asks: [{ kind: 'choice', question: 'Keep the cart on SQLite or plain files?' }] },
  { key: 'r5', project: 'docs', title: 'API guide', state: 'failed' },
  { key: 'r6', project: 'search', title: 'Search index' },
];
let made: Promise<World> | undefined;
const rowsWorld = (): Promise<World> => (made ??= makeWorld(ROWS));

const seen = new Map<string, Promise<Snapshot>>();
/** The window over `w` (null: #328's fixture) half a second after launch, in the plain build or with `plant`. */
function windowOf(w: World | null, launch: Record<string, unknown>, plant?: string): Promise<Snapshot> {
  const key = `${w?.home ?? 'fixture'} ${JSON.stringify(launch)} ${plant ?? ''}`;
  let got = seen.get(key);
  if (!got) {
    got = (async () => {
      const r = await replicaOf(w, launch, plant);
      try {
        await r.wait(500);
        return (await r.see()).snapshot;
      } finally {
        await r.stop();
      }
    })();
    seen.set(key, got);
  }
  return got;
}

/** The strings drawn with their centre inside `b`, top to bottom, left to right. */
function drawnIn(s: Snapshot, b: number[]): string {
  return (s.runs ?? [])
    .filter((r) => {
      const x = r.bounds[0]! + r.bounds[2]! / 2;
      const y = r.bounds[1]! + r.bounds[3]! / 2;
      return x >= b[0]! && x <= b[0]! + b[2]! && y >= b[1]! && y <= b[1]! + b[3]!;
    })
    .sort((a, c) => a.bounds[1]! - c.bounds[1]! || a.bounds[0]! - c.bounds[0]!)
    .map((r) => r.text)
    .join(' ');
}
/** A slot's word: what it draws, else its accessible name. */
const wordOf = (s: Snapshot, n: SNode | undefined): string => (n ? drawnIn(s, n.bounds) || n.name || '' : '').replace(/\s+/g, ' ').trim();
const valueOf = (n: SNode): string => (typeof n.value === 'string' ? n.value : JSON.stringify(n.value ?? null));

// ---- AC10: every row 32 tall, its slots where the issue puts them.

/**
 * Each list row against the issue's numbers, in points (bounds are device pixels at the window's scale), within a point:
 * 32 tall; its mark slot 16 wide and 16 from the list's left edge (list inset 8, then row inset 8); its title 8 after the
 * mark slot; then its state word, then its time, at least 32 wide, ending 16 from the list's right edge; every slot inside
 * its row's height. A failure names the row.
 */
function slotFailures(s: Snapshot): string[] {
  const list = listOf(s);
  if (!list) return ['the window has no list: no node with id "list" (README of ../, Pinned 1)'];
  const scale = s.window.scale;
  const pt = (px: number): number => Math.round((px / scale) * 10) / 10;
  const off = (got: number, want: number): boolean => Math.abs(got - want) > scale;
  const [left, , width] = list.bounds as [number, number, number, number];
  const right = left + width;
  const out: string[] = [];
  for (const row of listRows(s)) {
    const id = String(row.id);
    const [, top, , height] = row.bounds as [number, number, number, number];
    if (off(height, 32 * scale)) out.push(`row ${id} is ${pt(height)} tall, not 32`);
    const parts = { mark: slot(s, id, 'mark'), title: slot(s, id, 'title'), word: slot(s, id, 'word'), time: slot(s, id, 'time') };
    const missing = Object.entries(parts).filter(([, n]) => !n).map(([part]) => `${id}:${part}`);
    if (missing.length) {
      out.push(`row ${id} has no slot ${missing.join(', ')}`);
      continue;
    }
    type Box = [number, number, number, number];
    const mark = parts.mark!.bounds as Box;
    const title = parts.title!.bounds as Box;
    const word = parts.word!.bounds as Box;
    const time = parts.time!.bounds as Box;
    for (const [part, b] of [['mark', mark], ['title', title], ['state word', word], ['time', time]] as const) {
      if (b[1] < top - scale || b[1] + b[3] > top + height + scale) out.push(`row ${id}'s ${part} slot reaches outside the row's height`);
    }
    if (off(mark[0], left + 16 * scale)) out.push(`row ${id}'s mark slot starts ${pt(mark[0] - left)} from the list's edge, not 16`);
    if (off(mark[2], 16 * scale)) out.push(`row ${id}'s mark slot is ${pt(mark[2])} wide, not 16`);
    if (off(title[0], mark[0] + mark[2] + 8 * scale)) out.push(`row ${id}'s title starts ${pt(title[0] - mark[0] - mark[2])} after its mark slot, not 8`);
    if (title[0] + title[2] > word[0] + scale) out.push(`row ${id}'s title slot runs past the start of its state word`);
    if (word[0] + word[2] > time[0] + scale) out.push(`row ${id}'s state word doesn't come before its time`);
    if (time[2] < 32 * scale - scale) out.push(`row ${id}'s time slot is ${pt(time[2])} wide, under 32`);
    if (off(time[0] + time[2], right - 16 * scale)) out.push(`row ${id}'s time ends ${pt(right - time[0] - time[2])} from the list's right edge, not 16`);
  }
  return out;
}

describe(`AC10 ${ID.rowSlots} Every list row is 32 tall with its slots at the stated places, read from the snapshot. A planted 24 row fails, naming it`, () => {
  it('AC10 every row of a list with asks and sessions in three projects is 32 tall, its mark, title, state word and time in place', async () => {
    const w = await rowsWorld();
    const s = await windowOf(w, {});
    const ids = listRows(s).map((n) => String(n.id));
    const want = [...w.asks.map((a) => a.handle), ...w.sessions.map((x) => `session:${x.id}`)];
    expect(want.filter((id) => !ids.includes(id)), `the list holds a row for each open ask and each session (rows: ${ids.join(', ')})`).toEqual([]);
    expect(slotFailures(s)).toEqual([]);
  }, 30 * MIN);

  it('AC10 wrong program: row-24, every row 24 tall, fails naming the row', async () => {
    const w = await rowsWorld();
    const s = await windowOf(w, {}, 'row-24');
    const ids = listRows(s).map((n) => String(n.id));
    const short = slotFailures(s).filter((f) => / is 24 tall, not 32$/.test(f));
    expect(short.length, `the planted list's rows are each named 24 tall: ${slotFailures(s).join('; ')}`).toBeGreaterThan(0);
    for (const f of short) expect(ids.some((id) => f.startsWith(`row ${id} `)), f).toBe(true);
  }, 30 * MIN);
});

// ---- AC19: on #328's fixture, how an ask waits shows in its row's value and state word.

type Wait = 'folded' | 'later' | 'held' | 'open';
const STEM: Record<Exclude<Wait, 'open'>, RegExp> = { folded: /\bfold(ed)?\b/i, later: /\blater\b/i, held: /\bheld\b/i };
const CLOSING = new Set(['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot']);
interface Line { session_id: string; event: { id: string; kind: string; writer?: string; subject?: string; log_pos: number } }

/**
 * #328's fixture (docs/spikes/338/fixtures/needs-you.events.jsonl, which `launch.from: "fixture"` reads), each open ask
 * with how it waits, as the record the window draws reads it (crates/deep-app/src/record.rs): a session's open asks past
 * its fifth are folded; an `ask.later` the core wrote puts one off (only the core's Later hides an ask, as in the asks
 * core, which writes it as the core); and the held one is the replica's `HELD`, since the record has no event for a hold.
 */
function waits(): Map<string, Wait> {
  const lines = readFileSync(join(REPO, 'docs/spikes/338/fixtures/needs-you.events.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Line);
  const closed = new Set(lines.filter((l) => CLOSING.has(l.event.kind)).map((l) => l.event.subject));
  const open = lines.filter((l) => l.event.kind === 'ask.created' && !closed.has(`ask:${l.event.id}`)).sort((a, b) => a.event.log_pos - b.event.log_pos);
  const out = new Map<string, Wait>(open.map((l) => [`ask:${l.event.id}`, 'open']));
  const bySession = new Map<string, string[]>();
  for (const l of open) bySession.set(l.session_id, [...(bySession.get(l.session_id) ?? []), `ask:${l.event.id}`]);
  for (const handles of bySession.values()) for (const h of handles.slice(5)) out.set(h, 'folded');
  for (const l of lines) if (l.event.kind === 'ask.later' && l.event.writer === 'core' && l.event.subject && out.has(l.event.subject)) out.set(l.event.subject, 'later');
  const held = /pub const HELD: &str = "(ask:[0-9A-Z]+)"/.exec(readFileSync(join(REPO, 'crates/deep-replica/src/lib.rs'), 'utf8'))?.[1] ?? blocked('crates/deep-replica/src/lib.rs names no HELD ask for #328\'s fixture');
  if (out.get(held) !== 'open') blocked(`the replica's held ask ${held} isn't an open ask of #328's fixture outside the folded and later ones`);
  out.set(held, 'held');
  return out;
}

/** Each folded, later and held row names its state in its value and its state word; no open ask's row names one. */
function waitFailures(s: Snapshot, kinds: Map<string, Wait>): string[] {
  const rows = new Map(listRows(s).map((n) => [String(n.id), n]));
  const out: string[] = [];
  const open = [...kinds].filter(([h, k]) => k === 'open' && rows.has(h)).map(([h]) => rows.get(h)!);
  const contrast = open[0];
  for (const [handle, kind] of kinds) {
    const row = rows.get(handle);
    if (kind === 'open') {
      if (!row) continue;
      const named = Object.entries(STEM).find(([, stem]) => stem.test(valueOf(row)) || stem.test(wordOf(s, slot(s, handle, 'word'))));
      if (named) out.push(`open ask ${handle}'s row says ${named[0]} in its value (${valueOf(row)}) or state word ("${wordOf(s, slot(s, handle, 'word'))}")`);
      continue;
    }
    if (!row) {
      out.push(`no row ${handle} (${kind}) in the list`);
      continue;
    }
    const value = valueOf(row);
    const word = wordOf(s, slot(s, handle, 'word'));
    if (!STEM[kind].test(value)) out.push(`row ${handle} (${kind}): its value ${value} doesn't say ${kind}`);
    if (!STEM[kind].test(word)) out.push(`row ${handle} (${kind}): its state word "${word}" doesn't say ${kind}`);
    if (contrast && value === valueOf(contrast) && word === wordOf(s, slot(s, String(contrast.id), 'word'))) {
      out.push(`row ${handle} (${kind}) carries open ask ${String(contrast.id)}'s value and state word, set apart only by ink, indent or slant`);
    }
  }
  return out;
}

/** A window tall enough for Needs you's 40 rows, so no waiting row is cut off below the frame. */
const TALL = { from: 'fixture', size: [1512, 1600] };

describe(`AC19 ${ID.waitKinds} On #328's fixture with a folded, a later and a held ask, each row's value and state word name its state. A planted row that differs from an open ask only by ink fails, naming the row`, () => {
  it('AC19 the folded, later and held rows say so in their values and state words, and no open ask\'s row does', async () => {
    const kinds = waits();
    const count = (k: Wait): number => [...kinds.values()].filter((v) => v === k).length;
    expect([count('folded'), count('later'), count('held')], "#328's fixture holds five folded asks, one put off by the core's Later and one held (README: its Later is written by app at d51be2c3)").toEqual([5, 1, 1]);
    expect(waitFailures(await windowOf(null, TALL), kinds)).toEqual([]);
  }, 30 * MIN);

  it('AC19 wrong program: wait-by-ink, a waiting row drawn as an open one but for ink, fails naming the row', async () => {
    const kinds = waits();
    const waiting = [...kinds].filter(([, k]) => k !== 'open').map(([h]) => h);
    const failures = waitFailures(await windowOf(null, TALL, 'wait-by-ink'), kinds);
    // A row the planted list drew, named for what its value or state word fails to say; a missing row proves nothing here.
    const named = failures.filter((f) => waiting.some((h) => f.startsWith(`row ${h} `)));
    expect(named.length, `the failures name a folded, later or held row drawn like an open one: ${failures.join('; ')}`).toBeGreaterThan(0);
  }, 30 * MIN);
});

// ---- AC27: an approval's row and a choice's row differ in their state words.

function pairFailures(s: Snapshot, a: WorldAsk, b: WorldAsk): string[] {
  const [wa, wb] = [wordOf(s, slot(s, a.handle, 'word')), wordOf(s, slot(s, b.handle, 'word'))];
  const out = [a, b].filter((_, i) => ![wa, wb][i]).map((x) => `row ${x.handle} (${x.kind}) draws no state word in ${x.handle}:word`);
  if (!out.length && wa.toLowerCase() === wb.toLowerCase()) out.push(`${a.handle} (${a.kind}) and ${b.handle} (${b.kind}) both read "${wa}" in their state-word slots`);
  return out;
}

describe(`AC27 ${ID.askWords} Two asks of different kinds differ in their rows' state words. A planted list that draws both alike fails, naming the pair`, () => {
  const pair = (w: World): [WorldAsk, WorldAsk] => {
    const approval = w.asks.find((a) => a.kind === 'authority');
    const choice = w.asks.find((a) => a.kind === 'choice');
    if (!approval || !choice) blocked('the world holds no approval and choice');
    return [approval!, choice!];
  };

  it('AC27 a push approval\'s row and a choice\'s row read different state words', async () => {
    const w = await rowsWorld();
    const [a, b] = pair(w);
    expect(pairFailures(await windowOf(w, {}), a, b)).toEqual([]);
  }, 30 * MIN);

  it('AC27 wrong program: ask-words-alike, every ask row reading the same word, fails naming the pair', async () => {
    const w = await rowsWorld();
    const [a, b] = pair(w);
    const failures = pairFailures(await windowOf(w, {}, 'ask-words-alike'), a, b);
    expect(failures, 'the one failure is the pair drawn alike, naming both rows').toHaveLength(1);
    expect(failures[0]).toMatch(/both read/);
    expect(failures[0]).toContain(a.handle);
    expect(failures[0]).toContain(b.handle);
  }, 30 * MIN);
});
