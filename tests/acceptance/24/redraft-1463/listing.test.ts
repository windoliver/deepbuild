// #24.bbe12971, its listing part, redrafted blind (README.md here): `deep inbox` lists each open ask once, with
// its kind, session and age, and no closed ask, in the design's layout (States people see: "`deep inbox` puts the
// question first and the handle last"). The criterion's perf-lane part stays in ../budgets.test.ts.
//
// One record, seeded before the hub starts through the real record and asks core (../helpers.ts): three open
// asks of three kinds in three sessions, raised 2 days 3 hours, 3 hours 5 minutes and 5 minutes 5 seconds ago,
// and a fourth answered on the app's card, closed. `deep inbox` runs once, by you, and the tests read its output.

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AskKind } from '../../../../packages/asks/src/index.ts';
import { askData, CLI, cleanup, DAY, deep, HOUR, MINUTE, seed, startHub, tempDir, type Ran } from '../helpers.ts';

const ID = '#24.bbe12971';

type Unit = 'd' | 'h' | 'm';
const SIZE: Record<Unit, number> = { d: DAY, h: HOUR, m: MINUTE };
/** How a whole number of the unit may be written: `2d`, `2 d`, `2 days`; `3h`, `3 hr`, `3 hours`; `5m`, `5 min`, `5 minutes`. */
const UNIT_WORDS: Record<Unit, string> = { d: 'd(?:ays?)?', h: 'h(?:rs?|ours?)?', m: 'm(?:ins?|inutes?)?' };

interface Open { kind: AskKind; session: string; subject: string; raised: number; deadline: number; unit: Unit; ask: string; question: string }

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** A whole token: not inside a longer run of letters and digits (so `S1` is never found inside a ULID). */
const token = (text: string): RegExp => new RegExp(`(?<![0-9A-Za-z])${escape(text)}(?![0-9A-Za-z])`);

const now = Date.now();
const open: Open[] = [
  { kind: 'taste', session: 'S1', subject: 'the header', raised: now - 2 * DAY - 3 * HOUR, deadline: now + DAY, unit: 'd', ask: '', question: '' },
  { kind: 'authority', session: 'S2', subject: 'feature/login', raised: now - 3 * HOUR - 5 * MINUTE, deadline: now + 20 * HOUR, unit: 'h', ask: '', question: '' },
  { kind: 'definition', session: 'S3', subject: 'offline mode', raised: now - 5 * MINUTE - 5_000, deadline: now + 4 * HOUR, unit: 'm', ask: '', question: '' },
];
for (const o of open) o.question = String(askData(o.kind, o.subject, o.raised, o.deadline).question);
let closed = '';
let listing: Ran;
let ranFrom = 0;
let ranTo = 0;

/** The output's lines that hold the handle. */
const linesOf = (handle: string): string[] => listing.stdout.split('\n').filter((line) => line.includes(handle));
/** The one line that lists the ask; the first test holds that there is exactly one. */
const lineOf = (o: Open): string => {
  const lines = linesOf(o.ask);
  if (lines.length !== 1) throw Error(`deep inbox lists the open ${o.kind} ask ${o.ask} on ${lines.length} lines, not one:\n${listing.stdout}`);
  return lines[0]!;
};
/** The ask's line without its question, its handle and a link to it: the fields the kind, session and age are read from. */
const fieldsOf = (o: Open): string => lineOf(o).replace(o.question, ' ').replace(`deepbuild://ask/${o.ask.slice('ask:'.length)}`, ' ').replace(o.ask, ' ');

beforeAll(async () => {
  if (!existsSync(CLI)) throw Error(`BLOCKED: the built CLI ${CLI} is missing; run npm run build --workspaces first`);
  const home = join(tempDir(), 'h');
  mkdirSync(home);
  await seed(home, async (s) => {
    for (const o of open) {
      s.at(o.raised);
      await s.start(o.session);
      o.ask = await s.raise(o.session, o.kind, o.subject, o.deadline);
    }
    // A choice ask in S3, raised with S3's definition ask and answered on the app's card: closed.
    closed = await s.raise('S3', 'choice', 'the store', now + DAY);
    await s.answerOnCard(closed, 'files');
  }, open[0]!.raised);
  for (const handle of [...open.map((o) => o.ask), closed]) {
    if (!/^ask:[0-9A-Za-z]+$/.test(handle)) throw Error(`BLOCKED: the asks core gave the handle ${JSON.stringify(handle)}, not ask:<ULID>`);
  }
  await startHub(home, { confirm: 'cancelled' });
  ranFrom = Date.now();
  listing = await deep(home, ['inbox']);
  ranTo = Date.now();
}, 120_000);

afterAll(cleanup, 30_000);

describe(`${ID} deep inbox lists the open asks`, () => {
  it(`${ID} deep inbox lists each open ask once, on one line, and no closed ask`, () => {
    expect(listing.code, `deep inbox exits 0:\n${listing.stdout}${listing.stderr}`).toBe(0);
    for (const o of open) {
      expect(linesOf(o.ask), `deep inbox lists the open ${o.kind} ask ${o.ask} of session ${o.session} on exactly one line:\n${listing.stdout}`).toHaveLength(1);
    }
    const ulid = closed.slice('ask:'.length);
    expect(listing.stdout.split('\n').filter((line) => line.includes(ulid)), `deep inbox lists no line for ${closed}, the choice ask answered on the card`).toEqual([]);
  });

  it(`${ID} each open ask's line shows its kind, its session and its age`, () => {
    expect(listing.code, `deep inbox exits 0:\n${listing.stdout}${listing.stderr}`).toBe(0);
    for (const o of open) {
      const line = lineOf(o);
      const fields = fieldsOf(o);
      expect(new RegExp(`\\b${o.kind}\\b`, 'i').test(fields), `the line of ${o.ask} shows its kind, ${o.kind}, outside its question and handle: ${line}`).toBe(true);
      expect(token(o.session).test(fields), `the line of ${o.ask} shows its session, ${o.session}, outside its question and handle: ${line}`).toBe(true);
      // Its age: how long since it was raised, in whole units of the largest that is at least 1, as of the run.
      const counts = [...new Set([ranFrom, ranTo].map((t) => Math.floor((t - o.raised) / SIZE[o.unit])))];
      const age = new RegExp(`(?<![0-9A-Za-z])(?:${counts.join('|')})\\s?${UNIT_WORDS[o.unit]}(?![0-9A-Za-z])`);
      expect(age.test(fields), `the line of ${o.ask}, raised ${new Date(o.raised).toISOString()}, shows its age, ${counts.map((n) => `${n}${o.unit}`).join(' or ')}: ${line}`).toBe(true);
    }
  });

  it(`${ID} each open ask's line puts its question first and its handle last`, () => {
    expect(listing.code, `deep inbox exits 0:\n${listing.stdout}${listing.stderr}`).toBe(0);
    for (const o of open) {
      const line = lineOf(o);
      const at = line.indexOf(o.question);
      expect(at, `the line of ${o.ask} holds its question, "${o.question}", whole: ${line}`).toBeGreaterThanOrEqual(0);
      expect(line.slice(0, at), `the line of ${o.ask} starts with its question, "${o.question}": nothing but a glyph or spaces before it: ${line}`).not.toMatch(/[0-9A-Za-z]/);
      const last = new RegExp(`${escape(o.ask)}(?:\\s+deepbuild://ask/${o.ask.slice('ask:'.length)})?\\s*$`);
      expect(last.test(line), `the line of ${o.ask} ends with its handle, ${o.ask} (a deepbuild://ask/ link to it may follow): ${line}`).toBe(true);
    }
  });
});
