import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import type { EvidenceStore, Writer } from '../../../packages/evidence/src/index.ts';
import { anyUse, base64Form, cut, mulberry32, removeRoots, storeText, stored, T0, tempRoot, urlEncode, utf8, word } from './helpers.ts';

// Generator: printable values of 16 to 4,096 bytes, each written raw, URL-encoded with upper- or
// lower-case hex, or as base64 after 0, 1 or 2 leading bytes in the standard or URL-safe alphabet, inside
// filler text with multi-byte characters, cut into chunks at random byte offsets including one inside
// the encoded value. Criterion: AC16. Seed recorded; a failure shrinks and replays from it.
const SEED = 0x15_16;
const RUNS = 1000;

const VALUE_CHARS = Array.from({ length: 94 }, (_, k) => String.fromCharCode(33 + k)).join(''); // '!'..'~'
// Filler words that no secret pattern matches: no keyword, no long high-entropy run.
const WORDS = ['build', 'step', 'done', 'ok', 'compiling', 'linking', 'cache', 'hit', 'miss', 'ran', 'in', '12', 'ms', '✓', 'café', '→', 'warn:', 'module', 'tests', 'passed', '—', '日本'];
const FORMS = ['raw', 'url-upper', 'url-lower', 'b64-standard-0', 'b64-standard-1', 'b64-standard-2', 'b64-url-safe-0', 'b64-url-safe-1', 'b64-url-safe-2'] as const;
type FormName = (typeof FORMS)[number];

function filler(seed: number, count: number): string {
  const rng = mulberry32(seed);
  let s = '';
  for (let i = 0; i < count; i++) s += WORDS[Math.floor(rng() * WORDS.length)] + (rng() < 0.15 ? '\n' : ' ');
  return s;
}

/** The value as printed in the given form, and the part that must not survive. */
function encode(value: string, form: FormName, seed: number): { printed: string; core: string } {
  if (form === 'raw') return { printed: value, core: value };
  if (form === 'url-upper' || form === 'url-lower') { const e = urlEncode(value, form === 'url-upper'); return { printed: e, core: e }; }
  const [, alphabet, k] = /^b64-(standard|url-safe)-(\d)$/.exec(form)!;
  const rng = mulberry32(seed);
  const lead = utf8(word(rng, Number(k)));
  const tail = utf8(word(rng, Math.floor(rng() * 3)));
  const whole = base64Form(new Uint8Array([...utf8(value), ...tail]), lead, alphabet as 'standard' | 'url-safe');
  return { printed: whole.printed, core: base64Form(utf8(value), lead, alphabet as 'standard' | 'url-safe').core };
}

let store: EvidenceStore;
let writer: Writer;
beforeAll(async () => {
  store = await openEvidenceStore({ root: tempRoot(), now: () => T0 });
  writer = store.connect({ role: 'deepbuild', via: 'job' });
});
afterAll(removeRoots);

async function storeChunks(bytes: Uint8Array, offsets: number[], held: string[]): Promise<Buffer> {
  const hash = stored(await storeText(writer, { kind: 'log', source: 'run:prop', redaction: 'complete', license: anyUse, run: { held } }, cut(bytes, offsets)));
  return Buffer.from(await store.read(hash));
}

describe('AC16 the scrub holds to its forms', () => {
  it(`AC16 seeded property, ${RUNS} cases: a scrub-list value never appears in what is stored, and text without it is stored byte for byte`, async () => {
    const scenario = fc.record({
      length: fc.integer({ min: 16, max: 4096 }),
      valueSeed: fc.integer(),
      form: fc.constantFrom(...FORMS),
      before: fc.integer({ min: 0, max: 300 }),
      after: fc.integer({ min: 0, max: 300 }),
      fillSeed: fc.integer(),
      inside: fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }),
      cuts: fc.array(fc.integer({ min: 1, max: 1 << 20 }), { maxLength: 8 }),
    });
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const value = word(mulberry32(s.valueSeed), s.length, VALUE_CHARS);
        const { printed, core } = encode(value, s.form, s.valueSeed ^ 0x5a5a);
        const head = utf8(filler(s.fillSeed, s.before));
        const body = utf8(printed);
        const tail = utf8(filler(s.fillSeed + 1, s.after));
        const withValue = new Uint8Array([...head, ...utf8(' '), ...body, ...utf8(' '), ...tail]);
        const at = head.length + 1;
        const offsets = [at + Math.floor(s.inside * body.length), ...s.cuts.map((c) => c % (withValue.length + 1))];

        const kept = await storeChunks(withValue, offsets, [value]);
        expect(kept.includes(Buffer.from(core)), `the ${s.form} form of a ${s.length}-byte value survived`).toBe(false);
        expect(kept.includes(Buffer.from(value)), `a ${s.length}-byte value survived raw`).toBe(false);

        const without = new Uint8Array([...head, ...utf8(' '), ...utf8(' '), ...tail]);
        const plain = await storeChunks(without, offsets.map((o) => o % (without.length + 1)), [value]);
        expect(plain.equals(Buffer.from(without)), 'text without the value was not stored byte for byte').toBe(true);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  }, 120_000);

  it('AC16 a 2 KB value split in its middle is scrubbed in every form, which a fixed 64-byte carry window misses', async () => {
    const value = word(mulberry32(0x15_2048), 2048, VALUE_CHARS);
    const missed: string[] = [];
    for (const form of FORMS) {
      const { printed, core } = encode(value, form, 7);
      const line = utf8(`step 3 output ${printed} done\n`);
      const middle = 'step 3 output '.length + Math.floor(printed.length / 2);
      const kept = await storeChunks(line, [middle], [value]);
      if (kept.includes(Buffer.from(core)) || kept.includes(Buffer.from(value))) missed.push(form);
    }
    expect(missed, `survived a split in the middle: ${missed.join(', ')}`).toEqual([]);
  });
});
