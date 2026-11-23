// AC9 #1495.a1f2c768 A fixture release whose history since the previous tag holds two blessing decisions, one for a
// golden where 3.2% of pixels moved by at most 9 code values and one for a corpus document the previous release saved,
// lists both under `Looks that moved` with the fixture, the kind, the cause, 3.2% and 9. A planted generator that reads
// only the contract diff lists neither and fails, naming the first decision.
// AC10 #1495.f010e08b The figures in each row equal the ones in the comparison the decision answered. A planted generator
// that compares the new golden with itself prints 0% and 0 for both rows and fails, naming the fixture and both values.
// AC11 #1495.84b5e71f A fixture release with no blessing decision prints `Looks that moved: none`. A planted generator
// that drops the heading when the list is empty fails, naming the heading.
// AC12 #1495.e029821e With one of the two rows removed by hand, the tag is refused, naming the decision the row stood
// for. A planted tag step that checks only that the heading exists tags the release and fails.
//
// Issue, Scope: "The notes gain a `Looks that moved` list: one row per decision since the previous tag that blessed a
// golden or a corpus difference, with the fixture or document, the kind, the cause as the decision recorded it, the
// share of pixels past the tolerance and the largest change in code values"; "Both figures are read from the failing
// comparison the decision answered, never computed again against the new golden"; "A release with no such decision
// prints the heading with "none", so a missing list never reads as no change"; "The tag step refuses a release while a
// blessing decision since the previous tag has no row". The design's Cutting a release says the same.
//
// Surfaces (README, The contract 7 and 11): blessing decisions in the fixture's history, as the kit's golden store
// (parity/goldens/store.json, `decisions`) and a migration-corpus document (crates/deep-show/kit-corpus/<name>.json,
// `accepted`) record them, each with the cause it recorded and the comparison it answered; `notes` writes
// `<out>/NOTES.md`, whose `Looks that moved` table the tag step reads back.
// Wrong programs: the base (no scripts/release.mjs); `contract-diff-only`, `self-compare`, `drop-empty-heading` and
// `heading-only` (DEEP_RELEASE_PLANT); a list that keeps a decision from before the tag (AC9 counts the rows); a tag
// step that refuses whatever the rows (AC12's twin).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CORPUS, EARLIER, GOLDEN, cleanup, historyRelease, looks, named, notes, npmArchive, percent, preflight, published, refusal, shown, shownShare, tag, tagged,
  world, writeOut, type Decision, type Ran, type World,
} from './helpers.ts';

afterAll(cleanup);

/** The notes a run of `notes` wrote into `out`, after checking it ran. */
function notesOf(r: Ran, out: string): string {
  expect(r.code, `release.mjs notes exits 0:\n${shown(r)}`).toBe(0);
  const file = join(out, 'NOTES.md');
  expect(existsSync(file), `notes writes ${file}`).toBe(true);
  return readFileSync(file, 'utf8');
}

