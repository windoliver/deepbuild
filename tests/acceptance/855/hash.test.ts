// #855.6df0cf9c, first two parts: every content key and result digest computed with hash@2 keys equal
// documents equally on two machines, and a cache written under hash@1 still hits after the migration's
// single rekey. (The third part, keying time, is keying.test.ts.)
//
// hash@2 is the default; the scenario field `hash: "hash@1"` keys a process as the base did, and `eval`
// says which hash its keys and digests were computed with (README: Hash versions). The two machines are
// stood in for by two processes that differ in everything a machine hands a process: the build (the
// debug binary, then the release binary), the environment (time zone, locale, HOME, TMPDIR, thread
// count), the scenario's `machine` (#379), and the document's spelling (members and items in another
// order); and, where this Mac can run it, an x86_64 build under Rosetta, a machine of another
// architecture. The cache is the process's content-key cache, written by sessions keyed with hash@1, then
// rekeyed by the `migrate` call. The wrong programs: the base (no hash@2, no `hash`, no `migrate`); keys
// that read the machine, the environment or the spelling; a migration that drops the cache, rekeys it
// wrongly, or rekeys it again.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOC, FIXTURES, HASH1, HASH2, MIGRATE, X86, board, byId, circle, evalCall, evaluated, fixturesOf, frame, isFramePhase, nodeDifferences, nodeId,
  num, path, presented, rect, respelled, run, scenario, show, slide, text, useBuilds, useTemp, type Build, type Evaluated, type Fixture, type JsonObject,
  type StartOptions,
} from './helpers.ts';

const ID = '#855.6df0cf9c';
const FULL: Build = { set: 'full' };
const RELEASE: Build = { set: 'full', release: true };
const FULL_X86: Build = { set: 'full', target: X86 };
const builds = useBuilds([FULL, RELEASE, FULL_X86]);
const temp = useTemp();
const T = '0.5s';

/** A small board of every kind, one rect sliding on a clip. */
const SMALL = board('Small mixed', [rect('r0', 0), circle('c1', 1), path('p2', 2), text('t3', 3, 'Hello'), frame('f4', 4), rect('r5', 5)], slide('r5', 'rect@1', 0, 300));
/** The other machine's environment: another time zone, locale, home, temp folder and thread count. */
function otherEnvironment(dir: string): NodeJS.ProcessEnv {
  return { ...process.env, TZ: 'Pacific/Chatham', LANG: 'de_DE.UTF-8', LC_ALL: 'de_DE.UTF-8', HOME: dir, TMPDIR: `${dir}/`, RAYON_NUM_THREADS: '1' };
}
const OTHER_MACHINE: JsonObject = { model: 'Mac14,6', chip: 'Apple M2 Max', memoryBytes: 64 * 2 ** 30 };

interface Doc { title: string; document: JsonObject; record?: JsonObject }

/** Each document shown to DOC.a in its own process and evaluated clean at T. */
function evaluate(bin: string, docs: Doc[], options: StartOptions & { machine?: JsonObject; hash?: string } = {}): Evaluated[] {
  return docs.map((d) => {
    const replies = run(bin, scenario(temp(), [show(d.document), evalCall(DOC.a, { t: T, clean: true })], { record: d.record, machine: options.machine, hash: options.hash }), [], options);
    presented(replies[0]!, d.title);
    return evaluated(replies[1]!, `${d.title} at ${T}`);
  });
}

function shippedDocs(): Doc[] {
  const [fx] = run(builds.bin(FULL), scenario(temp(), [FIXTURES]));
  const fixtures: Fixture[] = fixturesOf(fx!);
  return [{ title: 'the small mixed board', document: SMALL }, ...fixtures.map((f) => ({ title: `${f.module}/${f.name}`, document: f.document, ...(f.record ? { record: f.record } : {}) }))];
}
const spelledOtherwise = (docs: Doc[]): Doc[] => docs.map((d) => ({ ...d, title: `${d.title}, spelled otherwise`, document: respelled(d.document) as JsonObject }));

