// AC5: "An item that names a result before `audio.gen` passes is refused at check, naming the asset"
//
// A film stored at revision 0 (#96's shared document, as #499's redraft of AC10 stores one) declares three results in
// its `sounds` map: a 4-bar bed with no beats record yet (audio.gen BLOCKED), the coin pickup's clean takes (PASS) and
// the coin pickup with a take at +0.4 dBTP (FAIL). The agent's patches each create one `media.strip@1` item, on
// revision 0: one names the bed, one the hot take, one a clean take. The first two must be refused with
// `audio.gen.unpassed` naming the asset they name, leaving revision 0 current; the third applies as revision 1.
// The planted check `unpassed_on_fail_only` refuses only a result whose audio.gen FAILs, so the BLOCKED bed's strip
// gets through, and the same judgment must fail on it, naming the bed's asset.
import { describe, expect, it } from 'vitest';
import { LEVELS, bed, overPeak, takes, wavF32 } from './fixtures/synth.ts';
import { AC, BUSES, TIMEOUT, music, proof, putAsset, runShow, show, sound, useEvidence, useShow, type JsonObject, type JsonValue, type Planted } from './helpers.ts';

const deepShow = useShow();
const evidenceDir = useEvidence();

const THREAD = 'thread-alpha';
const SESSION = 'sess-alpha';
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
const DOC = ulid('01JB935D', 1);

interface Assets { bed: string; hot: string; coin: string; all: string[] }

/** The film as stored, revision 0: no items yet, the three results in `sounds`, every asset licensed in `assets`. */
function film(a: Assets, end: number, takeHashes: string[][], hotHashes: string[][]): JsonObject {
  return {
    format: 1, profile: 'film', title: 'Hub level sounds',
    description: 'A hub level\'s music bed and coin pickup, each held by audio.gen before a strip may name it.',
    requires: { modules: { media: '^1' } },
    size: [640, 360], transport: { frame_rate: [30, 1], span: '10s' },
    assets: Object.fromEntries(a.all.map((sha, k) => [`sound${k}.wav`, { sha256: sha, license: 'CC0-1.0' }])),
    layers: { main: { writer: `agent:${THREAD}`, title: 'Claude Code: hub level sounds', order: 'a0' } },
    items: {},
    buses: BUSES,
    sounds: {
      bed: music(a.bed, end) as unknown as JsonValue,
      coin: sound(LEVELS, takeHashes) as unknown as JsonValue,
      hot_coin: sound(LEVELS, hotHashes) as unknown as JsonValue,
    },
  };
}

const strip = (n: number, id: string, asset: string, reason: string): JsonObject => ({
  call: 'deep_show', session: SESSION, doc: DOC,
  patch: {
    patch: ulid('01JB935P', n), doc: DOC, base: 0, reason,
    ops: [{ op: 'create', item: { id, kind: 'media.strip@1', name: reason, order: `a${n}`, params: { track: n, src: { asset }, start: '0s', bus: 'music' } } }],
  },
});

/** The scenario: read, the three patches on revision 0, then revisions. */
function scenario(evidence: string, doc: JsonObject, a: Assets, planted?: Planted): JsonObject {
  return {
    evidence,
    sessions: { [SESSION]: { thread: THREAD, name: 'Claude Code: hub level sounds', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1_000 }],
    panels: { main: { rect: [0, 0, 640, 360] } },
    docs: { [DOC]: { panel: 'main', document: doc } },
    ...(planted ? { planted } : {}),
    calls: [
      { call: 'read', doc: DOC },
      strip(1, 'strip.bed', a.bed, 'play the hub loop'),
      strip(2, 'strip.hot', a.hot, 'play the loud coin take'),
      strip(3, 'strip.coin', a.coin, 'play the soft coin take'),
      { call: 'revisions', doc: DOC },
    ],
  };
}

const issuesOf = (r: JsonObject): JsonObject[] => (Array.isArray(r['issues']) ? r['issues'] : []).filter((i): i is JsonObject => typeof i === 'object' && i !== null && !Array.isArray(i));
const unpassed = (r: JsonObject): JsonObject[] => issuesOf(r).filter((i) => i['code'] === 'audio.gen.unpassed');

/** A refused strip's failures: refused, revision `rev` staying current, with audio.gen.unpassed naming its asset. */
function refused(what: string, r: JsonObject, asset: string, rev: JsonValue | undefined): string[] {
  const f: string[] = [];
  if (r['outcome'] !== 'refused') f.push(`${what}: \`outcome\` is ${show(r['outcome'])}; the check must refuse it with audio.gen.unpassed naming ${asset} (reply ${show(r, 900)})`);
  if (r['rev'] !== rev) f.push(`${what}: \`rev\` is ${show(r['rev'])}; revision ${show(rev)}, the one before it, must stay current`);
  const found = unpassed(r);
  if (!found.some((i) => JSON.stringify(i).includes(asset))) f.push(`${what}: no audio.gen.unpassed issue naming the asset ${asset} among ${show(r['issues'], 900)}`);
  return f;
}

