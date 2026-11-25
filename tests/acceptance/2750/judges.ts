// The judges (README: Criteria). Each takes what a surface gave (the rows of `numbers.read`, the forge's calls, the
// record's events) and what the fixture holds, and returns what is wrong as sentences: an empty list is the only pass.
// A reading that isn't there, or holds nothing, is a failure, never a pass. Nothing here is imported from DeepBuild and
// nothing reads a clock, so each judge can be held to planted readings, right and wrong, with no hub.

/** The reading's id (README: The surface under test). Its subject is the repo, `owner/name`. */
export const READING = 'landed.none';
export type Outcome = 'PASS' | 'FAIL' | 'BLOCKED' | 'INVALID' | 'INCONCLUSIVE';
export const OUTCOMES: readonly Outcome[] = ['PASS', 'FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE'];
/** Why a commit reads none: `holds.watch`'s own causes, then the two this reading adds. */
export type Cause = 'off' | 'checks' | 'version' | 'hooks' | 'no_session' | 'tree';
export type Row = Record<string, unknown>;

/** How the fixture says one commit the default branch gained reads (fixture.ts derives it). */
export interface Expect {
  commit: string;
  /** What the commit is, in the issue's words, for a failure's text. */
  what: string;
  judged: Outcome | 'none';
  cause?: Cause;
  /** With `no_session`: the push's pusher. */
  pusher?: string | null;
  /** With `tree`: the verdict a claim on the same branch has on another tree, and that verdict's commit. */
  verdict?: Outcome;
  verdict_commit?: string;
}
/** A span of UTC dates, both inclusive, as `YYYY-MM-DD`. */
export interface Span { from: string; to: string }

const isRow = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const said = (v: unknown, most = 300): string => { const text = JSON.stringify(v) ?? String(v); return text.length > most ? `${text.slice(0, most)}…` : text; };
const short = (sha: string): string => sha.slice(0, 12);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The reading's row for `repo` among the rows `numbers.read` gave, or undefined. */
export function readingOf(rows: unknown, repo: string): Row | undefined {
  return (Array.isArray(rows) ? rows : []).filter(isRow).find((r) => r.id === READING && r.subject === repo);
}
/** The reading's rows that name a commit: one per commit the default branch gained. */
export function commitRows(reading: Row | undefined): Row[] {
  return (Array.isArray(reading?.detail) ? reading.detail : []).filter(isRow).filter((r) => typeof r.commit === 'string');
}
/** The reading's rows that say a span is missing. */
export function missingRows(reading: Row | undefined): Row[] {
  return (Array.isArray(reading?.detail) ? reading.detail : []).filter(isRow).filter((r) => r.missing === true);
}
/**
 * The reading's rows as bytes, for comparing two rebuilds: its id, subject, value, unit, band and detail rows, in the
 * order they came. A panel row's age, which a clock moves, is left out.
 */
export function bytesOf(reading: Row | undefined): string {
  return JSON.stringify(reading ? { id: reading.id, subject: reading.subject, value: reading.value, unit: reading.unit, band: reading.band, detail: reading.detail } : null);
}
/** How many commits read each way: every verdict's word, and none. */
export function tally(rows: readonly { judged?: unknown }[]): Record<Outcome | 'none', number> {
  const count = (word: string): number => rows.filter((r) => r.judged === word).length;
  return { PASS: count('PASS'), FAIL: count('FAIL'), BLOCKED: count('BLOCKED'), INVALID: count('INVALID'), INCONCLUSIVE: count('INCONCLUSIVE'), none: count('none') };
}
/** A tally in the issue's words: "6 PASS, 1 FAIL and 3 none", with any other verdict that has a commit. */
export function sayTally(t: Record<Outcome | 'none', number>): string {
  const others = (['BLOCKED', 'INVALID', 'INCONCLUSIVE'] as const).filter((o) => t[o] > 0).map((o) => `, ${t[o]} ${o}`).join('');
  return `${t.PASS} PASS, ${t.FAIL} FAIL${others} and ${t.none} none`;
}
/** How one expected reading is said: "none (tree not judged, naming PASS on 0123456789ab)". */
function sayExpect(e: Expect): string {
  if (e.judged !== 'none') return e.judged;
  const why = e.cause === 'off' ? 'gate off' : e.cause === 'no_session' ? `no session, naming the pusher ${said(e.pusher)}` : e.cause === 'tree' ? `tree not judged, naming ${String(e.verdict)} on ${short(String(e.verdict_commit))}` : String(e.cause);
  return `none (${why}: cause ${said(e.cause)})`;
}
const sayRow = (r: Row): string => said(Object.fromEntries(Object.entries(r).filter(([k]) => ['judged', 'cause', 'pusher', 'verdict', 'verdict_commit'].includes(k))));

