// #1959.fd45405b: "Four corpus documents at shelf.bookcase@1 with {width 0.8, levels 4} differ only in `dividers`: left
// out, 0, 2 and 3. Through both steps they open at @3 with partitions 1, 0, 2 and 3, each with span 0.8 and depth 0.2.
// A planted migrator that treats 0 as left out gives the second document partitions 1 and fails, naming the item and
// the param"
//
// asserts: in `r1`, with acme/shelf@1.0.0, @2.0.0 and @3.0.0 installed (fixtures/packs), acme/shelf@3.0.0's four @1
// corpus documents (the fixture checked first: items shelf-out, shelf-0, shelf-2 and shelf-3 at shelf.bookcase@1 with
// {width 0.8, levels 4} and dividers left out, 0, 2 and 3) each presented under acme/shelf@3.0.0 raise no error, raise
// exactly two `migrated` notices for their item, @1 to @2 and @2 to @3, and expand it as shelf.bookcase@3 with
// partitions 1, 0, 2 and 3 (read as the number of derived walls, `<item>.walls.<i>`), span 0.8 (the plan strip's width,
// in metres) and depth 0.2 (its depth), and with exactly the values the @1 release recorded for that document. Under
// the planted migrator `migration_zero_as_left_out` the same check fails with a failure naming shelf-0 and partitions.
// Wrong programs: the merge base, which knows no such planted value (bad_input); the planted migrator.

import { expect, it } from 'vitest';
import {
  CASE_DOCS, KIND, PACKS, V3, allInstalled, corpusRecords, errors, expansionOf, isObject, issues, migratedSteps, namesId, none,
  pinned, present, run, scenario, show, soleItem, useBinary, useFolders, valuesFailures, type CorpusRecord, type JsonObject,
} from './helpers.ts';

const bin = useBinary();
const folders = useFolders();

/** Each document's item, its `dividers` (undefined: left out) and the partitions it opens with at @3. */
const CASES: { id: string; dividers: number | undefined; partitions: number }[] = [
  { id: 'shelf-out', dividers: undefined, partitions: 1 },
  { id: 'shelf-0', dividers: 0, partitions: 0 },
  { id: 'shelf-2', dividers: 2, partitions: 2 },
  { id: 'shelf-3', dividers: 3, partitions: 3 },
];

/** The four @1 corpus documents of acme/shelf@3.0.0, in CASES' order, each checked to be what the criterion says. */
function documents(): CorpusRecord[] {
  const records = corpusRecords(V3, 1);
  return CASES.map((c) => {
    const found = records.filter((r) => isObject(r.document['items']) && c.id in r.document['items']);
    expect(found.length, `acme/shelf@3.0.0's @1 corpus holds one document of ${c.id}`).toBe(1);
    const [id, item] = soleItem(found[0]!.document, `the corpus document of ${c.id}`);
    const params = { width: 0.8, levels: 4, ...(c.dividers === undefined ? {} : { dividers: c.dividers }) };
    expect([id, item['kind'], item['params']], `the fixture: ${c.id} at @1 with {width 0.8, levels 4}, dividers ${c.dividers ?? 'left out'}`).toEqual([c.id, KIND(1), params]);
    return found[0]!;
  });
}

/** The plan strip's box, `[x, y, w, h]` in u at 100 u a metre: its width is the span, its depth the depth. */
function planBox(derived: JsonObject, id: string): number[] | undefined {
  const plan = derived[`${id}.plan`];
  const box = isObject(plan) && isObject(plan['params']) ? plan['params']['box'] : undefined;
  return Array.isArray(box) && box.every((n) => typeof n === 'number') ? (box as number[]) : undefined;
}

/**
 * The criterion's check on one document's reply: each failure names the item, and the param (`partitions`, `span`,
 * `depth`) or what else is wrong.
 */
function caseFailures(reply: JsonObject, c: (typeof CASES)[number], recorded: JsonObject): string[] {
  const failures: string[] = [];
  const what = `${c.id} (dividers ${c.dividers ?? 'left out'})`;
  for (const i of errors(issues(reply, what))) failures.push(`${c.id} raises an error: ${show(i.raw, 600)}`);
  const steps = migratedSteps(reply).filter((s) => s.id === c.id).map((s) => `@${s.from}→@${s.to}`).sort();
  if (show(steps) !== show(['@1→@2', '@2→@3'])) failures.push(`${c.id} raised migrated ${show(steps)}, not @1→@2 and @2→@3: ${show(reply['notices'] ?? null, 600)}`);
  const e = expansionOf(reply, c.id);
  if (!e) return [...failures, `${c.id} has no expansion: ${show(reply, 800)}`];
  if (e.kind !== KIND(3)) failures.push(`${c.id} opens as ${e.kind}, not ${KIND(3)}`);
  const walls = Object.keys(e.derived).filter((d) => new RegExp(`^${c.id}\\.walls\\.\\d+$`).test(d)).length;
  if (walls !== c.partitions) failures.push(`${what} opens with partitions ${walls}, not ${c.partitions}`);
  const box = planBox(e.derived, c.id);
  if (!box) failures.push(`${c.id} draws no plan strip, so neither its span nor its depth reads`);
  else {
    if (Math.abs(box[2]! / 100 - 0.8) > 1e-9) failures.push(`${c.id} opens with span ${box[2]! / 100}, not 0.8`);
    if (Math.abs(box[3]! / 100 - 0.2) > 1e-9) failures.push(`${c.id} opens with depth ${box[3]! / 100}, not 0.2`);
  }
  for (const f of valuesFailures(e.derived, recorded)) failures.push(`${c.id}'s values differ from those its @1 release recorded: ${f}`);
  return failures;
}

/** Presents the four documents under acme/shelf@3.0.0, each on its own board; the replies in CASES' order. */
function openAll(records: CorpusRecord[], planted?: string): JsonObject[] {
  const calls = [PACKS, ...records.map((r, i) => present(CASE_DOCS[i]!, pinned(r.document, V3)))];
  const [packs, ...opened] = run(bin(), scenario(folders.evidence(), calls, planted ? { planted } : {}));
  allInstalled(packs!);
  return opened;
}

it('#1959.fd45405b four @1 corpus documents {width 0.8, levels 4} with dividers left out, 0, 2 and 3 open through both steps at @3 with partitions 1, 0, 2 and 3, each with span 0.8 and depth 0.2', () => {
  const records = documents();
  const opened = openAll(records);
  CASES.forEach((c, i) => none(caseFailures(opened[i]!, c, records[i]!.values), `${c.id} under acme/shelf@3.0.0`));
}, 1_800_000);

it('#1959.fd45405b a planted migrator that treats 0 as left out (migration_zero_as_left_out) gives the second document partitions 1 and fails, naming the item and the param', () => {
  const records = documents();
  const opened = openAll(records, 'migration_zero_as_left_out');
  const failures = CASES.flatMap((c, i) => caseFailures(opened[i]!, c, records[i]!.values));
  expect(failures.some((f) => namesId(f, 'shelf-0') && /\bpartitions 1\b/.test(f)), `the check fails giving shelf-0 partitions 1, naming the item and the param:\n  ${failures.join('\n  ')}`).toBe(true);
}, 1_800_000);