/** The judgment of the five replies; empty is a pass. `bed` and `hot` are kept apart so a planted run is read by leg. */
function judge(replies: JsonObject[], a: Assets): { bed: string[]; hot: string[]; rest: string[] } {
  const [read0, bedPatch, hotPatch, coinPatch, revs] = replies as [JsonObject, JsonObject, JsonObject, JsonObject, JsonObject];
  const rest: string[] = [];
  if (read0['rev'] !== 0) rest.push(`the first \`read\`: \`rev\` is ${show(read0['rev'])}, not 0`);
  if (coinPatch['outcome'] !== 'applied' || coinPatch['rev'] !== 1) rest.push(`the strip naming the clean take ${a.coin}, whose audio.gen passes: \`outcome\` ${show(coinPatch['outcome'])} \`rev\` ${show(coinPatch['rev'])}; it must apply as revision 1 (reply ${show(coinPatch, 900)})`);
  if (unpassed(coinPatch).length > 0) rest.push(`the strip naming the clean take still reports audio.gen.unpassed: ${show(unpassed(coinPatch))}`);
  const current = (Array.isArray(revs['revisions']) ? revs['revisions'] : []).filter((r) => typeof r === 'object' && r !== null && !Array.isArray(r) && r['state'] === 'current').map((r) => (r as JsonObject)['rev'] ?? null);
  if (JSON.stringify(current) !== '[1]') rest.push(`after the three patches \`revisions\` has ${show(current)} current; revision 1, the clean take's strip, must be (reply ${show(revs, 600)})`);
  // The hot take's strip is judged on the revision current before it: 0, or 1 when the bed's strip wrongly applied.
  const before = bedPatch['outcome'] === 'applied' ? bedPatch['rev'] : 0;
  return {
    bed: refused(`the strip naming the bed ${a.bed}, whose audio.gen is BLOCKED (no beats record)`, bedPatch, a.bed, 0),
    hot: refused(`the strip naming the take at +0.4 dBTP ${a.hot}, whose audio.gen FAILs`, hotPatch, a.hot, before),
    rest,
  };
}

describe('AC5 an item can\'t name a result before its audio.gen passes', () => {
  it(`${AC[5]} strips naming a BLOCKED bed and a FAILed take are refused with audio.gen.unpassed naming each asset, revision 0 stays current, a strip naming a passed take applies; the planted unpassed_on_fail_only lets the BLOCKED bed through and fails, naming its asset`, () => {
    const loop = bed(100, 4);
    const clean = takes();
    const evidence = evidenceDir();
    const bedAsset = putAsset(evidence, wavF32(loop.mix));
    const takeHashes = clean.map((level) => level.map((x) => putAsset(evidence, wavF32(x))));
    const hotAsset = putAsset(evidence, wavF32(overPeak(clean, 2, 1)));
    const hotHashes = takeHashes.map((level, i) => level.map((h, j) => (i === 2 && j === 1 ? hotAsset : h)));
    const a: Assets = { bed: bedAsset, hot: hotAsset, coin: takeHashes[0]![0]!, all: [bedAsset, ...takeHashes.flat(), hotAsset] };
    const doc = film(a, loop.length, takeHashes, hotHashes);

    const replies = runShow(deepShow(), scenario(evidence, doc, a), 'the film\'s three strips');
    const j = judge(replies, a);
    proof('ac5-real.json', { assets: a, replies, failures: j });
    expect([...j.bed, ...j.hot, ...j.rest], 'the strips naming unpassed results are refused, naming their assets, and the one naming a passed take applies').toEqual([]);

    const plant: Planted = 'unpassed_on_fail_only';
    const p = judge(runShow(deepShow(), scenario(evidence, doc, a, plant), `the film's three strips (planted ${plant})`), a);
    proof('ac5-planted.json', { plant, failures: p });
    expect(p.hot, `planted ${plant} still refuses the strip naming the FAILed take, as a check that refuses on FAIL does`).toEqual([]);
    expect(p.bed.length > 0 && p.bed.every((f) => f.includes(a.bed)), `planted ${plant} lets the strip naming the BLOCKED bed through, and the judgment fails, naming its asset ${a.bed}: ${show(p.bed)}`).toBe(true);
  }, TIMEOUT);
});
