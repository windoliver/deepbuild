// AC1: "The piece is presented with no issues and its document checks read PASS keyed to the revision's hash; a patch
// to one bar's table value makes that PASS stale. In a test build without the data module the rest still draws,
// deep_kinds lists the data module's kinds unavailable with module_missing, and the claim reads BLOCKED naming the
// chart's kind, never PASS"
//
// asserts: the agent imports its table and sends the piece with `deep show --check` against the claim (#403): the reply
// is presented with `issues: []`; the verdict is PASS, every requirement PASS, not stale, keyed by the current
// revision's hash. The agent then writes the table again with bar 2's value changed and sends the piece reading it (the
// only change: `assets.sales.sha256`): a new revision, and the earlier PASS now reads stale, still keyed by the earlier
// hash. In the build without the data module (README) the piece is presented, its snapshot is not blank and the
// reply's visible items hold the title, the formula, the badge and the count but no bar or bar label; deep_kinds lists
// marks@1 and scale@1 with `available: false` and `code: module_missing`; the claim is BLOCKED with a requirement's
// `blocked` naming `module_missing` for `marks@1`.
// Wrong programs: a check that warns on any part of the piece; a verdict keyed by the document, not its revision; a
// build that refuses the whole piece, or draws nothing, without data; a listing that drops the missing module's kinds;
// a claim that passes or reads INCONCLUSIVE without the chart.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLAIM, DOC, REVISIONS, TABLE, TABLE_PATCHED, VERDICTS_CALL, VERDICT_CALL, arr, blankGuard, current, importTable, isObject, issues, keepProof, obj,
  piece, readEvidence, runShow, scenario, seedStore, sha256, show, shown, showChecked, snapshots, str, useBuilds, useDir, verdictOf, withTable,
  type JsonObject,
} from './helpers.ts';

const builds = useBuilds(['deep-show', 'deep-show-no-data']);
const dir = useDir();
const SALES = sha256(readFileSync(TABLE));
const PATCHED = sha256(readFileSync(TABLE_PATCHED));

