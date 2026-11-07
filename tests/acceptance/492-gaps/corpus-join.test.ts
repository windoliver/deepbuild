// Criterion 13, the corpus half: "... and the fixture joins the migration corpus"
//
// Migration: "migrated at load, each corpus document gives the evaluated values and the snapshots the release that
// saved it recorded at its sampled times ... A difference fails the release, naming the kind, the item, the field and
// the first time that differs". The file is what `corpus_record` writes, in the committed folder. The default kit, the
// `kit` call of `scripts/canvas-kit.mjs`, names no corpus, so it reads that folder itself. The twin of the join is a
// changed copy: one recorded number moved in a temporary folder, read through the kit's `corpus` field. The committed
// file is never written.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORPUS_FILE, CORPUS_NAME, TIMEOUT, arr, isObject, kit, num, obj, show, useBin, type JsonObject, type JsonValue } from './helpers.ts';

const showBin = useBin('deep-show');

const X = /(^|\/)(at\/pos\/0|x)$/;
const Y = /(^|\/)(at\/pos\/1|y)$/;
const VISIBLE = /(^|\/)visible$/;

function corpusFile(): JsonObject {
  expect(existsSync(CORPUS_FILE), `the corpus file exists: ${CORPUS_FILE}`).toBe(true);
  return obj(JSON.parse(readFileSync(CORPUS_FILE, 'utf8')) as JsonValue, 'the corpus file');
}
/** The channels a placement's clip keys. */
function channelsOf(doc: JsonObject, p: JsonObject): JsonObject[] {
  const clip = obj(obj(doc['clips'], 'document clips')[String(p['clip'])], `clip ${show(p['clip'])}`);
  return Object.values(obj(clip['channels'], 'clip channels')).map((c) => obj(c, 'a channel'));
}
const keys = (cs: JsonObject[], path: RegExp): boolean => cs.some((c) => path.test(String(c['target'])));
/** Moves the first number under a recorded value, in place; false when it holds none. */
function moveOne(v: JsonValue): boolean {
  if (Array.isArray(v)) {
    for (const [i, e] of v.entries()) {
      if (typeof e === 'number') { v[i] = e + 1; return true; }
      if (moveOne(e)) return true;
    }
  } else if (isObject(v)) {
    for (const [k, e] of Object.entries(v)) {
      if (typeof e === 'number') { v[k] = e + 1; return true; }
      if (moveOne(e)) return true;
    }
  }
  return false;
}

describe('criterion 13, the corpus half: replace-keeps-unkeyed joins the migration corpus', () => {
  it('criterion 13: the corpus file holds the fixture and its recorded values, and the default kit\'s migration part names it and passes', () => {
    const file = corpusFile();
    expect(file['name'], 'the file names its document').toBe(CORPUS_NAME);
    const doc = obj(file['document'], 'the document');
    const placements = Object.values(obj(doc['placements'], 'the document\'s placements')).map((p) => obj(p, 'a placement'));
    const a = placements.find((p) => { const cs = channelsOf(doc, p); return keys(cs, X) && keys(cs, VISIBLE); });
    expect(a, `a placement's clip keys x and visible: ${show(doc['placements'])}`).toBeDefined();
    expect(obj(a!['extend'], 'A\'s extend')['after'], 'A ends with extend after hold').toBe('hold');
    const visible = channelsOf(doc, a!).find((c) => VISIBLE.test(String(c['target'])))!;
    expect(visible['type'], 'visible is a bool channel').toBe('bool');
    const b = placements.find((p) => p !== a && channelsOf(doc, p).every((c) => Y.test(String(c['target']))));
    expect(b, `a second placement keys only y: ${show(doc['placements'])}`).toBeDefined();
    expect(b!['blend'] ?? 'replace', 'B is a replace placement').toBe('replace');

    const times = arr(file['times'], 'the sampled times').map((t) => num(t, 'a sampled time'));
    const values = obj(file['values'], 'the recorded values');
    const snapshots = obj(file['snapshots'], 'the recorded snapshots');
    expect(new Set(times).size, 'at least two sampled times').toBeGreaterThan(1);
    for (const t of times) {
      expect(Object.keys(obj(values[String(t)], `the values at ${t}`)).length, `recorded values at ${t}`).toBeGreaterThan(0);
      expect(typeof snapshots[String(t)], `a recorded snapshot at ${t}`).toBe('string');
    }
    expect(new Set(times.map((t) => snapshots[String(t)])).size, 'the snapshots record the placements moving').toBeGreaterThan(1);

    const k = kit(showBin.bin());
    expect(k.cases.length, `the default kit's migration part names ${CORPUS_NAME}: ${show(k.raw['modules'])}`).toBeGreaterThan(0);
    for (const c of k.cases) {
      expect(c.verdict, `${c.module}: the document gives what was recorded: ${show(c.raw)}`).toBe('PASS');
      expect(c.part['verdict'], `${c.module}: the migration part passes`).toBe('PASS');
      const compared = obj(c.raw['compared'], 'what the case compared');
      expect(compared['times'], 'it compared at every sampled time').toEqual(times);
      expect(num(compared['snapshots'], 'compared snapshots'), 'a snapshot at each time').toBe(times.length);
      expect(num(compared['values'], 'compared values'), 'recorded values were compared').toBeGreaterThan(0);
    }
  }, TIMEOUT);

  it('criterion 13: a copy of the corpus file with one recorded value changed fails the kit, naming the document, the item and the time', () => {
    const file = corpusFile();
    const times = arr(file['times'], 'the sampled times');
    const t = num(times[times.length - 1], 'the last sampled time');
    const atT = obj(obj(file['values'], 'the recorded values')[String(t)], `the values at ${t}`);
    const item = Object.keys(atT).find((id) => moveOne(atT[id]!));
    expect(item, `a recorded number at ${t}: ${show(atT)}`).toBeDefined();
    const dir = mkdtempSync(join(tmpdir(), 'deep-492-gaps-corpus-'));
    try {
      writeFileSync(join(dir, `${CORPUS_NAME}.json`), JSON.stringify(file, null, 2));
      const k = kit(showBin.bin(), dir);
      expect(k.cases.length, `the kit names ${CORPUS_NAME}: ${show(k.raw['modules'])}`).toBeGreaterThan(0);
      expect(k.verdict, 'the kit fails').toBe('FAIL');
      const failed = k.cases.find((c) => c.verdict === 'FAIL');
      expect(failed, `the case named ${CORPUS_NAME} fails: ${show(k.cases.map((c) => c.raw))}`).toBeDefined();
      const failure = obj(failed!.raw['failure'], 'the case\'s failure');
      expect(failure['item'], `it names the item: ${show(failure)}`).toBe(item);
      expect(failure['t'], `it names the first time that differs: ${show(failure)}`).toBe(t);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, TIMEOUT);
});
