// AC5: the same ask answered with `deep inbox answer`, where nothing is drawn. Two worlds, real hubs' records (README,
// The fixtures): a session whose claim's verdict waits on a person's call, AC1's four-picture taste ask; the second
// world's hub (when packages/hub/src/plant.ts lists it) and replica run the plant. The answer is the terminal's, the OS
// confirming you through the hub's test file (#24). Then the record, and the three surfaces (README, Pinned 5): the
// claim's verdict line (`deep status`'s, from the hub's `status.read`), the return card on the session's page and the
// Decided page (the answered ask's own address), the last two in the replica on a copy of the record.
import { afterAll, describe, expect, it } from 'vitest';
import {
  ACCEPT, answersOf, askOf, byId, cleanup, deep, entriesOf, eventsOf, hubLists, ID, look, makeWorld, MIN, PLANT, replicaOf, said, sessionOf,
  UNSEEN, verdictLine, waitFor, windowWords, wordsOf, type Line, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const FOUR: [number, number][] = [[800, 700], [800, 700], [800, 700], [800, 700]];
const SPECS = [{ key: 'call', title: 'Header layout', claim: true as const, asks: [{ key: 'four', question: 'Does the new header look right on all four pages?', pictures: FOUR }] }];
const SURFACES = ["the claim's verdict line", 'the return card', 'the Decided page'] as const;

async function terminalRun(plant?: string): Promise<string[]> {
  const w: World = await makeWorld(SPECS, plant && hubLists(plant) ? { plant } : {});
  const ask = askOf(w, 'four');
  const session = sessionOf(w, 'call');
  const out: string[] = [];
  const r1 = await deep(w.home, ['inbox', 'answer', ask.handle, ACCEPT]);
  if (r1.code !== 0) return [`deep inbox answer ${ask.handle} ${ACCEPT} was refused: exit ${r1.code}, ${r1.stdout.slice(-300)} ${r1.stderr.slice(-300)}`];
  // The record: the terminal as its source, and all four pictures not shown.
  const answered = answersOf(await eventsOf(w), ask.handle);
  if (answered.length !== 1) out.push(`the hub records ${answered.length} answers to ${ask.handle}, not one: ${said(answered.map((e) => e.data), 600)}`);
  const e = answered[0];
  if (e && e.data.via !== 'inbox') out.push(`the record of ${ask.handle}'s terminal answer names ${said(e.data.via)} as its source, not inbox`);
  const entries = entriesOf(e);
  if (!entries) out.push(`the record of ${ask.handle}'s terminal answer holds no per-picture entries (data.pictures): ${said(e?.data, 600)}`);
  else {
    const want = ask.pictures.map((p) => ({ sha256: p.sha, shown: false, scale: 0, ms: 0 }));
    if (JSON.stringify(entries.map((x: Line) => ({ sha256: x.sha256, shown: x.shown, scale: x.scale, ms: x.ms }))) !== JSON.stringify(want)) out.push(`the record of ${ask.handle}'s terminal answer must hold its four pictures, in the manifest's order, each not shown, at scale 0 for 0 ms; it holds ${said(entries, 800)}`);
  }
  // The surfaces.
  const line = await verdictLine(w, session);
  if (!line.line?.includes(UNSEEN)) out.push(`${SURFACES[0]} doesn't read "${UNSEEN}" beside ${ask.handle}, answered from the terminal: it reads ${said(line.line ?? null)} (status.read's row: ${line.raw})`);
  const r = await replicaOf(w, plant ? { plant } : {});
  try {
    await r.open(`session/${session}`);
    const page = await waitFor(r, (s) => wordsOf(s, byId(s, 'return-card')).includes(UNSEEN), 2000);
    const card = byId(page.s, 'return-card');
    if (!card) out.push(`${SURFACES[1]} isn't on session/${session}'s page (no node return-card)`);
    else if (!wordsOf(page.s, card).includes(UNSEEN)) out.push(`${SURFACES[1]} doesn't read "${UNSEEN}" beside ${ask.handle}, answered from the terminal: it reads ${JSON.stringify(wordsOf(page.s, card).slice(0, 400))}`);
    const opened = await r.open(`ask/${ask.handle.slice('ask:'.length)}`);
    await r.wait(500);
    const decided = await look(r);
    const words = `${String(opened.said ?? '')}\n${windowWords(decided.s)}`;
    if (!words.includes(UNSEEN)) out.push(`${SURFACES[2]} (ask/${ask.handle.slice('ask:'.length)}) doesn't read "${UNSEEN}" beside ${ask.handle}, answered from the terminal: the open said ${said(opened.said ?? null)}`);
  } finally {
    await r.stop();
  }
  return out;
}

let clean: Promise<string[]> | undefined;
const cleanRun = (): Promise<string[]> => (clean ??= terminalRun());

describe(`AC5 ${ID.terminal} an answer from the terminal reads "answered unseen"`, () => {
  it(`AC5 ${ID.terminal}: the same ask answered with deep inbox answer records the terminal as its source and all four not shown, and the claim's verdict line, the return card and the Decided page each read "answered unseen" beside it`, async () => {
    expect(await cleanRun()).toEqual([]);
  }, 40 * MIN);

  it(`AC5 ${ID.terminal} wrong program: a planted line that reads as an answer from the card fails, naming the surface`, async () => {
    expect(await cleanRun(), 'the same judge passes the program as shipped first, so the plant can\'t look caught by a failure it shares').toEqual([]);
    const failures = await terminalRun(PLANT.unseenReadsAsCard);
    expect(failures.length, `the planted line (README, Plants: ${PLANT.unseenReadsAsCard}) wasn't caught`).toBeGreaterThan(0);
    for (const f of failures) expect(SURFACES.some((s) => f.startsWith(s)), `each failure names its surface: ${f}`).toBe(true);
  }, 80 * MIN);
});