describe('AC1 the piece through deep show, held to its checks', () => {
  it('AC1 the piece is presented with no issues, its checks PASS keyed to the revision\'s hash, and a patch to one bar\'s table value makes that PASS stale', () => {
    const evidence = dir();
    seedStore(evidence);
    const calls: JsonObject[] = [
      importTable(), showChecked(piece()), REVISIONS, VERDICT_CALL,
      importTable(TABLE_PATCHED), show(withTable(PATCHED)), REVISIONS, VERDICTS_CALL,
    ];
    const [r] = runShow(builds.bin('deep-show'), [scenario(evidence, calls)], 'AC1');
    const [imported, shownReply, before, first, importedAgain, patched, after, listed] = r!;
    keepProof('ac1-piece.json', piece());
    keepProof('ac1-replies.json', r!);
    expect(obj(imported!['asset'], `AC1 table_import: asset (${shown(imported)})`)['sha256'], 'AC1: the hub keeps the agent\'s table by the hash the piece names').toBe(SALES);
    expect(obj(importedAgain!['asset'], 'AC1 the second table_import: asset')['sha256'], 'AC1: the patched table is kept by its own hash').toBe(PATCHED);
    expect(shownReply!['outcome'], `AC1: the piece is presented: ${shown(shownReply)}`).toBe('presented');
    expect(issues(shownReply!['issues'], 'AC1 the piece').map((i) => i.raw), 'AC1: the piece is presented with no issues of any severity').toEqual([]);
    // A notice is an issue's severity too: an `unknown_kind` notice means an item was skipped.
    expect(issues(shownReply!['notices'], 'AC1 the piece\'s notices').map((i) => i.raw), 'AC1: the piece is presented with no notices').toEqual([]);
    const was = current(before!, 'AC1 before the patch');
    const v = verdictOf(first, 'AC1 the verdict');
    expect(v.result, `AC1: the claim on the piece is PASS: ${shown(v.raw, 2000)}`).toBe('PASS');
    for (const row of v.rows) expect(row.result, `AC1: requirement ${row.id} reads PASS: ${shown(row.raw)}`).toBe('PASS');
    expect(v.rows.length, 'AC1: the verdict has a row for each of the claim\'s three document checks').toBe(3);
    expect(v.stale, 'AC1: the PASS is not stale before any patch').toBe(false);
    expect(v.key.find((k) => k.doc.toLowerCase() === DOC.toLowerCase())?.hash, 'AC1: the PASS is keyed to the presented revision\'s hash').toBe(was.hash);
    // The patch: one bar's value in the agent's table changed, so a new revision of the piece.
    expect(patched!['outcome'], `AC1: the piece reading the patched table is presented: ${shown(patched)}`).toBe('presented');
    const now = current(after!, 'AC1 after the patch');
    expect(now.hash, 'AC1: the patch makes a new revision with another hash').not.toBe(was.hash);
    const old = arr(obj(listed, 'AC1 verdicts')['verdicts'], 'AC1 verdicts: the list').map((x, i) => verdictOf(x, `AC1 verdicts[${i}]`))
      .find((x) => x.key.some((k) => k.hash === was.hash));
    expect(old, `AC1: the verdicts list the PASS made on revision ${was.rev}: ${shown(listed, 2000)}`).toBeDefined();
    expect(old!.result, 'AC1: the earlier verdict was PASS').toBe('PASS');
    expect(old!.stale, `AC1: the PASS on revision ${was.rev} reads stale once bar 2's table value changed (claim ${CLAIM})`).toBe(true);
  }, 1_800_000);

  it('AC1 in a test build without the data module the rest still draws, deep_kinds lists the data module\'s kinds unavailable with module_missing, and the claim reads BLOCKED naming the chart\'s kind', async () => {
    const evidence = dir();
    seedStore(evidence);
    const bin = builds.bin('deep-show-no-data');
    const [r] = runShow(bin, [scenario(evidence, [importTable(), showChecked(piece()), VERDICT_CALL])], 'AC1 without data');
    const [, shownReply, verdict] = r!;
    keepProof('ac1-no-data-replies.json', r!);
    expect(shownReply!['outcome'], `AC1 without data: the rest of the piece is presented, not refused whole: ${shown(shownReply, 2000)}`).toBe('presented');
    const [snap] = snapshots(shownReply!, 'AC1 without data');
    expect(snap, 'AC1 without data: a snapshot of what still draws').toBeDefined();
    const png = await readEvidence(evidence, snap!.sha256);
    keepProof('ac1-no-data-snapshot.png', png);
    blankGuard(png, 'AC1 without data: the snapshot');
    const visible = arr(shownReply!['visible'], `AC1 without data: the reply's visible items (${shown(shownReply)})`).map((v) => str(obj(v, 'visible row')['id'], 'visible id'));
    for (const id of ['title', 'formula', 'badge', 'readout']) expect(visible, `AC1 without data: ${id} still draws`).toContain(id);
    for (const id of ['bars', 'labels']) expect(visible, `AC1 without data: the data module's ${id} doesn't draw`).not.toContain(id);
    // deep_kinds: the kind registry, every page.
    const entries: JsonObject[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const [[reply]] = runShow(bin, [scenario(evidence, [{ call: 'deep_kinds', op: 'list', registry: 'kind@1', ...(cursor ? { cursor } : {}) }])], `AC1 deep_kinds page ${page + 1}`) as [[JsonObject]];
      expect(reply['error'], `AC1 deep_kinds list answers: ${shown(reply)}`).toBeUndefined();
      for (const reg of arr(reply['registries'], 'AC1 deep_kinds: registries')) if (isObject(reg)) for (const e of arr(reg['entries'] ?? [], 'entries')) if (isObject(e)) entries.push(e);
      cursor = typeof reply['next'] === 'string' && reply['next'] !== '' ? reply['next'] : undefined;
      if (!cursor) break;
    }
    keepProof('ac1-no-data-kinds.json', entries);
    for (const kind of ['marks@1', 'scale@1']) {
      const e = entries.find((x) => x['name'] === kind);
      expect(e, `AC1 without data: deep_kinds lists the data module's kind ${kind}`).toBeDefined();
      expect(e!['available'], `AC1 without data: ${kind} is listed unavailable: ${shown(e)}`).toBe(false);
      expect(e!['code'], `AC1 without data: ${kind} is listed with module_missing: ${shown(e)}`).toBe('module_missing');
    }
    const v = verdictOf(verdict, 'AC1 without data: the verdict');
    expect(v.result, `AC1 without data: the claim reads BLOCKED, never PASS: ${shown(v.raw, 2000)}`).toBe('BLOCKED');
    const named = v.rows.flatMap((row) => row.blocked).filter((b) => b.code === 'module_missing' && b.kind === 'marks@1');
    expect(named.length, `AC1 without data: a requirement is BLOCKED by module_missing naming the chart's kind marks@1: ${shown(v.raw, 2000)}`).toBeGreaterThan(0);
  }, 1_800_000);
});
