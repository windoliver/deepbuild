// #322 AC11: each acceptance criterion the gate reads is linted for its observable, its threshold with its unit, the
// wrong case that must fail it, and its proof depth, and one missing any of them is flagged, naming the criterion and
// each part it lacks: the planted criterion 'the export is fast' is flagged for all four, and one that names its
// observable, its wrong case and its depth but says 'under 5' with no unit is flagged for its unit alone; a lint that
// only looks for a number (DEEP_HUB_PLANT=lint-number-only) passes the second and fails this test (design: Solved or
// not, "A threshold without a unit makes its check BLOCKED").
//
// The two criteria come through the test work source's reading of item-11; no definition is handed. The flags are read
// in the record (README, The lint's flags): an event after the task's creation whose data names the criterion's text
// and each part it lacks by its word: `observable`, `threshold` or `unit`, `wrong case`, `depth`. The event's kind is
// left open. Words are looked for in the event's string values other than a requirement record's own fields (`depth`,
// `oracle`, `on_base`, `check`, `id`, `source_line`, `refuted_by`, `text`) and the criteria's texts, so a requirement
// at unit depth never reads as a unit flag.
import { afterEach, describe, it } from 'vitest';
import { AC11, cleanup, failureOf, itemTask, lastPos, makeWorld, must, Session, settle, startHub, type Ev, type Reading } from './helpers.ts';

afterEach(cleanup, 60_000);

const VAGUE = 'the export is fast';
const NO_UNIT = 'The CSV export of 1,000 rows finishes in under 5 on the export timer; an export of 1,000 rows that takes longer than that fails it; proven by an end-to-end run.';
const LINK = 'https://work.test/acme/shop/issues/11';
const ISSUE: Reading = {
  source_id: 'item-11', link: LINK, title: 'The export is slow', body: `Exports take too long.\n\n- ${VAGUE}\n- ${NO_UNIT}`,
  criteria: [VAGUE, NO_UNIT], authors: [{ handle: 'maya', role: 'owner' }], updated: '2026-10-20T09:00:00Z',
};
const PARTS = { observable: /\bobservable\b/i, unit: /\b(?:unit|threshold)\b/i, 'wrong case': /\bwrong[ -]case\b|\bmust fail\b|\bnegative case\b/i, depth: /\bdepth\b/i } as const;
const SKIP_KEYS = new Set(['depth', 'oracle', 'on_base', 'check', 'id', 'source_line', 'refuted_by', 'text', 'asserts', 'near_misses', 'check_sha256', 'hash', 'base_commit', 'issue_rev', 'definition', 'task_ref']);

/** The string values of an event's data outside a requirement record's own fields and the criteria's texts. */
function words(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') { if (value !== VAGUE && value !== NO_UNIT) into.push(value); }
  else if (Array.isArray(value)) for (const v of value) words(v, into);
  else if (typeof value === 'object' && value !== null) for (const [k, v] of Object.entries(value)) if (!SKIP_KEYS.has(k)) words(v, into);
  return into;
}
/** The parts the record flags a criterion for: the words found in the events after `since` that name the criterion. */
function flagged(events: readonly Ev[], since: number, criterion: string): { parts: string[]; events: Ev[] } {
  const naming = events.filter((e) => e.log_pos > since && JSON.stringify(e.data).includes(criterion));
  const text = naming.flatMap((e) => words(e.data)).join('\n');
  return { parts: Object.entries(PARTS).filter(([, re]) => re.test(text)).map(([p]) => p), events: naming };
}

async function linted(plant?: string): Promise<{ events: Ev[]; since: number }> {
  const w = makeWorld({ readings: [ISSUE] });
  const hub = await startHub(w, { plant });
  const s = new Session(w);
  await s.start();
  const since = await lastPos(hub);
  await s.typed(`Fix ${LINK}`);
  await s.read('src/auth.js');
  const events = await settle(hub, (all) => itemTask(all, s) !== undefined && flagged(all, since, VAGUE).parts.length === 4 && flagged(all, since, NO_UNIT).events.length > 0, 45_000);
  must(itemTask(events, s) !== undefined, `${AC11} the session started from ${LINK} must open one task under its thread`);
  return { events, since };
}
function judge(t: { events: Ev[]; since: number }): void {
  const vague = flagged(t.events, t.since, VAGUE);
  must(vague.events.length > 0, `${AC11} the criterion '${VAGUE}' must be flagged, in an event naming it: none after the task names it`);
  must(vague.parts.length === 4, `${AC11} '${VAGUE}' lacks all four parts, so its flag names observable, threshold with its unit, wrong case and depth; it named ${vague.parts.join(', ') || 'none'}: ${vague.events.map((e) => `${e.kind} ${JSON.stringify(e.data).slice(0, 400)}`).join('; ')}`);
  const noUnit = flagged(t.events, t.since, NO_UNIT);
  must(noUnit.events.length > 0, `${AC11} the criterion saying 'under 5' with no unit must be flagged, in an event naming it: none after the task names it`);
  must(noUnit.parts.includes('unit'), `${AC11} 'under 5' names no unit, so the flag names the unit (threshold with its unit); it named ${noUnit.parts.join(', ') || 'none'}: ${noUnit.events.map((e) => `${e.kind} ${JSON.stringify(e.data).slice(0, 400)}`).join('; ')}`);
  const extra = noUnit.parts.filter((p) => p !== 'unit');
  must(!extra.length, `${AC11} the 'under 5' criterion names its observable (the export timer), its wrong case (an export that takes longer fails it) and its depth (an end-to-end run), so it is flagged for its unit alone; it was also flagged for ${extra.join(', ')}`);
}

describe(`${AC11} each criterion is linted for its four parts`, () => {
  it(`${AC11} '${VAGUE}' is flagged for all four; the 'under 5' criterion for its unit alone`, async () => {
    judge(await linted());
  }, 180_000);

  it(`${AC11} (wrong program) a lint that only looks for a number (DEEP_HUB_PLANT=lint-number-only) passes the 'under 5' criterion and fails this test`, async () => {
    const failure = await failureOf(async () => judge(await linted('lint-number-only')));
    must(failure !== null, `${AC11} the planted lint must fail this test: it passed`);
    must(failure.includes('under 5'), `${AC11} the planted lint fails on the 'under 5' criterion, which it passes; it failed elsewhere: ${failure}`);
  }, 180_000);
});