describe(`${ID} content keys and result digests with hash@2 key equal documents equally on two machines, and a cache written under hash@1 still hits after the migration's single rekey`, () => {
  it(`${ID} keys and result digests are computed with hash@2 by default, and every one differs from the same document's under hash@1`, () => {
    const [two] = evaluate(builds.bin(FULL), [{ title: 'the small board', document: SMALL }]);
    const [one] = evaluate(builds.bin(FULL), [{ title: 'the small board under hash@1', document: SMALL }], { hash: HASH1 });
    expect(two!.hash, 'the default hash is hash@2').toBe(HASH2);
    expect(one!.hash, 'the scenario\'s hash field keys the process with hash@1').toBe(HASH1);
    const before = byId(one!);
    const same = two!.nodes.filter((n) => { const m = before.get(nodeId(n)); return !m || m.key === n.key || m.result === n.result; }).map(nodeId);
    expect(same, 'every node has another key and another result digest under hash@2 than under hash@1, so hash@2 is another hash and not a relabelled one').toEqual([]);
    expect(two!.nodes.length, 'the same nodes under both').toBe(one!.nodes.length);
  }, 1_800_000);

  it(`${ID} equal documents get equal keys and result digests on two machines: the debug build here, and the release build in another time zone, locale, home and thread count, on the documents spelled otherwise`, () => {
    const docs = shippedDocs();
    const dir = mkdtempSync(join(tmpdir(), 'deep-855-machine-'));
    try {
      const a = evaluate(builds.bin(FULL), docs);
      const aSpelled = evaluate(builds.bin(FULL), spelledOtherwise(docs));
      const b = evaluate(builds.bin(RELEASE), spelledOtherwise(docs), { env: otherEnvironment(dir), machine: OTHER_MACHINE });
      const bPlain = evaluate(builds.bin(RELEASE), docs, { env: otherEnvironment(dir), machine: OTHER_MACHINE });
      const failures: string[] = [];
      docs.forEach((d, i) => {
        for (const e of [a[i]!, aSpelled[i]!, b[i]!, bPlain[i]!]) expect(e.hash, `${d.title}: keyed with hash@2`).toBe(HASH2);
        failures.push(...nodeDifferences(a[i]!, aSpelled[i]!, `${d.title}, this machine, spelled two ways`).failures);
        failures.push(...nodeDifferences(a[i]!, b[i]!, `${d.title}, this machine and the other, spelled two ways`).failures);
        failures.push(...nodeDifferences(a[i]!, bPlain[i]!, `${d.title}, this machine and the other`).failures);
      });
      expect(failures, 'equal documents get byte-identical keys and result digests on both machines').toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 3_600_000);

  it(`${ID} equal documents get equal keys and result digests on a machine of another architecture: the x86_64 build under Rosetta (INCONCLUSIVE where this Mac can't build or run it)`, (ctx) => {
    const docs = shippedDocs();
    const here = evaluate(builds.bin(FULL), docs);
    for (const e of here) expect(e.hash, 'keyed with hash@2').toBe(HASH2);
    const why = builds.unavailable(FULL_X86);
    if (why) ctx.skip(`INCONCLUSIVE: no machine of another architecture here: ${why}`);
    const there = evaluate(builds.bin(FULL_X86), spelledOtherwise(docs), { x86: true });
    const failures = docs.flatMap((d, i) => nodeDifferences(here[i]!, there[i]!, `${d.title}, arm64 here and x86_64 there`).failures);
    expect(failures, 'equal documents get byte-identical keys and result digests on both architectures').toEqual([]);
  }, 7_200_000);

  it(`${ID} a cache written under hash@1 still hits after the migration's single rekey: a third session of the same content finds every result the hash@1 sessions wrote, and a second migration rekeys nothing`, () => {
    const replies = run(builds.bin(FULL), scenario(temp(), [
      show(SMALL, DOC.a), show(SMALL, DOC.b), evalCall(DOC.a, { t: T }), evalCall(DOC.b, { t: T }),
      MIGRATE, MIGRATE,
      evalCall(DOC.a, { t: T }), show(SMALL, DOC.c), evalCall(DOC.c, { t: T }),
    ], { hash: HASH1 }));
    for (const i of [0, 1, 7]) presented(replies[i]!, `the board in deep_show call ${i}`);
    const aBefore = evaluated(replies[2]!, 'the first session, under hash@1');
    expect(aBefore.hash, 'the sessions wrote the cache under hash@1').toBe(HASH1);
    expect(evaluated(replies[3]!, 'the second session, under hash@1').hash).toBe(HASH1);

    const first = replies[4]!;
    const second = replies[5]!;
    expect([first['from'], first['to']], `the first migration goes from hash@1 to hash@2: ${JSON.stringify(first)}`).toEqual([HASH1, HASH2]);
    const entries = num(first['entries'], 'the first migration\'s entries');
    expect(entries, 'the hash@1 sessions left results in the cache').toBeGreaterThan(0);
    expect(num(first['rekeyed'], 'the first migration\'s rekeyed'), 'the first migration rekeys every entry, once').toBe(entries);
    expect([second['from'], second['to']], `the second migration finds the cache already under hash@2: ${JSON.stringify(second)}`).toEqual([HASH2, HASH2]);
    expect(num(second['rekeyed'], 'the second migration\'s rekeyed'), 'the rekey is single: a second migration rekeys nothing').toBe(0);
    expect(num(second['entries'], 'the second migration\'s entries'), 'and drops nothing').toBe(entries);

    const aAfter = evaluated(replies[6]!, 'the first session after the migration');
    expect(aAfter.hash, 'after the migration the process keys with hash@2').toBe(HASH2);
    const before = byId(aBefore);
    expect(aAfter.nodes.filter((n) => before.get(nodeId(n))?.key === n.key).map(nodeId), 'every key was rekeyed').toEqual([]);
    expect(aAfter.nodes.filter((n) => n.run === 'ran').map(nodeId), 'the migrated session reruns nothing: its results were rekeyed, not dropped').toEqual([]);

    const c = evaluated(replies[8]!, 'a third session of the same content after the migration');
    const keyed = byId(aAfter);
    const shared = c.nodes.filter((n) => keyed.get(nodeId(n))?.key === n.key);
    expect(shared.length, 'the third session shares the keys of every item-level node with the first').toBeGreaterThanOrEqual(Object.keys(SMALL['items'] as JsonObject).length);
    expect(shared.filter((n) => n.run !== 'hit').map((n) => `${nodeId(n)} ${n.run}`), 'every node whose key the hash@1 sessions wrote is a cache hit').toEqual([]);
    expect(shared.some((n) => isFramePhase(n.phase)), 'frame-phase results are among the hits').toBe(true);

    const [fresh] = evaluate(builds.bin(FULL), [{ title: 'the board in a fresh hash@2 process', document: SMALL }]);
    const freshKeys = byId(fresh!);
    expect(aAfter.nodes.filter((n) => freshKeys.get(nodeId(n))?.key !== n.key).map(nodeId), 'the migration\'s keys are hash@2\'s own: a fresh hash@2 process keys the board the same').toEqual([]);
  }, 1_800_000);
});
