// AC11 #148.5ea00b01: With three target files where the second won't parse, a sync writes none of them, by digests
// before and after, and names the file; a sync that writes the first file before parsing the second fails this test,
// naming it.
// AC12 #148.51e021f8: A test edit made to a target file between the plan and its replace is kept: the sync plans again
// on the new bytes, and the file ends with both the edit and DeepBuild's entry; a sync that replaces from its first plan
// loses the edit and fails this test, naming the file.
// AC13 #148.36f090c8: Before DeepBuild's first write to Codex's `config.toml`, the file's original bytes are kept once, by
// hash; after two syncs, removing DeepBuild from Codex restores those bytes; a host that takes the copy again before each
// write restores the first sync's output and fails this test, naming the path.
// AC14 #148.f24103f9: Each replace is followed by a flush of its folder, by a trace of the sync's file calls through the
// storage seam; a sync with no folder flush after its rename fails this test, naming the folder.
//
// Each criterion's check is one function; its test runs it on the hub as it is, and its twin runs the same function on
// the planted wrong program the criterion names (DEEP_HUB_PLANT, README: Plants), which must fail it, naming what the
// criterion says.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, answer, approve, claudeJson, codexList, codexToml, deep, digest, failsNaming, failureOf, harmlessEdit, invalidEdit, makeWorld, names, parse, piJson, propose, ranText, same, sha256,
  shown, snapshot, startHub, stdioServer, syncReaches, tag, useCleanup, type Line,
} from './helpers.ts';

useCleanup();
const THREE = ['claude-code', 'codex', 'pi'];

/** AC11: claude-code, codex, pi in that order; Codex's config.toml, the second, stops parsing between the plan and your yes. */
async function secondWontParse(plant?: string): Promise<void> {
  const w = await makeWorld();
  await startHub(w, { plant });
  const p = await propose(w, { via: 'app', server: stdioServer(w, `forge-${tag()}`), agents: THREE });
  const targets = [claudeJson(w), codexToml(w), piJson(w)];
  for (const t of targets) expect(p.files.some((f) => same(f.path, t)), `the plan has ${t}: ${shown(p.files)}`).toBe(true);
  invalidEdit(codexToml(w));
  const before = targets.map(digest);
  await answer(w, p.ask, 'apply');
  const s = await syncReaches(w, p.sync, ['refused', 'conflict', 'complete'], 30_000).catch(() => undefined);
  const written = targets.filter((t, i) => digest(t) !== before[i]);
  expect(written, `with ${codexToml(w)} unparseable, the sync writes none of the three files, by digest; it wrote ${written.join(', ')}`).toEqual([]);
  expect(s?.status, `the sync is refused, not complete: ${shown(s)}`).toBe('refused');
  expect(names(JSON.stringify(s), codexToml(w), w), `the refusal names ${codexToml(w)}: ${shown(s)}`).toBe(true);
}

/** AC12: your edit to Codex's config.toml lands after the plan and before its replace. */
async function editBetween(plant?: string): Promise<void> {
  const w = await makeWorld();
  await startHub(w, { plant });
  const name = `forge-${tag()}`;
  const p = await propose(w, { via: 'app', server: stdioServer(w, name), agents: ['codex'] });
  const marker = harmlessEdit(codexToml(w));
  await answer(w, p.ask, 'apply');
  await syncReaches(w, p.sync, ['complete', 'conflict', 'refused'], 30_000).catch(() => undefined);
  expect(readFileSync(codexToml(w), 'utf8').includes(marker), `${codexToml(w)} keeps your edit made between the plan and its replace (# ${marker})`).toBe(true);
  const codex = await codexList(w);
  expect(codex.names, `${codexToml(w)} also holds DeepBuild's entry for ${name}, as codex mcp list --json reads it: ${ranText(codex.ran)}`).toContain(name);
}

