// Test-side tools for #3282 (README). The world is #1808's: a record a real hub made (`makeWorld`), read through the
// real `deep-drive` (#124) launched with `launch.from: "record_copy"` at the size the app opens at, where the list is
// 260 wide. Everything that builds, seeds, drives and reads the window is #1808's and #1461's, imported by path; this
// file adds the world's specs, the criteria's IDs, the plant's name and the two judgements.
//
// Safety: as #1808's: HOME is a temp folder for every process started; a process is stopped only by the PID it was
// started with; nothing touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import {
  byId, feedRow, inside, listOf, listView, overlap, runsIn, slot, TITLE, type Replica, type Run, type SessionSpec,
  type Snapshot,
} from '../1808/helpers.ts';

export {
  cleanup, driveBins, makeWorld, MIN, OPENING, PLANT as PLANT1808, replicaOf, sessionOf, TITLE, type World,
} from '../1808/helpers.ts';

/** The criteria, by `#3282.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  time: '#3282.c198443a',
  twelve: '#3282.d93e985c',
} as const;

/** The planted wrong program (README, Surfaces), read through `plain::planted` in an env-plants build only. */
export const PLANT = {
  /** AC1: the topmost open ask row the list draws draws its time slot with no width, as the base's `timed` rule does at 260. */
  askTime0Wide: 'ask-time-0-wide',
} as const;

/** Five open taste calls, each on its own session in shop, and a session in docs whose title is #1808's twelve. */
export const QUESTIONS = [
  'Which header colour on the login page?',
  'Does the cart badge read well on dark?',
  'Is the empty basket picture friendly?',
  'Should the receipt use the serif face?',
  'Does the checkout button sit right?',
] as const;
export const SPECS: SessionSpec[] = [
  ...QUESTIONS.map((question, i): SessionSpec => ({ key: `taste${i}`, project: 'shop', title: `Look ${i + 1}`, state: 'finished', asks: [{ kind: 'taste', question }] })),
  { key: 'twelve', project: 'docs', title: TITLE.twelve, state: 'finished' },
];

/** An open taste call of the world: its row's id (`ask:<ULID>`) and its question, which the row reads as its title. */
export interface Call { handle: string; question: string }
const squash = (text: string): string => text.replace(/\s+/g, '');
/** The list's width in points, from its node's bounds in device pixels. */
export const listWidth = (s: Snapshot): number => { const l = listOf(s); return l ? l.bounds[2]! / s.window.scale : 0; };

/**
 * AC1: each open taste call's row draws its time in its `<row>:time` slot, a slot with width, the time's text (the
 * slot's name) drawn whole inside it, uncut, and on screen in the list. Each failure starts `row <ask:ULID> ("<question>")`.
 */
export function timeFailures(s: Snapshot, calls: readonly Call[]): string[] {
  if (!calls.length) return ['the world has no open taste calls'];
  const view = listView(s) ?? [0, 0, 0, 0];
  const out: string[] = [];
  for (const c of calls) {
    const a = { id: c.handle };
    const named = `row ${c.handle} ("${c.question.slice(0, 60)}")`;
    const row = byId(s, a.id);
    const time = slot(s, a.id, 'time');
    if (!row || !time) { out.push(`${named} isn't drawn with its time slot (${a.id}:time)`); continue; }
    const text = String(time.name ?? '').trim();
    if (!text) { out.push(`${named}'s time slot (${a.id}:time) names no time`); continue; }
    const points = Math.round((time.bounds[2]! / s.window.scale) * 10) / 10;
    // Every string drawn over the slot, left to right, whether or not it lies inside it.
    const over: Run[] = (s.runs ?? []).filter((x) => overlap(x.bounds, time.bounds)).sort((x, y) => x.bounds[0]! - y.bounds[0]!);
    const within = runsIn(s, time.bounds).sort((x, y) => x.bounds[0]! - y.bounds[0]!);
    if (time.bounds[2]! <= 0 || squash(within.map((x) => x.text).join('')) !== squash(text)) {
      out.push(`${named} draws its time "${text}" in a slot ${points} wide (${a.id}:time at ${JSON.stringify(time.bounds)}), which doesn't hold it: drawn inside it ${JSON.stringify(within.map((x) => x.text))}, over it ${JSON.stringify(over.map((x) => [x.text, x.bounds]))}`);
      continue;
    }
    if (within.some((x) => x.cut)) out.push(`${named} draws its time "${text}" clipped at the edge of its slot (${a.id}:time, ${points} wide)`);
    if (!inside(time.bounds, row.bounds, 2)) out.push(`${named} draws its time slot (${a.id}:time at ${JSON.stringify(time.bounds)}) past its row (${JSON.stringify(row.bounds)})`);
    if (!within.every((x) => inside(x.bounds, view, 2))) out.push(`${named} draws its time "${text}" outside the list on screen (${JSON.stringify(view)})`);
  }
  return out;
}

/** The topmost open taste call row the list draws: the one the plant names. */
export function topAsk(s: Snapshot, calls: readonly Call[]): string | undefined {
  return calls
    .map((c) => ({ id: c.handle, node: byId(s, c.handle) }))
    .filter((x) => x.node)
    .sort((a, b) => a.node!.bounds[1]! - b.node!.bounds[1]!)[0]?.id;
}

const ELLIPSIS = '…';
/**
 * AC2: #1808 AC7's judgement (tests/acceptance/1808/window.test.ts, `twelveFailures`), on this world: the 260-wide list,
 * the session row fed INCONCLUSIVE as the hub writes it reads it in its word slot and draws at least 12 characters of its
 * title before its ellipsis, in its title slot, cut at a whole character.
 */
export async function twelveFailures(r: Replica, session: string): Promise<string[]> {
  const row = `session:${session}`;
  const before = await r.see();
  const listed = before.rows.find((x) => x.id === row);
  if (!listed) return [`the record's rows hold no ${row}`];
  await feedRow(r, listed, { word: 'INCONCLUSIVE', entry: 'inconclusive', why: 'the timing check ran on a loaded machine; a run on a quiet one decides it' });
  await r.wait(500);
  const s = (await r.see()).snapshot;
  const width = listWidth(s);
  if (Math.abs(width - 260) > 4) return [`the list is ${width} wide, not 260`];
  const named = `row ${row} ("${TITLE.twelve}")`;
  const word = slot(s, row, 'word');
  if (!word || !runsIn(s, word.bounds).some((x) => x.text === 'INCONCLUSIVE')) return [`${named} doesn't read INCONCLUSIVE in its state word slot (${row}:word)`];
  const title = slot(s, row, 'title');
  const runs = title ? (s.runs ?? []).filter((x) => overlap(x.bounds, title.bounds)).sort((a, b) => a.bounds[0]! - b.bounds[0]!) : [];
  if (runs.some((x) => x.cut)) return [`${named} reading INCONCLUSIVE draws its title clipped, not cut at an ellipsis, so the characters it shows can't be read`];
  const drawn = runs.map((x) => x.text).join('');
  const kept = drawn.endsWith(ELLIPSIS) ? drawn.slice(0, -ELLIPSIS.length) : drawn;
  if (!TITLE.twelve.startsWith(kept)) return [`${named} reading INCONCLUSIVE draws ${JSON.stringify(drawn)} in its title slot, not the start of its title cut at an ellipsis`];
  return [...kept].length >= 12 ? [] : [`${named} reading INCONCLUSIVE shows ${[...kept].length} characters of its title (${JSON.stringify(drawn)}), fewer than 12`];
}