/**
 * Criterion 1's judge, and every other criterion's guard that the reading is there and is the fixture's: one row per
 * commit the default branch gained, each read as the fixture says, none left out and none added, and the share with
 * none as the reading's value.
 */
export function judgeLanded(reading: Row | undefined, repo: string, expected: readonly Expect[]): string[] {
  if (!reading) return [`numbers.read lists no ${READING} reading for ${repo}`];
  if (!Array.isArray(reading.detail)) return [`the ${READING} reading for ${repo} holds no detail rows: ${said(reading)}`];
  const failures: string[] = [];
  const rows = commitRows(reading);
  for (const e of expected) {
    const name = `${short(e.commit)} (${e.what})`;
    const got = rows.filter((r) => r.commit === e.commit);
    if (got.length !== 1) { failures.push(`${name} has ${got.length === 0 ? 'no row' : `${got.length} rows`}: it must read ${sayExpect(e)}`); continue; }
    const r = got[0]!;
    const off = r.judged !== e.judged ? ['judged']
      : e.judged !== 'none' ? []
        : [...(r.cause !== e.cause ? ['cause'] : []), ...(e.cause === 'no_session' && r.pusher !== e.pusher ? ['pusher'] : []),
          ...(e.cause === 'tree' && r.verdict !== e.verdict ? ['verdict'] : []), ...(e.cause === 'tree' && r.verdict_commit !== e.verdict_commit ? ['verdict_commit'] : [])];
    if (off.length) failures.push(`${name} reads ${sayRow(r)}; it must read ${sayExpect(e)}${e.cause === 'tree' ? `, verdict_commit ${e.verdict_commit}` : ''} (wrong: ${off.join(', ')})`);
  }
  const known = new Set(expected.map((e) => e.commit));
  const added = rows.filter((r) => !known.has(String(r.commit)));
  if (added.length) failures.push(`the reading lists ${added.length} commit${added.length === 1 ? '' : 's'} the default branch didn't gain in the fixture's thirty days: ${added.slice(0, 5).map((r) => `${short(String(r.commit))} as ${said(r.judged)}`).join(', ')}`);
  const want = tally(expected);
  const have = tally(rows);
  const judged = rows.filter((r) => r.judged !== 'none').length;
  if (failures.length || sayTally(want) !== sayTally(have)) {
    failures.push(`the reading is ${sayTally(have)}: it lists ${rows.length} of the ${expected.length} commits the default branch gained, ${judged} of ${rows.length} judged; the fixture is ${sayTally(want)}`);
  }
  if (expected.length) {
    const share = want.none / expected.length;
    if (typeof reading.value !== 'number' || Math.abs(reading.value - share) > 1e-9 || reading.unit !== 'share') {
      failures.push(`the reading's value is ${said(reading.value)} ${said(reading.unit)}; the share with none is ${want.none} of ${expected.length}, ${share} in unit "share"`);
    }
  }
  return failures;
}

/**
 * Criterion 2's judge: the revert's row names what it reverts and is counted as never judged, it is the one such row,
 * and no row is counted as an escape after PASS.
 */
export function judgeRevert(reading: Row | undefined, repo: string, the: { revert: string; of: string; ofReads: string }): string[] {
  if (!reading) return [`numbers.read lists no ${READING} reading for ${repo}`];
  const rows = commitRows(reading);
  const name = `the revert ${short(the.revert)} of ${short(the.of)}, a commit that read ${the.ofReads}`;
  const row = rows.find((r) => r.commit === the.revert);
  if (!row) return [`${name}, has no row`];
  const failures: string[] = [];
  if (row.reverts !== the.of) failures.push(`${name}, doesn't name the commit it reverts: its row's reverts is ${said(row.reverts)}, not ${the.of}`);
  if (row.counted !== 'never_judged') failures.push(`${name}, is counted ${said(row.counted)}${row.counted === 'escape' ? ', an escape after PASS' : ''}; it must be counted "never_judged", apart from the escapes`);
  const never = rows.filter((r) => r.counted === 'never_judged');
  if (never.length !== 1) failures.push(`reverts of a commit never judged: ${never.length} (${never.map((r) => short(String(r.commit))).join(', ') || 'none'}), not one, ${name}`);
  const escapes = rows.filter((r) => r.counted === 'escape');
  if (escapes.length) failures.push(`escapes after PASS: ${escapes.length}, not zero: ${escapes.map((r) => short(String(r.commit))).join(', ')}${escapes.some((r) => r.commit === the.revert) ? `, counting ${name}` : ''}`);
  return failures;
}

