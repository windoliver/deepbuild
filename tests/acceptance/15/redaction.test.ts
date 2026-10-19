import { afterEach, describe, expect, it } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import type { TextRequest } from '../../../packages/evidence/src/index.ts';
import {
  anyUse, base64Form, everyForm, filesContaining, mulberry32, removeRoots, sha256, storeText, stored, T0,
  tempRoot, text, urlEncode, utf8, word,
} from './helpers.ts';

afterEach(removeRoots);

const log = (run?: TextRequest['run']): TextRequest => ({ kind: 'log', source: 'run:7', redaction: 'complete', license: anyUse, ...(run && { run }) });
const runner = { role: 'deepbuild', via: 'job' } as const;

async function open() {
  const root = tempRoot();
  const store = await openEvidenceStore({ root, now: () => T0 });
  return { root, store, writer: store.connect(runner) };
}

describe('AC2 a planted fake API key in a log is redacted before storage', () => {
  it('AC2 pattern-shaped keys never reach the stored bytes, the hash or any file under the root', async () => {
    const { root, store, writer } = await open();
    const rng = mulberry32(0x15_02);
    // Fake keys in well-known shapes, generated at run time; no scrub list names them.
    const keys = [
      `ghp_${word(rng, 36)}`,
      `AKIA${word(rng, 16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')}`,
      `xoxb-${word(rng, 12, '0123456789')}-${word(rng, 12, '0123456789')}-${word(rng, 24)}`,
    ];
    const output = [
      '2026-10-18 12:00:01 deploy: starting\n',
      `2026-10-18 12:00:02 deploy: export GITHUB_TOKEN=${keys[0]}\n`,
      `2026-10-18 12:00:03 deploy: aws configure set aws_access_key_id ${keys[1]}\n`,
      `2026-10-18 12:00:04 deploy: slack token ${keys[2]} loaded\n`,
      '2026-10-18 12:00:05 deploy: done\n',
    ].join('');
    const hash = stored(await storeText(writer, log(), [output]));
    const bytes = await store.read(hash);
    // The name is the hash of what was stored, not of the raw output.
    for (const key of keys) {
      expect(text(bytes), `key ${key.slice(0, 5)}… survived in the stored log`).not.toContain(key);
      // Stored raw and redacted on read is not "before storage".
      expect(filesContaining(root, key), `key ${key.slice(0, 5)}… is on disk`).toEqual([]);
    }
    expect(sha256(bytes)).toBe(hash);
    expect(hash).not.toBe(sha256(output));
    expect((await store.get(hash))?.redaction).toBe('complete');
  });
});

describe('AC5 a secret with no pattern is scrubbed by value', () => {
  const rng = mulberry32(0x15_05);
  // Letters, digits and URL-reserved characters: no secret pattern, and URL-encoding changes it.
  const secret = word(rng, 22, 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXY3479#$&+,/:;=?@[]');
  const b64 = base64Form(utf8(secret), new Uint8Array(), 'standard');
  const forms = [
    { name: 'plain text', printed: `value ${secret}`, needle: secret },
    { name: 'base64', printed: `encoded ${b64.printed}`, needle: b64.core },
    { name: 'URL-encoded', printed: `callback https://app.example.test/cb?s=${urlEncode(secret)}`, needle: urlEncode(secret) },
  ];

  for (const form of forms) {
    it(`AC5 printed as ${form.name} and split across two output chunks, it is scrubbed before storage`, async () => {
      const { root, store, writer } = await open();
      const line = `2026-10-18 12:00:00 test: ${form.printed} ok\n`;
      const middle = line.indexOf(form.needle) + Math.floor(form.needle.length / 2);
      const hash = stored(await storeText(writer, log({ held: [secret] }), [line.slice(0, middle), line.slice(middle)]));
      const kept = text(await store.read(hash));
      expect(kept, `the ${form.name} form survived`).not.toContain(form.needle);
      expect(kept).toContain('2026-10-18 12:00:00 test: ');
      expect(kept).toContain(' ok\n');
      for (const f of forms) expect(filesContaining(root, f.needle), `the ${f.name} form is on disk`).toEqual([]);
      expect((await store.get(hash))?.redaction).toBe('complete');
    });
  }

  it('AC5 output the scrub cannot read is labelled redaction: incomplete', async () => {
    const { store, writer } = await open();
    // UTF-16LE with its byte-order mark: not UTF-8, so no form of the value can be found in it.
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`value ${secret}\r\n`, 'utf16le')]);
    const half = Math.floor(utf16.length / 2);
    const hash = stored(await storeText(writer, log({ held: [secret] }), [utf16.subarray(0, half), utf16.subarray(half)]));
    expect((await store.get(hash))?.redaction).toBe('incomplete');
  });
});