/** AC13: two syncs to Codex, then `deep setup --undo` (removing DeepBuild from every agent, Codex among them). */
async function removedFromCodex(plant?: string): Promise<void> {
  const w = await makeWorld();
  await startHub(w, { plant });
  const original = readFileSync(codexToml(w));
  for (const name of [`forge-${tag()}`, `tracker-${tag()}`]) await approve(w, await propose(w, { via: 'app', server: stdioServer(w, name), agents: ['codex'] }));
  expect(sha256(readFileSync(codexToml(w))), 'the two syncs changed config.toml').not.toBe(sha256(original));
  const kept = [...snapshot(w.root).entries()].filter(([rel, hash]) => rel.includes(sha256(original)) && hash === sha256(original));
  expect(kept.length, `the original bytes of ${codexToml(w)} are kept under ~/.deepbuild by their hash, ${sha256(original)}`).toBeGreaterThan(0);
  const r = await deep(w, ['setup', '--undo'], { env: { DEEP_HUB_PLANT: plant } });
  expect(r.code, `deep setup --undo removes DeepBuild: ${ranText(r)}`).toBe(0);
  w.hub = undefined;
  expect(readFileSync(codexToml(w)).equals(original), `removing DeepBuild from Codex restores ${codexToml(w)} to its original bytes`).toBe(true);
}

/** AC14: the sync's file calls through the storage seam, the test VFS's points file. */
async function flushedAfterEachReplace(plant?: string): Promise<void> {
  const w = await makeWorld();
  const points = join(w.tmp, 'points.jsonl');
  writeFileSync(points, '');
  await startHub(w, { plant, vfs: { points } });
  const p = await propose(w, { via: 'app', server: stdioServer(w, `forge-${tag()}`), agents: THREE });
  await approve(w, p);
  const trace = readFileSync(points, 'utf8').split('\n').flatMap((l) => (parse(l) ? [parse(l)!] : [])).filter((t) => String(t.kind).startsWith('sync_'));
  const replaces = trace.map((t, i) => [t, i] as [Line, number]).filter(([t]) => t.kind === 'sync_replace');
  const unreplaced = p.files.filter((f) => !replaces.some(([t]) => same(String(t.path), f.path))).map((f) => f.path);
  expect(unreplaced, `the trace shows a replace of each planned file: ${shown(trace)}`).toEqual([]);
  const unflushed: string[] = [];
  for (const [t, i] of replaces) {
    const end = trace.findIndex((u, j) => j > i && u.kind === 'sync_complete');
    const folder = dirname(String(t.path));
    if (!trace.slice(i + 1, end < 0 ? undefined : end).some((u) => u.kind === 'sync_flush' && same(String(u.path), folder))) unflushed.push(folder);
  }
  expect(unflushed, `each replace is followed by a flush of its folder; no flush follows the rename in ${unflushed.join(', ')}`).toEqual([]);
}

describe('#148 planning, replacing and putting back', () => {
  it(`${AC[11]} with three target files where the second won't parse, a sync writes none of them, by digests, and names the file`, () => secondWontParse());
  it(`${AC[11]} twin: a sync that writes the first file before parsing the second fails the check, naming it`, async () => {
    failsNaming(await failureOf(() => secondWontParse('writes-before-parsing')), '.claude.json', 'DEEP_HUB_PLANT=writes-before-parsing');
  });

  it(`${AC[12]} an edit made to a target file between the plan and its replace is kept, beside DeepBuild's entry`, () => editBetween());
  it(`${AC[12]} twin: a sync that replaces from its first plan loses the edit and fails the check, naming the file`, async () => {
    failsNaming(await failureOf(() => editBetween('replaces-from-first-plan')), '.codex/config.toml', 'DEEP_HUB_PLANT=replaces-from-first-plan');
  });

  it(`${AC[13]} Codex's config.toml is kept once by hash before DeepBuild's first write, and after two syncs removing DeepBuild restores those bytes`, () => removedFromCodex());
  it(`${AC[13]} twin: a host that takes the copy again before each write restores the first sync's output and fails the check, naming the path`, async () => {
    failsNaming(await failureOf(() => removedFromCodex('copies-original-each-write')), '.codex/config.toml', 'DEEP_HUB_PLANT=copies-original-each-write');
  });

  it(`${AC[14]} each replace is followed by a flush of its folder, by the trace through the storage seam`, () => flushedAfterEachReplace());
  it(`${AC[14]} twin: a sync with no folder flush after its rename fails the check, naming the folder`, async () => {
    const failure = await failureOf(() => flushedAfterEachReplace('no-folder-flush'));
    failsNaming(failure, 'no flush follows the rename in /', 'DEEP_HUB_PLANT=no-folder-flush');
  });
});
