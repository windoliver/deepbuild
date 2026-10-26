// AC1: zoom that shows what needs you, not a list. In a fixture project whose Postgres part holds 12 tables, 3 of
// them changed this week, zooming into Postgres shows the 9 tables ranked first, the 3 changed ones among them, each
// with what it holds, folds the other 3 into one count and shows no file; a check that points at one migration file
// adds that file alone, beside the check; a planted level that lists the part's files fails, naming the part.
// Driven through `deep-salience zoom` (README: The surface under test). At the base `deep-salience` has only `level`
// and exits 2 with its usage line for `zoom`.
import { describe, expect, it } from 'vitest';
import { SALIENCE_BIN, clone, fixture, lines, obj, str, stringsIn, useBins, zoomed, type JsonObject, type JsonValue, type Zoomed } from './helpers.ts';

const bins = useBins([SALIENCE_BIN]);

const PROJECT = fixture('project.json');
const parts = (PROJECT['parts'] as JsonObject[]);
const POSTGRES_FILES = (parts.find((p) => p['id'] === 'postgres')!['files'] as string[]);
const ALL_FILES = parts.flatMap((p) => p['files'] as string[]);
const rows = PROJECT['rows'] as JsonObject[];
const TABLES = rows.filter((r) => r['kind'] === 'table' && r['level'] === 'postgres');
const CHANGED = TABLES.filter((r) => (r['facts'] as JsonObject)['changed'] === true).map((r) => String(r['id'])).sort();
const UNCHANGED = TABLES.filter((r) => (r['facts'] as JsonObject)['changed'] !== true).map((r) => String(r['id'])).sort();
// Ranked by salience@1 (#394): changed since you last looked, then ID. The 9 ranked first are the 3 changed and the
// first 6 unchanged by ID; the other 3 fold. Neither the first 9 by ID nor the first 9 in input order is this set.
const SHOWN = [...CHANGED, ...UNCHANGED.slice(0, 6)];
const FOLDED = UNCHANGED.slice(6);
const HOLDS = new Map(TABLES.map((r) => [String(r['id']), String(r['holds'])]));
const MIGRATION = 'db/migrations/0007_add_refunds.sql';
const CHECK = 'check:migrations-apply';

type ZoomPlanted = 'files_as_items' | 'evidence_by_folder' | 'level_rule_off';
function zoom(project: JsonObject, planted?: ZoomPlanted): JsonObject {
  const input: JsonObject = { project, open: 'postgres', fits: 9, ...(planted ? { planted } : {}) };
  return lines(bins.bin(SALIENCE_BIN), ['zoom'], [input])[0]!;
}
const withCheck = (): JsonObject => {
  const p = clone(PROJECT);
  p['checks'] = [{ id: CHECK, part: 'postgres', verdict: 'FAIL', points_at: [MIGRATION] }];
  return p;
};
/** The planted level: a map layer that lists the part's files as rows of Postgres's own level. */
const filesLevel = (): JsonObject => {
  const p = clone(PROJECT);
  const listed: JsonValue[] = POSTGRES_FILES.map((path, i) => ({
    id: `postgres.file${i}`, kind: 'file', parent: 'postgres', level: 'postgres', name: path, holds: path,
    facts: { needs_you: false, sent_back: false, failing: false, lacks_proof: false, touched: false, changed: false, priority: 0 },
  }));
  p['rows'] = [...(p['rows'] as JsonValue[]), ...listed];
  return p;
};