describe('AC14 only secret values are scrubbed from a run', () => {
  it('AC14 short plain values stay byte for byte while k3yZ9 and a 24-character BUILD_ID are scrubbed in every form', async () => {
    const { root, store, writer } = await open();
    const buildId = word(mulberry32(0x15_14), 24);
    const env = { CI: 'true', NODE_ENV: 'test', TZ: 'UTC', PORT: '3000', API_TOKEN: 'k3yZ9', BUILD_ID: buildId };
    const kept = ['GET http://localhost:3000/cart 200', 'NODE_ENV=test', 'build started at 12:00 UTC'];
    const secrets = { 'API_TOKEN k3yZ9': 'k3yZ9', 'the 24-character BUILD_ID': buildId };
    const lines = [...kept];
    for (const value of Object.values(secrets)) for (const form of everyForm(value)) lines.push(`echo ${form.printed} done`);
    const output = `${lines.join('\n')}\n`;
    const third = Math.floor(output.length / 3);
    const hash = stored(await storeText(writer, log({ env, held: [] }), [output.slice(0, third), output.slice(third, 2 * third), output.slice(2 * third)]));
    const out = text(await store.read(hash));
    // A scrub of every passed value strips `test`, `3000` and `UTC` from these lines.
    for (const line of kept) expect(out.includes(`${line}\n`), `line "${line}" is not kept byte for byte`).toBe(true);
    // A scrub that goes by names alone misses BUILD_ID, whose name marks nothing.
    const missed: string[] = [];
    for (const [name, value] of Object.entries(secrets))
      for (const form of everyForm(value)) if (out.includes(form.core) || filesContaining(root, form.core).length) missed.push(`${name} as ${form.name}`);
    expect(missed, `survived: ${missed.join('; ')}`).toEqual([]);
  });
});

describe('AC15 base64 at every offset and in both alphabets', () => {
  // A secret whose base64 holds '+' or '/' at every offset, so the URL-safe forms differ from the standard ones.
  const rng = mulberry32(0x15_15);
  let secret = '';
  for (;;) {
    secret = word(rng, 24, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789~?>');
    if (['', 'u', 'user:'].every((lead) => /[+/]/.test(base64Form(utf8(secret), utf8(lead), 'standard').core))) break;
  }

  it('AC15 a planted secret base64-encoded after 0, 1 and 2 leading bytes, standard and URL-safe, is scrubbed from all six', async () => {
    const { root, store, writer } = await open();
    const forms: { name: string; line: string; core: string }[] = [];
    for (const alphabet of ['standard', 'url-safe'] as const) {
      // 'user:' is 5 bytes, offset 2: the Authorization: Basic value for user:<secret>.
      for (const [offset, lead] of [[0, ''], [1, 'u'], [2, 'user:']] as const) {
        const b = base64Form(utf8(secret), utf8(lead), alphabet);
        forms.push({ name: `${alphabet} at offset ${offset}`, line: b.printed, core: b.core });
      }
    }
    expect(new Set(forms.map((f) => f.core)).size, 'the six forms are not all different').toBe(6);
    // Plain lines with no keyword, so only the scrub by value can find these.
    const output = `${forms.map((f) => `step 2 sent ${f.line} upstream`).join('\n')}\n`;
    const half = Math.floor(output.length / 2);
    const hash = stored(await storeText(writer, log({ held: [secret] }), [output.slice(0, half), output.slice(half)]));
    const out = text(await store.read(hash));
    // A scrub that matches only the secret's own base64 misses offsets 1 and 2; one that knows only the
    // standard alphabet misses the URL-safe forms. Either fails here, naming the forms it missed.
    const missed = forms.filter((f) => out.includes(f.core) || filesContaining(root, f.core).length).map((f) => f.name);
    expect(missed, `missed: ${missed.join(', ')}`).toEqual([]);
  });
});
