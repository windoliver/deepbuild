// Blind redraft of #1461's AC7 (README.md here): a view replacing Needs you that passes `needs-you@1` fills the list's
// first section, and a planted one that hides the oldest ask fails, naming it. The views are #1459's
// (tests/acceptance/1459/fixtures/views). `needs-you@1` is #1459's kit (`deep-replica --view-kit needs-you@1 <dir>`).
// In the window, a script view's elements are not observed elements, so the replica's snapshot holds no node or id of
// theirs; what it holds is every string the frame drew (`see`'s `runs`, crates/deep-replica/src/drive/glyphs.rs). So the
// first section is read as the strings drawn in the list's width between Needs you's heading and the next heading.
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, headings, ID, listOf, makeWorld, MIN, REPO, replicaOf, tempDir, type SessionSpec, type Snapshot, type World, type WorldAsk } from '../helpers.ts';
import { openAsks, RECORD_338, viewKit } from '../../1459/helpers.ts';

afterAll(() => cleanup(), MIN);

const VIEWS = join(REPO, 'tests/acceptance/1459/fixtures/views');
/** The replacement's own heading, drawn above its rows (fixtures/views/*\/main.js). */
const HEADING = 'Asks for you';

/** Three open asks in two projects, short enough to draw on one line in the list's width; the oldest is first. */
const ASKING: SessionSpec[] = [
  { key: 'a', project: 'shop', title: 'Login page', state: 'finished', asks: [{ kind: 'taste', question: 'Blue or green header?' }] },
  { key: 'b', project: 'shop', title: 'Cart store', state: 'finished', asks: [{ kind: 'choice', question: 'SQLite or plain files?' }] },
  { key: 'c', project: 'docs', title: 'Style guide', state: 'finished', asks: [{ kind: 'choice', question: 'Tabs or spaces?' }] },
  { key: 'd', project: 'docs', title: 'Release notes' },
];
let made: Promise<World> | undefined;
const asking = (): Promise<World> => (made ??= makeWorld(ASKING));

const norm = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The window over the world with `view` installed as the view replacing Needs you (README of ../, Pinned 3). */
async function windowWith(w: World, view: string): Promise<Snapshot> {
  const dir = join(tempDir(), view);
  cpSync(join(VIEWS, view), dir, { recursive: true });
  const r = await replicaOf(w, { replaces: 'needs-you', panel: dir });
  try {
    await r.wait(500);
    return (await r.see()).snapshot;
  } finally {
    await r.stop();
  }
}

/**
 * The list's first section, as drawn: Needs you's heading is the list's first, and below it, above the next heading and
 * inside the list's width, the replacement draws its heading and each open ask's question, oldest first. A failure names
 * the ask.
 */
function sectionFailures(s: Snapshot, asks: WorldAsk[]): string[] {
  const list = listOf(s);
  const hs = headings(s);
  const needs = hs[0];
  if (!list || needs?.id !== 'heading:needs-you') {
    return [`the list's first heading isn't heading:needs-you (README of ../, Pinned 1): ${list ? hs.map((h) => String(h.id)).join(', ') || 'no heading' : 'no node with id "list"'}`];
  }
  const top = needs.bounds[1]! + needs.bounds[3]!;
  const bottom = hs[1] ? hs[1].bounds[1]! : list.bounds[1]! + list.bounds[3]!;
  const [left, , width] = list.bounds as [number, number, number, number];
  const drawn = (s.runs ?? [])
    .filter((r) => {
      const x = r.bounds[0]! + r.bounds[2]! / 2;
      const y = r.bounds[1]! + r.bounds[3]! / 2;
      return x >= left && x < left + width && y >= top && y < bottom;
    })
    .sort((a, b) => a.bounds[1]! - b.bounds[1]! || a.bounds[0]! - b.bounds[0]!);
  const text = norm(drawn.map((r) => r.text).join(' '));
  const out: string[] = [];
  if (!text.includes(HEADING)) out.push(`the replacement's heading "${HEADING}" isn't drawn in the list's first section, which draws "${text.slice(0, 300)}"`);
  let from = -1;
  for (const ask of asks) {
    const at = text.indexOf(norm(ask.question));
    if (at < 0) out.push(`${ask.handle} ("${ask.question}") isn't drawn in the list's first section`);
    else if (at < from) out.push(`${ask.handle} ("${ask.question}") is drawn above an ask raised before it`);
    else from = at;
  }
  return out;
}

describe(`AC7 ${ID.needsYouKit} A replacement view that passes \`needs-you@1\` still fills the list's first section, and a planted one that hides the oldest ask fails, naming the ask`, () => {
  it('AC7 a view that passes needs-you@1, installed in place of Needs you, draws every open ask oldest first in the list\'s first section', async () => {
    const kit = await viewKit(join(VIEWS, 'needs-you-by-id'));
    expect(kit.verdict, `needs-you@1's verdict on the replacement: ${kit.said}`).toEqual({ result: 'pass' });
    const w = await asking();
    expect(sectionFailures(await windowWith(w, 'needs-you-by-id'), w.asks)).toEqual([]);
  }, 30 * MIN);

  it('AC7 wrong program: the view hiding the oldest ask fails needs-you@1 naming that ask, and its first section leaves the same ask out', async () => {
    const kit = await viewKit(join(VIEWS, 'hides-oldest'));
    expect(kit.verdict?.result, `needs-you@1's verdict on the planted view: ${kit.said}`).toBe('fail');
    expect(kit.verdict?.names, 'the kit names the oldest open ask of its record').toBe(openAsks(RECORD_338)[0]!.handle);
    const w = await asking();
    const oldest = w.asks[0]!;
    const failures = sectionFailures(await windowWith(w, 'hides-oldest'), w.asks);
    expect(failures, 'the planted view draws its heading and every ask but the oldest, so the one failure names the oldest').toEqual([
      `${oldest.handle} ("${oldest.question}") isn't drawn in the list's first section`,
    ]);
  }, 30 * MIN);
});