/** What the criterion's first sentence asks of the Postgres level, as failures; empty when it holds. */
function levelFailures(z: Zoomed): string[] {
  const out: string[] = [];
  const ids = z.shown.map((s) => s.id);
  if (JSON.stringify(ids) !== JSON.stringify(SHOWN)) out.push(`the level shows ${JSON.stringify(ids)}, not the 9 tables ranked first, in rank order: ${JSON.stringify(SHOWN)}`);
  for (const s of z.shown) {
    if (s.kind !== 'table') out.push(`the level shows ${s.id} of kind ${s.kind}; zooming into Postgres shows its tables`);
    if (HOLDS.has(s.id) && s.holds !== HOLDS.get(s.id)) out.push(`${s.id} shows ${JSON.stringify(s.holds)} for what it holds, not ${JSON.stringify(HOLDS.get(s.id))}`);
  }
  for (const c of CHANGED) {
    const s = z.shown.find((x) => x.id === c);
    if (!s) out.push(`the changed table ${c} isn't among the tables shown`);
    else if (!s.reasons.includes('changed')) out.push(`the changed table ${c} doesn't give changed among its reasons: ${JSON.stringify(s.reasons)}`);
  }
  const ranks = z.shown.map((s) => s.rank);
  if (ranks.some((r, i) => i > 0 && r <= ranks[i - 1]!)) out.push(`the shown tables' ranks don't increase in order: ${JSON.stringify(ranks)}`);
  if (z.fold === null) out.push('nothing folds; the other 3 tables fold into one count');
  else {
    if (z.fold.count !== 3 || JSON.stringify([...z.fold.items].sort()) !== JSON.stringify(FOLDED)) out.push(`the fold holds ${z.fold.count}: ${JSON.stringify(z.fold.items)}, not the other 3 tables ${JSON.stringify(FOLDED)}`);
    if (!z.fold.line.startsWith('3 more')) out.push(`the fold's line ${JSON.stringify(z.fold.line)} doesn't start with its count, "3 more"`);
  }
  return out;
}
/** Every file of the project the answer names anywhere, in any field. */
const filesNamed = (answer: JsonObject): string[] => [...new Set(stringsIn(answer).filter((s) => ALL_FILES.includes(s)))].sort();

describe('AC1 zooming into Postgres shows what you need to know about its tables, not a list of its files', () => {
  it('AC1 the 9 tables ranked first, the 3 changed ones among them, each with what it holds; the other 3 folded into one count; no file', () => {
    const z = zoomed(zoom(PROJECT), 'zoom into postgres');
    expect(levelFailures(z), 'the Postgres level').toEqual([]);
    expect(filesNamed(z.raw), 'the Postgres level names no file (files show only as evidence, beside a check that points there)').toEqual([]);
    expect(z.evidence, 'no check points at a file, so the level holds no evidence').toEqual([]);
    // The tables' own children (orders' columns, two of them changed) load only when their level is reached.
    expect(stringsIn(z.raw).filter((s) => s.startsWith('postgres.orders.')), 'no column of a table shows at the part\'s level').toEqual([]);

    // Wrong program: a level that adds the part's files as items fails, naming a file.
    const twin = zoom(PROJECT, 'files_as_items');
    expect(twin['ok'], `the planted files_as_items level is answered: ${JSON.stringify(twin).slice(0, 400)}`).toBe(true);
    expect(filesNamed(twin).length, 'the planted files_as_items level names the part\'s files, so the check above fails on it').toBeGreaterThan(0);
  });

  it('AC1 a check that points at one migration file adds that file alone, beside the check', () => {
    const z = zoomed(zoom(withCheck()), 'zoom into postgres with a check on a migration');
    expect(z.evidence, `the level holds the file the check points at, beside ${CHECK}, and nothing else as evidence`).toEqual([{ check: CHECK, files: [MIGRATION] }]);
    expect(filesNamed(z.raw), `the only file the level names is ${MIGRATION}`).toEqual([MIGRATION]);
    const elsewhere = { ...z.raw, evidence: [] };
    expect(stringsIn(elsewhere).filter((s) => s === MIGRATION), `${MIGRATION} shows beside its check only, not as one of the level's items or in its fold`).toEqual([]);

    // Wrong program: evidence that adds every file in the pointed file's folder fails.
    const twin = zoomed(zoom(withCheck(), 'evidence_by_folder'), 'the planted evidence_by_folder level');
    expect(filesNamed(twin.raw).length, 'the planted evidence_by_folder level names more than the one file, so the check above fails on it').toBeGreaterThan(1);
  });

  it('AC1 a planted level that lists the part\'s files fails, naming the part', () => {
    const answer = zoom(filesLevel());
    expect(answer['ok'], `a level that lists Postgres's files fails: ${JSON.stringify(answer).slice(0, 600)}`).toBe(false);
    expect(str(answer['code'], 'the failure\'s code').length, 'the failure has a code').toBeGreaterThan(0);
    expect(answer['part'], 'the failure names the part whose level lists its files').toBe('postgres');

    // Wrong program: with the level rule off, the files show as the level's items and nothing fails.
    const twin = zoom(filesLevel(), 'level_rule_off');
    expect(twin['ok'], 'with the planted level_rule_off the same level is answered ok, so the check above fails on it').toBe(true);
    expect(filesNamed(obj(twin, 'twin')).length, 'and it names the part\'s files').toBeGreaterThan(0);
  });
});