/** AC9's judgement: a row for each decision, with its fixture, kind and cause, the golden's with 3.2% and 9, and no other. */
function judge9(text: string, decisions: readonly Decision[]): string[] {
  const { heading, none, rows } = looks(text);
  const failures: string[] = [];
  for (const d of decisions) {
    const row = rows.find((x) => x.name === d.name);
    if (!row) { failures.push(`Looks that moved has no row for decision ${d.id}, the ${d.kind} ${d.name}`); continue; }
    if (row.kind !== d.kind) failures.push(`${d.name}: the row's kind is ${JSON.stringify(row.kind)}, not ${d.kind} (decision ${d.id})`);
    if (row.cause !== d.cause) failures.push(`${d.name}: the row's cause is ${JSON.stringify(row.cause)}, not the decision's ${JSON.stringify(d.cause)} (decision ${d.id})`);
    if (d === GOLDEN && (Math.abs(percent(row.share) - 3.2) > 0.05 || row.largest !== '9')) failures.push(`${d.name}: the row reads ${row.share} and ${row.largest}, not 3.2% and 9 (decision ${d.id})`);
  }
  if (heading === null) failures.push('NOTES.md has no Looks that moved heading');
  else if (none) failures.push(`the Looks that moved heading says none: ${heading}`);
  if (rows.length !== decisions.length) failures.push(`Looks that moved has ${rows.length} rows, not one per decision since release/1.2.0 (${decisions.length}; ${EARLIER} came before it): ${JSON.stringify(rows.map((x) => x.line))}`);
  return failures;
}
/** AC10's judgement: each row's figures are the ones its decision's comparison recorded. */
function judge10(text: string, decisions: readonly Decision[]): string[] {
  const { rows } = looks(text);
  const failures: string[] = [];
  for (const d of decisions) {
    const row = rows.find((x) => x.name === d.name);
    if (!row) { failures.push(`Looks that moved has no row for ${d.name} (decision ${d.id})`); continue; }
    if (Math.abs(percent(row.share) - d.share * 100) > 0.05 || row.largest !== String(d.largest)) {
      failures.push(`${d.name}: the row reads ${row.share} and ${row.largest}; the comparison decision ${d.id} answered reads ${shownShare(d.share)} and ${d.largest}`);
    }
  }
  return failures;
}
/** AC11's judgement: the heading is there and says none. */
function judge11(text: string): string[] {
  if (/^#{0,6}\s*Looks that moved: none\s*$/m.test(text)) return [];
  const { heading } = looks(text);
  return [heading === null ? 'NOTES.md has no "Looks that moved" heading, so a missing list reads as no change' : `the "Looks that moved" heading doesn't say none: ${heading}`];
}

describe(`${named(9)} Both blessing decisions since the previous tag are listed under Looks that moved`, () => {
  it(`${named(9)} the golden and the corpus document each have a row with their fixture, kind and cause, the golden's with 3.2% and 9; the decision from before the tag has none`, () => {
    const w = world();
    const { commit, decisions } = historyRelease(w, { blessings: true });
    const text = notesOf(notes(w, commit, preflight(w, commit)), w.out);
    expect(judge9(text, decisions), text).toEqual([]);
  }, 300_000);

  it(`${named(9)} (wrong program) contract-diff-only lists neither decision and fails, naming the first decision`, () => {
    const w = world();
    const { commit, decisions } = historyRelease(w, { blessings: true });
    const out = join(w.dir, 'out-contract-diff-only');
    const text = notesOf(notes(w, commit, preflight(w, commit), { out, plant: 'contract-diff-only' }), out);
    expect(looks(text).rows.filter((x) => decisions.some((d) => d.name === x.name)), 'the planted generator lists neither decision').toEqual([]);
    const failures = judge9(text, decisions);
    expect(failures.length, 'the planted generator must fail the judgement, and it passed').toBeGreaterThan(0);
    expect(failures[0], 'the failure names the first decision').toContain(GOLDEN.id);
  }, 300_000);
});

describe(`${named(10)} The figures in each row equal the ones in the comparison the decision answered`, () => {
  it(`${named(10)} the golden's row reads 3.2% and 9 and the corpus document's 1.1% and 4, as their comparisons recorded`, () => {
    const w = world();
    const { commit, decisions } = historyRelease(w, { blessings: true });
    const text = notesOf(notes(w, commit, preflight(w, commit)), w.out);
    expect(judge10(text, decisions), text).toEqual([]);
  }, 300_000);

  it(`${named(10)} (wrong program) self-compare prints 0% and 0 for both rows and fails, naming the fixture and both values`, () => {
    const w = world();
    const { commit, decisions } = historyRelease(w, { blessings: true });
    const out = join(w.dir, 'out-self-compare');
    const text = notesOf(notes(w, commit, preflight(w, commit), { out, plant: 'self-compare' }), out);
    const rows = looks(text).rows;
    for (const d of decisions) {
      const row = rows.find((x) => x.name === d.name);
      expect(row && percent(row.share) === 0 && row.largest === '0', `the planted generator prints 0% and 0 for ${d.name}: ${JSON.stringify(row)}`).toBe(true);
    }
    const failures = judge10(text, decisions);
    expect(failures.length, 'the planted generator must fail the judgement, and it passed').toBeGreaterThan(0);
    const golden = rows.find((x) => x.name === GOLDEN.name)!;
    for (const words of [GOLDEN.name, golden.share, golden.largest, '3.2%', '9']) expect(failures[0], `the failure names the fixture and both values: ${words}`).toContain(words);
  }, 300_000);
});

describe(`${named(11)} A fixture release with no blessing decision prints Looks that moved: none`, () => {
  it(`${named(11)} with no blessing decision since release/1.2.0, the notes say Looks that moved: none`, () => {
    const w = world();
    const { commit } = historyRelease(w, { blessings: false });
    const text = notesOf(notes(w, commit, preflight(w, commit)), w.out);
    expect(judge11(text), text).toEqual([]);
  }, 300_000);

  it(`${named(11)} (wrong program) drop-empty-heading fails, naming the heading`, () => {
    const w = world();
    const { commit } = historyRelease(w, { blessings: false });
    const out = join(w.dir, 'out-drop-empty-heading');
    const text = notesOf(notes(w, commit, preflight(w, commit), { out, plant: 'drop-empty-heading' }), out);
    const failures = judge11(text);
    expect(failures.length, `the planted generator must fail the judgement, and it passed:\n${text}`).toBeGreaterThan(0);
    expect(failures[0], 'the failure names the heading').toContain('Looks that moved');
  }, 300_000);
});

/** A release with both blessing decisions, packed and signed, its notes written; the report for its commit. */
function cutWithBlessings(): { w: World; commit: string; report: string; notesFile: string } {
  const w = world();
  const { commit } = historyRelease(w, { blessings: true });
  writeOut(w, commit, [npmArchive(w, '@deepbuild/deep-hook-darwin-arm64', '1.3.0', { 'bin/deep-hook': '#!/bin/sh\necho 1.3.0\n' })]);
  const report = preflight(w, commit);
  notesOf(notes(w, commit, report), w.out);
  return { w, commit, report, notesFile: join(w.out, 'NOTES.md') };
}
/** Removes, by hand, the table row of `name` from the notes. */
function removeRow(file: string, name: string): void {
  const text = readFileSync(file, 'utf8');
  const row = looks(text).rows.find((x) => x.name === name);
  expect(row, `the notes have a row for ${name} to remove`).toBeDefined();
  writeFileSync(file, text.split('\n').filter((l) => l.trim() !== row!.line).join('\n'));
  expect(looks(readFileSync(file, 'utf8')).rows.map((x) => x.name)).not.toContain(name);
}

describe(`${named(12)} With one of the two rows removed by hand, the tag is refused, naming the decision the row stood for`, () => {
  it(`${named(12)} the twin: with both rows as the release wrote them, the tag goes through`, () => {
    const { w, commit, report } = cutWithBlessings();
    const t = tag(w, commit, report);
    expect(t.code, shown(t)).toBe(0);
    expect(tagged(w, '1.3.0')).toBe(commit);
  }, 300_000);

  it(`${named(12)} with the corpus document's row removed, the tag is refused, naming ${CORPUS.id}`, () => {
    const { w, commit, report, notesFile } = cutWithBlessings();
    removeRow(notesFile, CORPUS.name);
    const t = tag(w, commit, report);
    expect(refusal(w, t, '1.3.0', [CORPUS.id]), shown(t)).toEqual([]);
  }, 300_000);

  it(`${named(12)} (wrong program) heading-only tags the release with the row missing, and fails this test`, () => {
    const { w, commit, report, notesFile } = cutWithBlessings();
    removeRow(notesFile, CORPUS.name);
    const t = tag(w, commit, report, { plant: 'heading-only' });
    expect(tagged(w, '1.3.0'), `the planted tag step tags the release:\n${shown(t)}`).toBe(commit);
    expect(published(w).length, 'and publishes it').toBeGreaterThan(0);
    expect(refusal(w, t, '1.3.0', [CORPUS.id]).length, 'the planted tag step must fail the judgement, and it passed').toBeGreaterThan(0);
  }, 300_000);
});