/** Every UTC date from `from` to `to`, both inclusive. */
export function datesOf(span: Span): string[] {
  const out: string[] = [];
  for (let at = Date.parse(`${span.from}T00:00:00Z`); at <= Date.parse(`${span.to}T00:00:00Z`) && out.length < 400; at += 86_400_000) out.push(new Date(at).toISOString().slice(0, 10));
  return out;
}
const saySpans = (dates: readonly string[]): string => (dates.length ? `${dates[0]} to ${dates.at(-1)} (${dates.length} date${dates.length === 1 ? '' : 's'})` : 'no date');

/**
 * Criterion 3's judge: the reading says missing for exactly the dates the forge refused the push readings for, a
 * missing row holds no number (no count, no share: missing, never zero), and no commit the forge refused to name has a
 * row. `spans` are the refused dates; `withheld` the commits the pushes of those dates brought.
 */
export function judgeMissing(reading: Row | undefined, repo: string, spans: readonly Span[], withheld: readonly string[]): string[] {
  if (!reading) return [`numbers.read lists no ${READING} reading for ${repo}`];
  const failures: string[] = [];
  const want = [...new Set(spans.flatMap(datesOf))].sort();
  const rows = missingRows(reading);
  const told: string[] = [];
  for (const r of rows) {
    if (typeof r.from !== 'string' || typeof r.to !== 'string' || !DATE.test(r.from) || !DATE.test(r.to) || r.from > r.to) { failures.push(`a missing row's dates aren't a span of UTC dates, from and to as YYYY-MM-DD: ${said(r)}`); continue; }
    told.push(...datesOf({ from: r.from, to: r.to }));
    const numbers = Object.entries(r).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${k} ${String(v)}`);
    if (numbers.length || 'commit' in r || 'judged' in r) failures.push(`the missing row for ${r.from} to ${r.to} gives a number or a judgment for dates it can't read (${numbers.join(', ') || 'a commit'}): ${said(r)}`);
  }
  const have = [...new Set(told)].sort();
  if (have.join() !== want.join()) {
    failures.push(`the reading says missing for ${saySpans(have)}; the forge refused the push readings for ${saySpans(want)}${have.length ? '' : ': that span reads as zero unjudged commits, not as missing'}`);
  }
  const listed = commitRows(reading).filter((r) => withheld.includes(String(r.commit)));
  if (listed.length) failures.push(`the reading lists ${listed.map((r) => `${short(String(r.commit))} as ${said(r.judged)}`).join(', ')}, which the forge refused to name: the pushes of ${saySpans(want)} have no reading`);
  return failures;
}

/**
 * Criterion 5's judge, read from the recorded calls: the forge received no write, a status above all, and the record
 * took no ask and no notification. `unjudged` are the commits that read none, so a status on one is named as such.
 */
export function judgeQuiet(calls: readonly { method: string; path: string; status: number }[], events: readonly { kind: string; id?: string; log_pos?: number }[], unjudged: readonly string[]): string[] {
  const failures: string[] = [];
  for (const c of calls.filter((x) => x.method !== 'GET' && x.method !== 'HEAD')) {
    const sha = /\/statuses\/([0-9a-f]{40})$/.exec(c.path)?.[1];
    failures.push(`the forge received ${c.method} ${c.path} (answered ${c.status})${sha ? `: a status posted on ${unjudged.includes(sha) ? 'the unjudged commit' : 'commit'} ${short(sha)}` : ''}`);
  }
  for (const e of events) {
    if (e.kind === 'ask.created') failures.push(`the record took ${e.kind} ${e.id ?? ''} at log_pos ${String(e.log_pos)}: an ask was raised`);
    if (e.kind === 'notice.sent' || e.kind === 'notice.delivered') failures.push(`the record took ${e.kind} ${e.id ?? ''} at log_pos ${String(e.log_pos)}: a notification was sent`);
  }
  return failures;
}
