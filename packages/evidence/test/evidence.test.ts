import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { openEvidenceStore, scrubText, type PutRequest } from '../src/index.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function open() {
  const root = mkdtempSync(join(tmpdir(), 'deep-evidence-unit-'));
  roots.push(root);
  let clock = 0;
  const store = await openEvidenceStore({ root, now: () => clock });
  const writer = store.connect({ role: 'deepbuild', via: 'capture' });
  const put = async (text: string, extra: Partial<PutRequest> = {}) => {
    const result = await writer.put({ bytes: Buffer.from(text), kind: 'log', source: 'test', redaction: 'complete', license: { name: 'CC0-1.0', allows: [] }, ...extra });
    if (result.status !== 'stored') throw Error(result.reason);
    return result.evidence.sha256;
  };
  return { store, writer, put, at: (ms: number) => { clock = ms; } };
}

describe('retention of a series and of map layers', () => {
  it('drops uncited batches after 24 hours and uncited minute rollups after 7 days; cited ones and hour rollups follow 30 days', async () => {
    const { store, put, at } = await open();
    const batch = await put('batch 10:00:00', { kind: 'reading.batch' });
    const citedBatch = await put('batch 10:00:10', { kind: 'reading.batch' });
    const minute = await put('rollup 10:00', { kind: 'reading.rollup.minute' });
    const hour = await put('rollup 10', { kind: 'reading.rollup.hour' });
    const keep = { cited: new Set([citedBatch]), archived: new Set<string>() };

    at(23 * HOUR);
    expect((await store.retain(keep)).removed).toEqual([]);
    at(25 * HOUR);
    expect((await store.retain(keep)).removed).toEqual([batch]);
    at(6 * DAY);
    expect((await store.retain(keep)).removed).toEqual([]);
    at(8 * DAY);
    expect((await store.retain(keep)).removed).toEqual([minute]);
    at(31 * DAY);
    expect((await store.retain(keep)).removed).toEqual([hour]);
    expect(await store.get(citedBatch)).toBeDefined();
  });

  it("keeps an installed layer's newest rows file for each parent and level, and lets it go once the layer is removed", async () => {
    const { store, writer, put, at } = await open();
    const rows = (text: string, parent: string | null, level: number) => put(text, { kind: 'layer.rows', layer: { id: 'infra', parent, level } });
    const older = await rows('rows v1', null, 0);
    const deeper = await rows('rows for checkout', 'checkout', 1);
    at(DAY);
    const newest = await rows('rows v2', null, 0);
    const other = await put('rows of a removed layer', { kind: 'layer.rows', layer: { id: 'old', parent: null, level: 0 } });

    at(40 * DAY);
    const installed = { cited: new Set<string>(), archived: new Set<string>(), installed: new Set(['infra']) };
    expect((await store.retain(installed)).removed.sort()).toEqual([older, other].sort());
    expect(await store.get(newest)).toBeDefined();
    expect(await store.get(deeper)).toBeDefined();
    expect((await store.retain({ ...installed, installed: new Set() })).removed.sort()).toEqual([deeper, newest].sort());

    const unnamed = await writer.put({ bytes: Buffer.from('rows'), kind: 'layer.rows', source: 'test', redaction: 'complete', license: { name: 'CC0-1.0', allows: [] } });
    expect(unnamed).toMatchObject({ status: 'refused', reason: expect.stringMatching(/layer, parent and level/) });
  });
});

describe('video step times', () => {
  it('keeps where each step starts and ends, and refuses a step that runs backwards', async () => {
    const { store, writer, put } = await open();
    const steps = [{ step: 'open cart', startMs: 0, endMs: 1200 }, { step: 'pay', startMs: 1200, endMs: 4100 }];
    const video = await put('a recording', { kind: 'recording', steps });
    expect((await store.get(video))?.steps).toEqual(steps);
    const backwards = await writer.put({ bytes: Buffer.from('another'), kind: 'recording', source: 'test', redaction: 'complete', license: { name: 'CC0-1.0', allows: [] }, steps: [{ step: 'pay', startMs: 4100, endMs: 1200 }] });
    expect(backwards).toMatchObject({ status: 'refused', reason: expect.stringMatching(/step pay/) });
  });
});

describe('your yes to a send', () => {
  it('holds after the store reopens, so the same file to the same host is never asked about twice', async () => {
    const root = mkdtempSync(join(tmpdir(), 'deep-evidence-unit-'));
    roots.push(root);
    const first = await openEvidenceStore({ root, now: () => 0 });
    const put = await first.connect({ role: 'agent', session: 'session:1' }).put({ bytes: Buffer.from('agent file'), kind: 'log', source: 'test', redaction: 'complete', license: { name: 'CC0-1.0', allows: ['post'] } });
    if (put.status !== 'stored') throw Error(put.reason);
    const file = put.evidence.sha256;
    const asked: string[] = [];
    const boundary = { ask: async (q: { destination: string }) => { asked.push(q.destination); return true; }, deliver: async () => undefined };
    await first.send({ files: [file], via: 'post', destination: 'social.example' }, boundary);

    const reopened = await openEvidenceStore({ root, now: () => 0 });
    const again = await reopened.send({ files: [file], via: 'post', destination: 'social.example' }, boundary);
    await reopened.send({ files: [file], via: 'post', destination: 'other.example' }, boundary);
    expect(asked).toEqual(['social.example', 'other.example']);
    expect(again.sent).toEqual([{ sha256: file, destination: 'social.example' }]);
  });
});

describe('the scrub by field name', () => {
  const secret = ['password', 'db_password', 'clientSecret', 'x-api-key', 'AWS_SESSION_TOKEN', 'api.key', 'privateKey', 'Cookie', 'refresh_token', 'apikey'];
  const plain = ['input_tokens', 'max_tokens', 'tokenizer', 'name', 'keyboard', 'primary_key', 'id'];
  const scalar = fc.oneof(fc.string(), fc.integer(), fc.double({ noNaN: true, noDefaultInfinity: true }), fc.boolean(), fc.constant(null));
  const value = fc.oneof(scalar, fc.array(scalar, { maxLength: 3 }), fc.dictionary(fc.string({ maxLength: 4 }), fc.oneof(scalar, fc.array(scalar, { maxLength: 2 })), { maxKeys: 3 }));
  // Under ten characters: gitleaks' generic-api-key rule takes a longer value after a secret word on the line.
  const plainValue = fc.oneof(fc.stringMatching(/^[a-z0-9 ]{0,9}$/), fc.integer(), fc.boolean(), fc.constant(null));
  const doc = fc.tuple(fc.uniqueArray(fc.constantFrom(...secret)), fc.uniqueArray(fc.constantFrom(...plain)))
    .chain(([s, p]) => fc.tuple(fc.tuple(...s.map((k) => fc.tuple(fc.constant(k), value))), fc.tuple(...p.map((k) => fc.tuple(fc.constant(k), plainValue)))))
    .chain(([s, p]) => fc.shuffledSubarray([...s, ...p], { minLength: s.length + p.length }))
    .map((entries) => Object.fromEntries(entries));

  // The debug bundle and archived transcripts parse what the scrub returns.
  it('keeps JSON parseable, plain and escaped once, with every secret-named value masked and the rest unchanged', () => {
    fc.assert(fc.property(doc, (object) => {
      const once = JSON.parse(scrubText(JSON.stringify(object))) as Record<string, unknown>;
      const twice = JSON.parse(JSON.parse(scrubText(JSON.stringify(JSON.stringify(object)))) as string) as Record<string, unknown>;
      for (const scrubbed of [once, twice]) {
        expect(Object.keys(scrubbed)).toHaveLength(Object.keys(object).length);
        // gitleaks' generic-api-key rule can take a key's own name, as it does without the field rules.
        // An empty string holds nothing to mask.
        for (const [key, was] of Object.entries(object)) if (key in scrubbed) expect(scrubbed[key]).toEqual(secret.includes(key) && was !== '' ? '[REDACTED]' : was);
      }
    }), { numRuns: 1000, seed: 761 });
  });

  it('masks a field\'s value when a held value covers all or part of its name', () => {
    for (const [text, held] of [['password=hunter2', 'pass'], ['password=hunter2', 'password'], ['{"password":"hunter2"}', 'password'], ['Authorization: Basic aHVudGVyMg', 'Authoriz']] as const)
      expect(scrubText(`${text}\n`, { held: [held] }), `${text} with ${held} held`).not.toMatch(/hunter2|aHVudGVyMg/);
  });

  it('keeps JSON parseable when a held value is a secret field\'s whole value', () => {
    for (const [value, held] of [[123, '123'], [true, 'true'], [null, 'null'], [{ a: 'b' }, '{"a":"b"}'], [[1, 2], '[1,2]']] as const) {
      const once = JSON.stringify({ password: value });
      expect(JSON.parse(scrubText(once, { held: [held] })), `${once} with ${held} held`).toEqual({ password: '[REDACTED]' });
      const twice = JSON.stringify(once);
      expect(JSON.parse(JSON.parse(scrubText(twice, { held: [held] })) as string), `${twice} with ${held} held`).toEqual({ password: '[REDACTED]' });
    }
  });

  it('ends a value inside a JSON string at that string, and leaves empty values and the next field alone', () => {
    const cases: [string, string][] = [
      // A command or log line JSON-encoded: the value stops before the escaped quote and the string's own end.
      [JSON.stringify({ cmd: 'curl -d "password=hunter2" http://x' }), '{"cmd":"curl -d \\"password=[REDACTED]\\" http://x"}'],
      ['{"evidence":"Cookie: a=b","fix":"none"}', '{"evidence":"Cookie: [REDACTED]","fix":"none"}'],
      ['{"evidence":"token: Bearer abc def","fix":"none"}', '{"evidence":"token: [REDACTED]","fix":"none"}'],
      ['{"cmd":"password=\'hunter2","x":1}', '{"cmd":"password=\'[REDACTED]","x":1}'],
      // An escaped newline ends a line of the string, as a newline does in plain text.
      ['{"out":"PASSWORD=hunter2\\nUSER=bob\\nHOME=/home/bob"}', '{"out":"PASSWORD=[REDACTED]\\nUSER=bob\\nHOME=/home/bob"}'],
      [JSON.stringify({ content: '{\n  "user": "bob",\n  "token": 123\n}' }), JSON.stringify({ content: '{\n  "user": "bob",\n  "token": "[REDACTED]"\n}' })],
      // A quoted key may hold spaces.
      ['{"API Key": "abcd1234"}', '{"API Key": "[REDACTED]"}'],
      ['{"user password": "hunter2"}', '{"user password": "[REDACTED]"}'],
      // An empty value masks nothing, and never the field after it.
      ['PASSWORD= USER=bob', 'PASSWORD= USER=bob'],
      ['password=&user=bob', 'password=&user=bob'],
      ['clientSecret = s3cr3t; other', 'clientSecret = [REDACTED]; other'],
      // A bare value takes escaped backslashes whole, so the string around it still closes.
      ['{"cmd":"export TOKEN=abc\\\\"}', '{"cmd":"export TOKEN=[REDACTED]"}'],
      ['{"cmd":"echo \'password=abc\\\\\'"}', '{"cmd":"echo \'password=[REDACTED]\'"}'],
      // `:=` and `=>` assign; `==`, `===` and an arrow function are code, not fields.
      ['token := "q8Zr4Lm2"', 'token := "[REDACTED]"'],
      [':api_key => "q8Zr4Lm2",', ':api_key => "[REDACTED]",'],
      ['if (token == null) return;', 'if (token == null) return;'],
      ["if (password === '') fail();", "if (password === '') fail();"],
      ['tokens.map(token => token.id)', 'tokens.map(token => token.id)'],
      // A Python dict is read as a document; a log line that opens with a bracket isn't.
      [`{'size': '5"', 'password': 'abc"def'}`, `{'size': '5"', 'password': '[REDACTED]'}`],
      ['[req 5"] Authorization: Basic dXNl"cjpw', '[req 5"] Authorization: [REDACTED]'],
    ];
    for (const [text, want] of cases) expect(scrubText(text), text).toBe(want);
  });

  it('reads a name after an escaped newline, a value quoted inside a JSON string twice, and `&` outside a query', () => {
    const cases: [string, string][] = [
      ['{"out":"ok\\npassword=hunter2"}', '{"out":"ok\\npassword=[REDACTED]"}'],
      [JSON.stringify(JSON.stringify({ cmd: 'password="hunter two" ok' })), JSON.stringify(JSON.stringify({ cmd: 'password="[REDACTED]" ok' }))],
      ['password=a&b c', 'password=[REDACTED] c'],
      ['GET /x?token=abc&page=2', 'GET /x?token=[REDACTED]&page=2'],
      // A name after a `\u` escape, as Go's JSON writes `&` in a URL, and a query value ending at one.
      ['{"url":"https://x.test/cb?a=1\\u0026token=SEKRIT\\u0026b=2"}', '{"url":"https://x.test/cb?a=1\\u0026token=[REDACTED]\\u0026b=2"}'],
      ['{"w":"{\\"url\\":\\"/cb?a=1\\\\u0026token=SEKRIT\\"}"}', '{"w":"{\\"url\\":\\"/cb?a=1\\\\u0026token=[REDACTED]\\"}"}'],
      ['{"msg":"\\u003cpassword=SEKRIT\\u003e"}', '{"msg":"\\u003cpassword=[REDACTED]"}'],
      ['{"url":"/cb?a=1\\u0026access_token=SEKRIT\\u0026b=2"}', '{"url":"/cb?a=1\\u0026access_token=[REDACTED]\\u0026b=2"}'],
      // A backslash before a letter JSON doesn't escape is the text's own.
      ['{"a{\\"\\api_key=\'SEKRIT\'"}', '{"a{\\"\\api_key=\'[REDACTED]\'"}'],
      ['\\apassword: SEKRIT', '\\apassword: [REDACTED]'],
      // A `\u` escape of an outer string, as a Go logger writes around a body escaped by another encoder.
      ['{"body":"{\\"url\\":\\"/cb?code=1\\u0026token=SEKRIT\\u0026state=2\\"}"}', '{"body":"{\\"url\\":\\"/cb?code=1\\u0026token=[REDACTED]\\u0026state=2\\"}"}'],
      ['{"body":"{\\"html\\":\\"\\u003cb\\u003epassword=SEKRIT\\u003c/b\\u003e\\"}"}', '{"body":"{\\"html\\":\\"\\u003cb\\u003epassword=[REDACTED]\\"}"}'],
    ];
    for (const [text, want] of cases) expect.soft(scrubText(text), text).toBe(want);
  });

  it('leaves a string that ends at a secret name and its separator, as a prompt does, and reads JSON after a log prefix', () => {
    const unchanged = ['{"msg":"Enter password:","next":"x"}', '{"msg":"token=","next":"x"}', '["Enter password:","x"]',
      '{"msg":"Authorization:","next":"x"}', "{'msg': 'Enter password:', 'next': 'x'}",
      '{"type":"user","message":{"role":"user","content":"what should I type at Enter password:"},"uuid":"u1"}',
      // Nor one whose line in its string ends there.
      JSON.stringify({ msg: 'Cookie:\nbob', u: 'bob' }), JSON.stringify({ w: JSON.stringify({ msg: 'Cookie:\nbob', u: 'bob' }) }),
      "{'msg': 'Cookie:\\nbob', 'u': 'bob'}", JSON.stringify({ msg: 'Enter password:\nhello user bob', user: 'bob' }),
      // Nor a prompt in code, whose string closes before a call's `)`, a statement's `;` or the next argument.
      'print("Enter password: "); x = 1', JSON.stringify({ content: 'pw = input("Password: ") and ask("token: ", x)' })];
    for (const text of unchanged) expect.soft(scrubText(text), text).toBe(text);
    const stamp = '2026-10-27T10:00:00.1234567Z ';
    const cases: [string, string][] = [
      [`${stamp}{"m":"{\\"m\\":\\"echo\\\\npassword=hunter2\\"}"}`, `${stamp}{"m":"{\\"m\\":\\"echo\\\\npassword=[REDACTED]\\"}"}`],
      [`${stamp}{"out":"x","h":"Cookie: a=b","b":"c"}`, `${stamp}{"out":"x","h":"Cookie: [REDACTED]","b":"c"}`],
      [`INFO body={"m":"{\\"cmd\\":\\"password=ab\\\\\\"cd ef\\",\\"b\\":1}"}`, `INFO body={"m":"{\\"cmd\\":\\"password=[REDACTED]\\\\\\"cd ef\\",\\"b\\":1}"}`],
      // A quote escaped in text is no string's end, and a header's mask hides no field after it.
      ['{"msg":"a: \\"[\\\\\\" password: \\"ab,SEKRIT\\"","user":"bob"}', '{"msg":"a: \\"[\\\\\\" password: \\"[REDACTED]\\"","user":"bob"}'],
      ['INFO ["Authorization: Bearer SEKRIT token="SEKRIT"]', 'INFO ["Authorization: [REDACTED]"[REDACTED]"]'],
      // A Python string keeps the backslash of its escaped quote.
      ["{'a': 'password=ab\\'cd', 'b': 1}", "{'a': 'password=[REDACTED]\\'cd', 'b': 1}"],
    ];
    for (const [text, want] of cases) expect.soft(scrubText(text), text).toBe(want);
    // An escaped newline of a string no JSON object holds, as a JSON string literal or logfmt's `body="..."`.
    for (const text of [JSON.stringify({ content: JSON.stringify('msg\npassword=SEKRIT9') }), `INFO body=${JSON.stringify(JSON.stringify({ log: 'started\npassword=SEKRIT9' }))}`,
      JSON.stringify(JSON.stringify('started\ttoken: SEKRIT9')), JSON.stringify({ content: `see ${JSON.stringify('started\r\npassword=SEKRIT9')}` })]) {
      expect.soft(scrubText(text), text).toBe(text.replace('SEKRIT9', '[REDACTED]'));
    }
  });

  it('keeps pretty-printed JSON parseable with a secret field\'s object or array value across lines', () => {
    const doc = { a: { password: ['s3cr3tvalue'] }, credentials: { user: 'bob', pass: 'pw' }, api_key: [1, 2], name: 'ok' };
    const want = { a: { password: '[REDACTED]' }, credentials: '[REDACTED]', api_key: '[REDACTED]', name: 'ok' };
    for (const indent of [2, '\t']) {
      const plain = JSON.stringify(doc, null, indent);
      expect(() => JSON.parse(scrubText(plain)), plain).not.toThrow();
      expect(JSON.parse(scrubText(plain)), plain).toEqual(want);
      const once = JSON.stringify({ log: plain });
      expect(JSON.parse((JSON.parse(scrubText(once)) as { log: string }).log), once).toEqual(want);
    }
  });

  it('keeps JSON escaped twice parseable with quotes inside its strings, and a value longer than 16 KB whole', () => {
    // A document that no longer parses shows as its error.
    const parsed = (read: () => unknown) => { try { return read(); } catch (error) { return String(error); } };
    const wrap2 = (x: unknown) => JSON.stringify({ log: JSON.stringify({ log: JSON.stringify(x) }) });
    const unwrap2 = (text: string) => JSON.parse((JSON.parse((JSON.parse(text) as { log: string }).log) as { log: string }).log) as unknown;
    expect.soft(parsed(() => unwrap2(scrubText(wrap2({ password: 'ab"cd-leaked', user: 'bob' }))))).toEqual({ password: '[REDACTED]', user: 'bob' });
    expect.soft(parsed(() => unwrap2(scrubText(wrap2({ token: ['a"b'], note: 'keep-me' }))))).toEqual({ token: '[REDACTED]', note: 'keep-me' });
    const big = { credentials: { list: Array.from({ length: 2400 }, (_, n) => ({ n })), last: 'TAIL-SECRET-MATERIAL' }, user: 'bob' };
    for (const indent of [undefined, 2]) {
      const out = scrubText(JSON.stringify(big, null, indent));
      expect.soft(out, `indent ${indent}`).not.toContain('TAIL-SECRET');
      expect.soft(parsed(() => JSON.parse(out)), `indent ${indent}`).toEqual({ credentials: '[REDACTED]', user: 'bob' });
    }
  });

  it('reads an unclosed JSON value only as far as the text stays JSON, so later lines keep their own masks', () => {
    const cases: [string, string][] = [
      ['{"password": [1,\ntoken=ab]cdSECRETTAIL', '{"password": [REDACTED]\ntoken=[REDACTED]'],
      ['{"password": [1,\nsecret: ab}cdSECRETTAIL', '{"password": [REDACTED]\nsecret: [REDACTED]'],
      ['{"password": [[{"a": "x\\\n  "api_key": {\n    "v": "SECRETVAL"\n  }\n}', '{"password": [REDACTED]\n  "api_key": "[REDACTED]"\n}'],
      ['{"password": {"a": 1,\nuser said "C:\\temp\\\n{"token": "x}SECRETTAIL"}', '{"password": [REDACTED]\nuser said "C:\\temp\\\n{"token": "[REDACTED]"}'],
      ['{\n  "token": [\n    "qaQ",\n@@DOC@@\n{"name":"keep"}\nlast ]', '{\n  "token": [REDACTED]\n@@DOC@@\n{"name":"keep"}\nlast ]'],
      // A pretty-printed value cut off, or holding what isn't JSON, is masked as far as it reads as JSON.
      ['{\n  "user": "bob",\n  "password": [\n    "hunter2-line2",\n    "x9y', '{\n  "user": "bob",\n  "password": [REDACTED]'],
      ['{\n  "token": {\n    "a": "tokval', '{\n  "token": [REDACTED]'],
      ['{"password": [\n  "hunter2",\n  \'x\'\n]}', '{"password": [REDACTED]\n  \'x\'\n]}'],
      ['{"password": [\n  "hunter2", oops\n]}', '{"password": [REDACTED] oops\n]}'],
      // A cut-off value is masked through its last whole value, though what follows isn't JSON.
      ['{"password": {\n  "a": "hunter2"\nINFO next line', '{"password": [REDACTED]\nINFO next line'],
      ['{"password": [\n  "hunter2"\nINFO next line', '{"password": [REDACTED]\nINFO next line'],
      ['{"password": {\n  "a": 12345678\nINFO next', '{"password": [REDACTED]\nINFO next'],
      ['{"credentials": {\n  "user": "bob",\n  "pass": "hunter2"\n{"msg": "next record"}', '{"credentials": [REDACTED]\n{"msg": "next record"}'],
      // In an object only a key follows `{` or `,`, so the next JSONL record is no part of a cut-off one.
      ['{"token": {"a": 1,\n{"msg": "hello", "user": "bob"}\n{"msg": "next"}', '{"token": [REDACTED]\n{"msg": "hello", "user": "bob"}\n{"msg": "next"}'],
      // A name after an escaped newline or tab of a string escaped twice, and a value that opens with one.
      ['{"w":"{\\"msg\\":\\"line1\\\\npassword=SEKRIT2 ok\\"}"}', '{"w":"{\\"msg\\":\\"line1\\\\npassword=[REDACTED] ok\\"}"}'],
      ['{"w":"{\\"msg\\":\\"line1\\\\ttoken: SEKRIT3\\"}"}', '{"w":"{\\"msg\\":\\"line1\\\\ttoken: [REDACTED]\\"}"}'],
      ['{"msg":"password={\\n  \\"a\\": \\"SEK\\"\\n}"}', '{"msg":"password=[REDACTED]"}'],
      ['{"msg":"token: [\\n  \\"SEK2\\"\\n]"}', '{"msg":"token: [REDACTED]"}'],
      // A pattern's match keeps the quotes of the string it spans.
      ['{\n  "password": "abcdefgh"\n}', '{\n  "password": "[REDACTED]"\n}'],
      // A line that only starts with a quote is no pretty-printed JSON.
      ['"5" pipe" password: "abc def" ok "]', '"5" pipe" password: "[REDACTED]" ok "]'],
      ['"It\'s 5" long", token: "abc def",', '"It\'s 5" long", token: "[REDACTED]",'],
      // An apostrophe outside a string on a JSON line opens no string; two strings in a row aren't JSON.
      ['[{"a":1}] can\'t: {"token": [\n  "SECRETX"\n]}', '[{"a":1}] can\'t: {"token": "[REDACTED]"}'],
      ['s = """{\n  "token": {\n    "a": "SECRETA",\n    """"\nprint("x")', 's = """{\n  "token": [REDACTED]\n    """"\nprint("x")'],
      // A JSON-looking value inside a string ends with that string.
      [`{'a': 'x "password": ["', 'b': '"]}', 'c': 1}`, `{'a': 'x "password": [REDACTED]', 'b': '"]}', 'c': 1}`],
      ['{"password": [1,\nprose (see [docs]) here\nmore prose ] end\nkeep this', '{"password": [REDACTED]\nprose (see [docs]) here\nmore prose ] end\nkeep this'],
    ];
    for (const [text, want] of cases) expect.soft(scrubText(text), text).toBe(want);
  });

  it('ends a value that runs to the end of its line at the string it sits in, pretty-printed or escaped', () => {
    // A document that no longer parses shows as its error.
    const parsed = (text: string, layers: number) => { try { let x: unknown = JSON.parse(text); for (let n = 0; n < layers; n++) x = JSON.parse((x as { wrap: string }).wrap); return x; } catch (error) { return String(error); } };
    for (const msg of ['Authorization: Bearer abcdefgh', 'Cookie: sid=abc', 'token: Bearer abc', "password: 'hunter2", 'password={"a":1', 'pipe 5" wide, password: "hunter2"', 'he said " then password={"a":"hunter2"}', 'password: "hunter2"', 'token: abcdefgh"def', '"C:\\new," password={"a":"hunter2"']) {
      for (const indent of [undefined, 2]) {
        let doc = JSON.stringify({ msg, user: 'bob' }, null, indent);
        for (let layers = 0; layers < 3; layers++) {
          const out = parsed(scrubText(doc), layers) as { msg?: string; user?: string };
          expect.soft(out.user, `${msg}, indent ${indent}, ${layers} layers: ${JSON.stringify(out)}`).toBe('bob');
          expect.soft(String(out.msg), `${msg}, indent ${indent}, ${layers} layers`).not.toMatch(/abcdefgh|sid=abc|Bearer abc|hunter2|"a":1/);
          doc = JSON.stringify({ wrap: doc }, null, indent);
        }
      }
    }
  });

  it('ends an unclosed value escaped in a string at that string', () => {
    for (const msg of ['{"token": ["abc', '{"token": {"a": "b', '{"token": ["abc", "de']) {
      const out = scrubText(JSON.stringify({ msg, level: 'info' }));
      expect.soft(out, msg).toBe(JSON.stringify({ msg: '{"token": [REDACTED]', level: 'info' }));
    }
  });

  it('masks JSON escaped twice, keys and all', () => {
    const pasted = JSON.stringify(JSON.stringify({ password: 'hunter2', token: 12345 }));
    const line = JSON.stringify({ type: 'user', message: { content: `my log: ${pasted}` } });
    const content = (JSON.parse(scrubText(line)) as { message: { content: string } }).message.content;
    expect(JSON.parse(JSON.parse(content.slice('my log: '.length)) as string)).toEqual({ password: '[REDACTED]', token: '[REDACTED]' });
  });

  it('ends a bare value before sentence punctuation and a bracket it did not open', () => {
    const cases: [string, string][] = [
      ['my login is password=hunter2.', 'my login is password=[REDACTED].'],
      ['use (password=hunter2) here', 'use (password=[REDACTED]) here'],
      ['User{name=bob, password=abc}', 'User{name=bob, password=[REDACTED]}'],
      ["{'token': 123}", "{'token': [REDACTED]}"],
      ['password=a(b)c ok', 'password=[REDACTED] ok'],
      ['password=ab)cd-tail', 'password=[REDACTED]'],
      ['export PASSWORD=Sup3r)Secret', 'export PASSWORD=[REDACTED]'],
      ['password=pa]ss}word ok', 'password=[REDACTED] ok'],
    ];
    for (const [text, want] of cases) expect.soft(scrubText(text), text).toBe(want);
  });

  it('masks a bare value after `name: ` to the end of its line or string, with a YAML tag or anchor, and a doubled quote', () => {
    const cases: [string, string][] = [
      ['password: correct horse battery staple', 'password: [REDACTED]'],
      ['PASSWORD: hunter2 hunter3', 'PASSWORD: [REDACTED]'],
      ['token: abc user: bob', 'token: [REDACTED]'],
      ['password: hunter2 hunter3  ', 'password: [REDACTED]  '],
      ['{"msg":"password: hunter2 hunter3","level":"info"}', '{"msg":"password: [REDACTED]","level":"info"}'],
      ['{password: a b, user: bob}', '{password: [REDACTED], user: bob}'],
      ['password: !!str q7Zp2LmX9vR4tY8w', 'password: [REDACTED]'],
      ['password: !secret wifi_pw', 'password: [REDACTED]'],
      ['password: &pw q7Zp2LmX9vR4tY8w', 'password: [REDACTED]'],
      ["password: 'it''s q7Zp2LmX9vR4tY8w'", "password: '[REDACTED]'"],
      ["password='it''s q7' ok", "password='[REDACTED]' ok"],
      // An empty '' after a closed string, glued to code or not, is not a doubled quote, so the field after it is still read.
      ["x = 'password: ' + y + ''; token = 'Hunter2'", "x = 'password: '[REDACTED]''; token = '[REDACTED]'"],
      ["{\"code\":\"x = 'token: ' + y + '') client_secret = 'Hunter2'\",\"k\":1}", "{\"code\":\"x = 'token: '[REDACTED]'') client_secret = '[REDACTED]'\",\"k\":1}"],
      ["print('password: ' + ''.join(chars)); token = 'Hunter2'", "print('password: '[REDACTED]''.join(chars)); token = '[REDACTED]'"],
      ["x = 'password: '+''+pw; token = 'Hunter2'", "x = 'password: '[REDACTED]''+pw; token = '[REDACTED]'"],
      ["print('password: ' + b''.join(c)); token = 'Hunter2'", "print('password: '[REDACTED]''.join(c)); token = '[REDACTED]'"],
      ["{\"code\":\"print('password: ' + ''.join(c)); token = 'Hunter2'\",\"k\":1}", "{\"code\":\"print('password: '[REDACTED]''.join(c)); token = '[REDACTED]'\",\"k\":1}"],
      // A word with a symbol in front is still the value's; an operator is not.
      ['password: my $ecret pass', 'password: [REDACTED]'],
      ['token: x !== y', 'token: [REDACTED] !== y'],
      // The next secret field ends the value, and its own value is read.
      ['password: x api_key: "hunter two"', 'password: [REDACTED] api_key: "[REDACTED]"'],
      ['token: abc password: \'hunter two\'', 'token: [REDACTED] password: \'[REDACTED]\''],
      ['{"msg":"password: x api_key: \\"q7Zp2LmX9vR4tY8w\\""}', '{"msg":"password: [REDACTED] api_key: \\"[REDACTED]\\""}'],
      ['password: x {token: "q7Zp2LmX9"}', 'password: [REDACTED] {token: "[REDACTED]"}'],
      ['password: x foo(api_key="q7Zp2 LmX9")', 'password: [REDACTED] foo(api_key="[REDACTED]")'],
      ['{"msg":"password: x {token: \\"q7Zp2LmX9\\"}"}', '{"msg":"password: [REDACTED] {token: \\"[REDACTED]\\"}"}'],
      ['password: a b c token ?= hunter2x', 'password: [REDACTED] token ?= [REDACTED]'],
      ["password: a b c token += 'hunter two'", "password: [REDACTED] token += '[REDACTED]'"],
      ["password: a b c token?: string = 'hunter two'", "password: [REDACTED] token?: [REDACTED] = '[REDACTED]'"],
      ['password: x y\\ntoken: "hunter two"', 'password: [REDACTED] y\\ntoken: "[REDACTED]"'],
      ['password: a b c d y&token="hunter two"', 'password: [REDACTED] y&token="[REDACTED]"'],
      ['password: donkey kong', 'password: [REDACTED]'],
      ['password: a \\tapi_key: "sekret1" b', 'password: [REDACTED] \\tapi_key: "[REDACTED]" b'],
      ['password: a \\rprivate_key: "sekret4"', 'password: [REDACTED] \\rprivate_key: "[REDACTED]"'],
      ['{"msg":"password: a \\tapi_key: \\"sekret1\\""}', '{"msg":"password: [REDACTED] \\tapi_key: \\"[REDACTED]\\""}'],
      // A JSON literal before a blank and a closing bracket stays JSON.
      ['{"password": 12 }', '{"password": "[REDACTED]" }'],
      ['[{"password": null }]', '[{"password": "[REDACTED]" }]'],
      // So does one before a printed escape, as in a repr of pretty JSON.
      ["'{\\n  \"n\": 1,\\n  \"password\": 12\\n}'", "'{\\n  \"n\": 1,\\n  \"password\": \"[REDACTED]\"\\n}'"],
      ['{"password": true\\t}', '{"password": "[REDACTED]"\\t}'],
      // A word led by an escape, or a backslash run before a quote after several words, ends the value, so a
      // string around it still closes, as in a Python repr of JSON whose backslashes are doubled.
      ["'{\"m\":\"{\\\\\"m\\\\\":\\\\\"token: a b\\\\\"}\"}'", "'{\"m\":\"{\\\\\"m\\\\\":\\\\\"token: [REDACTED]\\\\\"}\"}'"],
      ["'{\"m\":\"{\\\\\"m\\\\\":\\\\\"token: a b\\\\\\\\nuser: bob\\\\\"}\"}'", "'{\"m\":\"{\\\\\"m\\\\\":\\\\\"token: [REDACTED]\\\\\"}\"}'"],
      ["'{\"m\":\"{\\\\\"m\\\\\":\\\\\"{\\\\\\\\\\\\\"m\\\\\\\\\\\\\":\\\\\\\\\\\\\"token: a b\\\\\\\\\\\\\"}\\\\\"}\"}'", "'{\"m\":\"{\\\\\"m\\\\\":\\\\\"{\\\\\\\\\\\\\"m\\\\\\\\\\\\\":\\\\\\\\\\\\\"token: [REDACTED]\\\\\\\\\\\\\"}\\\\\"}\"}'"],
      ["'{\"m\":\"{\\\\\"m\\\\\":\\\\\"token: ab\\\\\"}\"}'", "'{\"m\":\"{\\\\\"m\\\\\":\\\\\"token: [REDACTED]\\\\\"}\"}'"],
      ["'{\"m\":\"{\\\\\"m\\\\\":\\\\\"{\\\\\\\\\\\\\"m\\\\\\\\\\\\\":\\\\\\\\\\\\\"msg: token:  &a\\\\\\\\\\\\\"}\\\\\"}\"}'", "'{\"m\":\"{\\\\\"m\\\\\":\\\\\"{\\\\\\\\\\\\\"m\\\\\\\\\\\\\":\\\\\\\\\\\\\"msg: token:  [REDACTED]\\\\\\\\\\\\\"}\\\\\"}\"}'"],
      ["'{\"m\":\"password: a \\\\\"b\\\\\" c\"}'", "'{\"m\":\"password: [REDACTED] \\\\\"b\\\\\" c\"}'"],
      ["{\"m\":\"{\\\"token\\\": true \\t}\"}", "{\"m\":\"{\\\"token\\\": \\\"[REDACTED]\\\" \\t}\"}"],
      ["'{\\n  \"password\": 12 \\n}'", "'{\\n  \"password\": \"[REDACTED]\" \\n}'"],
      // A first word holding a field is the value, and the field after it is still read.
      ["token: !token==token: token:  Qx9&pwd: ", "token: [REDACTED]: token:  [REDACTED]: "],
      ["token: token: Qx9", "token: [REDACTED]"],
      // A field whose value starts inside the word a value already masked isn't read again, so a group it opens
      // there doesn't run past the string's quote.
      ["{\"m\":\"{\\\"m\\\":\\\"api_key: >token-:[\\\"}\"}", "{\"m\":\"{\\\"m\\\":\\\"api_key: [REDACTED]\\\"}\"}"],
      ["{\"m\":\"{\\\"m\\\":\\\"secret: !!}pwd:{\\\"}\"}", "{\"m\":\"{\\\"m\\\":\\\"secret: [REDACTED]\\\"}\"}"],
      // A field in the first word is left to the value, as HEAD reads it, so the next field is still read.
      ["password: (token = api_key: \"Qx9 Qx9\")", "password: [REDACTED] = api_key: \"[REDACTED]\")"],
      ["{\"m\":\"password: (token = api_key: \\\"Qx9 Qx9\\\")\",\"k\":1}", "{\"m\":\"password: [REDACTED] = api_key: \\\"[REDACTED]\\\")\",\"k\":1}"],
      // An escaped blank goes on through the word after it, as HEAD reads it, in strings escaped deep.
      ["{\"m\":\"{\\\"m\\\":\\\"{\\\\\\\"m\\\\\\\":\\\\\\\"token: x\\\\\\\\\\\\\\\\ Hunter2\\\\\\\"}\\\"}\"}", "{\"m\":\"{\\\"m\\\":\\\"{\\\\\\\"m\\\\\\\":\\\\\\\"token: [REDACTED]\\\\\\\"}\\\"}\"}"],
      ["{\"m\":\"{\\\"m\\\":\\\"{\\\\\\\"m\\\\\\\":\\\\\\\"token: \\\\\\\\\\\\\\\\ Hunter2\\\\\\\"}\\\"}\"}", "{\"m\":\"{\\\"m\\\":\\\"{\\\\\\\"m\\\\\\\":\\\\\\\"token: [REDACTED]\\\\\\\"}\\\"}\"}"],
      ["{\"m\":\"{\\\"m\\\":\\\"{\\\\\\\"m\\\\\\\":\\\\\\\"password: \\\\\\\\\\\\\\\\ Qx9,token: \\\\\\\"}\\\"}\"}", "{\"m\":\"{\\\"m\\\":\\\"{\\\\\\\"m\\\\\\\":\\\\\\\"password: [REDACTED],token: \\\\\\\"}\\\"}\"}"],
      ["{\"m\":\"{\\\"m\\\":\\\"{\\\\\\\"m\\\\\\\":\\\\\\\"token: \\\\\\\\\\\\\\\\ token==Qx9 \\\\\\\"}\\\"}\"}", "{\"m\":\"{\\\"m\\\":\\\"{\\\\\\\"m\\\\\\\":\\\\\\\"token: [REDACTED] \\\\\\\"}\\\"}\"}"],
      ["{\"m\":\"{\\\"m\\\":\\\"{\\\\\\\"m\\\\\\\":\\\\\\\"password: Qx9\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\ \\\\\\\\\\\\\\\\Qx9!token== tail\\\\\\\"}\\\"}\"}", "{\"m\":\"{\\\"m\\\":\\\"{\\\\\\\"m\\\\\\\":\\\\\\\"password: [REDACTED]\\\\\\\"}\\\"}\"}"],
      // A quote before a closing brace or bracket closes the string the tags are in, as in a repr of JSON.
      ["'{\"cmd\":{\"msg\":\"print(\\\\\"secret: !x \"},\"user\":\"bob\"}'", "'{\"cmd\":{\"msg\":\"print(\\\\\"secret: [REDACTED] \"},\"user\":\"bob\"}'"],
      ["'[\"\\\\\"password: !x \"]'", "'[\"\\\\\"password: [REDACTED] \"]'"],
      // A group after a run of tags is read as a bare word, so the escaped quote after it still closes the string.
      ["{\"m\":\"{\\\"m\\\":\\\"token: !x !!y {Qx9\\\"}\"}", "{\"m\":\"{\\\"m\\\":\\\"token: [REDACTED] [REDACTED]\\\"}\"}"],
      // A `!`-led word holding what reads as a field is the bare value, read as a field or not.
      ["password: !token==Hunter2x", "password: [REDACTED]"],
      ["pwd: !pwd?:Hunter2x", "pwd: [REDACTED]"],
      ["password: !Token::Hunter2x", "password: [REDACTED]"],
      ["{\"m\":\"password: !token=>Hunter2x\",\"k\":1}", "{\"m\":\"password: [REDACTED]\",\"k\":1}"],
      ["password: !Hunter2,x!token==", "password: [REDACTED],x!token=="],
      ["password: !Hunter2,token=x", "password: [REDACTED],token=[REDACTED]"],
      ["{\"m\":\"password: !Hunter2;token=x\",\"k\":1}", "{\"m\":\"password: [REDACTED];token=[REDACTED]\",\"k\":1}"],
      ["password: !Hunter2\"token\":abc", "password: [REDACTED]\"token\":[REDACTED]"],
      ["password: !token==Hunter2\\Qx9", "password: [REDACTED]"],
      ["password: !token=>\\nHunter2", "password: [REDACTED]"],
      ["{\"m\":\"password: !token==\\tQx9true\",\"k\":1}", "{\"m\":\"password: [REDACTED]\",\"k\":1}"],
      // A quoted value after a YAML tag or anchor; the tags go too, as what reads as one may be the secret.
      ['password: &pw "hunter two"', 'password: [REDACTED] "[REDACTED]"'],
      ["password: !!str 'hunter two'", "password: [REDACTED] '[REDACTED]'"],
      ["password: &a !!str 'hunter two'", "password: [REDACTED] '[REDACTED]'"],
      ['password: ! "hunter two"', 'password: [REDACTED] "[REDACTED]"'],
      ['{"m":"password: &pw \\"hunter two\\"","k":1}', '{"m":"password: [REDACTED] \\"[REDACTED]\\"","k":1}'],
      ['password: &a !!str hunter2', 'password: [REDACTED] [REDACTED]'],
      ['password: !!str &a hunter2', 'password: [REDACTED] [REDACTED]'],
      ['password: &a &b hunter2 more', 'password: [REDACTED] [REDACTED]'],
      // A field after tags, or a quoted key after a tag, is read as its own.
      ['password: !a !b api_key: "Hunter2"', 'password: [REDACTED] api_key: "[REDACTED]"'],
      ['{"m":"password: !a !b api_key: \\"Hunter2 Qx9\\"","k":1}', '{"m":"password: [REDACTED] api_key: \\"[REDACTED]\\"","k":1}'],
      ['password: !x "token": "Hunter2 Qx9"', 'password: [REDACTED] "token": "[REDACTED]"'],
      ['password: &a !b "api_key": "Hunter2 Qx9"', 'password: [REDACTED] "api_key": "[REDACTED]"'],
      ["password: &a&b  &\\ttoken = 'Hunter2 Qx9'", "password: [REDACTED]  &\\ttoken = '[REDACTED]'"],
      ['password: &\\t!x!\\tsecret:`Hunter2 Qx9`', 'password: &\\t!x!\\tsecret:`[REDACTED]`'],
      ['password: !a !b {"token": "Hunter2 Qx9"}', 'password: [REDACTED] {"token": "[REDACTED]"}'],
      ['api_key: !!str !!str {\\"token\\": \\"Hunter2 Qx9\\"}', 'api_key: [REDACTED] {\\"token\\": \\"[REDACTED]\\"}'],
      ['print("password: !Hunter2 "+name+"!")', 'print("password: [REDACTED] "[REDACTED]"!")'],
      ['{"m":"password: !Hunter2 \\"\\" ok"}', '{"m":"password: [REDACTED] \\"\\" ok"}'],
      ['{"m":"echo \\"password: !Hunter2 \\"+x+\\"y\\""}', '{"m":"echo \\"password: [REDACTED] \\"[REDACTED]\\"y\\""}'],
      // A value led by `!` that ends a string isn't a tag before the string's own closing quote.
      ['{"msg":"password: !Hunter2","level":"info"}', '{"msg":"password: [REDACTED]","level":"info"}'],
      ['{"msg":"password: !Hunter2 ","k":1}', '{"msg":"password: [REDACTED] ","k":1}'],
      ['{"m":"{\\"a\\":\\"password: !Hunter2\\"}"}', '{"m":"{\\"a\\":\\"password: [REDACTED]\\"}"}'],
      ["echo 'password: !Hunter2' 'next'", "echo 'password: [REDACTED]' 'next'"],
      ['print("password: !Hunter2 ")', 'print("password: [REDACTED] ")'],
      ['logger.warn("secret: !Hunter2 ", e);', 'logger.warn("secret: [REDACTED] ", e);'],
      ['msg="password: !Hunter2 " user=bob', 'msg="password: [REDACTED] " user=bob'],
      ["echo 'password: !Hunter2 ' 'next'", "echo 'password: [REDACTED] ' 'next'"],
      ['password: !Hunter2 ""', 'password: [REDACTED] ""'],
      ["print('password: !Hunter2', 'x')", "print('password: [REDACTED]', 'x')"],
      ['{"cmd":"echo \\"password: !pw1\\" \\"x\\""}', '{"cmd":"echo \\"password: [REDACTED]\\" \\"x\\""}'],
      // A quoted key's value of several words is masked whole.
      ['"password": 1234 5678', '"password": [REDACTED]'],
      ['"password": true story', '"password": [REDACTED]'],
      // `name=` still ends at a blank, as a shell's `PASSWORD=x make all` does, and so does `name:` with none after it.
      ['PASSWORD=x make all', 'PASSWORD=[REDACTED] make all'],
      ['token:abc def', 'token:[REDACTED] def'],
    ];
    for (const [text, want] of cases) expect.soft(scrubText(text), text).toBe(want);
  });

  it('masks the value after a type annotation and a quoted value after a string prefix', () => {
    const cases: [string, string][] = [
      ['password: str = "Qw3rty!Pass"', 'password: [REDACTED] = "[REDACTED]"'],
      ['    api_key: Optional[str] = None', '    api_key: [REDACTED] = [REDACTED]'],
      ['const token: string = "Qw3rtyPass123";', 'const token: [REDACTED] = "[REDACTED]";'],
      ['token: str | None = None', 'token: [REDACTED] = [REDACTED]'],
      ['password=b"Qw3rty!Pass" ok', 'password=b"[REDACTED]" ok'],
      ["secret = rb'Qw3rty' ok", "secret = rb'[REDACTED]' ok"],
      ['headers = {"Authorization": f"Bearer Qw3rtyPass123"}', 'headers = {"Authorization": f"[REDACTED]"}'],
      ['password: str', 'password: [REDACTED]'],
      ['def login(password: str = None):', 'def login(password: [REDACTED] = [REDACTED]):'],
    ];
    for (const [text, want] of cases) expect.soft(scrubText(text), text).toBe(want);
  });

  it('masks the value after a nested, generic or quoted annotation, and inside triple quotes', () => {
    const cases: [string, string][] = [
      ['password: Optional[Dict[str, str]] = "Qw3rty!Pass"', 'password: [REDACTED] = "[REDACTED]"'],
      ['password: Annotated[str, Field(min_length=8)] = "Qw3rty!Pass"', 'password: [REDACTED] = "[REDACTED]"'],
      ['token: Map<string, string> = "Qw3rtyPass123";', 'token: [REDACTED] = "[REDACTED]";'],
      ['password: "Optional[str]" = "Qw3rty!Pass"', 'password: [REDACTED] = "[REDACTED]"'],
      ['password = """Qw3rty!Pass""" ok', 'password = """[REDACTED]""" ok'],
      ["password='''Qw3rty''' ok", "password='''[REDACTED]''' ok"],
      ['password: str = """Qw3rty!Pass"""', 'password: [REDACTED] = """[REDACTED]"""'],
      ['{"code": "password = \\"\\"\\"Qw3rty\\"\\"\\""}', '{"code": "password = \\"\\"\\"[REDACTED]\\"\\"\\""}'],
      ['x: Optional[Dict[str, str]] = y', 'x: Optional[Dict[str, str]] = y'],
    ];
    for (const [text, want] of cases) expect.soft(scrubText(text), text).toBe(want);
  });

  it('masks the value after a Rust, Kotlin or TypeScript annotation, escaped in a string or not, and keeps comparisons and comments', () => {
    const cases: [string, string][] = [
      ['let password: &str = "Qw3rty!Pass";', 'let password: [REDACTED] = "[REDACTED]";'],
      ['const PASSWORD: &\'static str = "Qw3rty!Pass";', 'const PASSWORD: [REDACTED] = "[REDACTED]";'],
      ['val password: String? = "Qw3rty!Pass"', 'val password: [REDACTED] = "[REDACTED]"'],
      ['{"text":"password: \\"str\\" = \\"Qw3rty!Pass\\""}', '{"text":"password: [REDACTED] = \\"[REDACTED]\\""}'],
      ['token: string | \'none\' = "Qw3rtyPass123"', 'token: [REDACTED] = "[REDACTED]"'],
      ['token: (string | null) = "Qw3rtyPass123"', 'token: [REDACTED] = "[REDACTED]"'],
      ['token: [string, string] = ["Qw3rty", "x"]', 'token: [REDACTED] = [REDACTED]'],
      ['password: typeof x = "Qw3rty!Pass"', 'password: [REDACTED] = "[REDACTED]"'],
      ['password: Map<string, () => void> = "Qw3rty!Pass"', 'password: [REDACTED] = "[REDACTED]"'],
      ['token: a < b = c', 'token: [REDACTED] < b = c'],
      ['token: x == y', 'token: [REDACTED] == y'],
      ['password: str  # comment = foo', 'password: [REDACTED]  # comment = foo'],
    ];
    for (const [text, want] of cases) expect.soft(scrubText(text), text).toBe(want);
  });

  it('reads compound assignments and an optional member as separators, and counts flags as words', () => {
    const cases: [string, string][] = [
      ['API_TOKEN ?= Qw3rty!Pass', 'API_TOKEN ?= [REDACTED]'],
      ['export API_TOKEN?=Qw3rty!Pass', 'export API_TOKEN?=[REDACTED]'],
      ['API_TOKEN += Qw3rty!Pass', 'API_TOKEN += [REDACTED]'],
      ['password ||= "Qw3rty!Pass"', 'password ||= "[REDACTED]"'],
      ['password ??= "Qw3rty!Pass"', 'password ??= "[REDACTED]"'],
      ['class A { password?: string = "Qw3rty!Pass"; }', 'class A { password?: [REDACTED] = "[REDACTED]"; }'],
      ['password!: string = "Qw3rty!Pass"', 'password!: [REDACTED] = "[REDACTED]"'],
      ['secret: --dry-run --verbose --force --quiet mode=fast', 'secret: [REDACTED] --verbose --force --quiet mode=fast'],
      ['if (password != x) y', 'if (password != x) y'],
      ['token || fallback', 'token || fallback'],
      ['val key = apiKey?:return null', 'val key = apiKey?:return null'],
      ['x = (token?: "anon")', 'x = (token?: "anon")'],
      ["$t = $token?:'default';", "$t = $token?:'default';"],
      ['SECRET_KEY ::= Qw3rty!Pass', 'SECRET_KEY ::= [REDACTED]'],
      ['SECRET_KEY:::=Qw3rty!Pass', 'SECRET_KEY:::=[REDACTED]'],
      ['password?: string | number | null | undefined = "Qw3rty!Pass"', 'password?: [REDACTED] = "[REDACTED]"'],
    ];
    for (const [text, want] of cases) expect.soft(scrubText(text), text).toBe(want);
  });

  it('keeps a path through a secret-named module and a file position in a secret-named file', () => {
    const cases: [string, string][] = [
      ['Token::KEY = "Qw3rty!Pass"', 'Token::KEY = "[REDACTED]"'],
      ['let s = Secret::new(x);', 'let s = Secret::new(x);'],
      ['use crate::auth::{token::Claims, password::hash};', 'use crate::auth::{token::Claims, password::hash};'],
      ['src/token.rs:10:5', 'src/token.rs:10:5'],
      ['    at verify (/app/src/token.js:12:5)', '    at verify (/app/src/token.js:12:5)'],
      ['src/auth/token.ts:42:  const user = getUser(id);', 'src/auth/token.ts:42:  const user = getUser(id);'],
      ['{"path":"src/token.rs:10:5","x":1}', '{"path":"src/token.rs:10:5","x":1}'],
      ['db.password: 12345678', 'db.password: [REDACTED]'],
      ['use crate::token::{Claims, Token};', 'use crate::token::{Claims, Token};'],
      ['use crate::auth::token::*;', 'use crate::auth::token::*;'],
      ['let c = Token::<Claims>::decode(&s, &key)?;', 'let c = Token::<Claims>::decode(&s, &key)?;'],
      ['userPassword:: e1NTSEF9cGFzc3dvcmQxMjM0NQ==', 'userPassword:: [REDACTED]'],
      ['userPassword:: cGFzc3dvcmQxMjM=', 'userPassword:: [REDACTED]'],
      ['userPassword:: e1NTSEE1MTJ9cGJxdTBn\n VGJpMFpoeEtGa0hr\r\n Zz09\ncn: bob', 'userPassword:: [REDACTED]\ncn: bob'],
    ];
    for (const [text, want] of cases) expect.soft(scrubText(text), text).toBe(want);
  });

  it('masks a value whose scheme prefix sits in braces, with the hash after it', () => {
    const cases: [string, string][] = [
      ['userPassword: {SSHA}W6ph5Mm5Pz8GgiULbPgzG37mj9g=', 'userPassword: [REDACTED]'],
      ['spring.security.user.password={bcrypt}$2a$10$dXJ3SW6G7P50lGmMkkmwe.20cQQubK3 ok', 'spring.security.user.password=[REDACTED] ok'],
      ['password: {noop}Qw3rty!Pass', 'password: [REDACTED]'],
      ['token = [x]Qw3rty ok', 'token = [REDACTED] ok'],
      ['password={"a":1}, next', 'password=[REDACTED], next'],
      ['{"msg":"x password={\\"a\\":\\"Qw3rty\\"}say \\"hi\\""}', '{"msg":"x password=[REDACTED] \\"hi\\""}'],
      ['{"cmd":"ldapadd password={SSHA}\\/W6ph5Mm5Pz8GgiULbPgzG37mj9g= done"}', '{"cmd":"ldapadd password=[REDACTED] done"}'],
      ['secret={"a":1}.get("a")', 'secret=[REDACTED].get("a")'],
      ['const password: Record<string, string> =\n  {}', 'const password: [REDACTED] =\n  {}'],
      ['console.log(`token=Qw3rty`)', 'console.log(`token=[REDACTED]`)'],
    ];
    for (const [text, want] of cases) expect.soft(scrubText(text), text).toBe(want);
  });

  it('ends a URL user\'s password at the host', () => {
    const cases: [string, string][] = [
      ['git clone https://x-access-token:hunter2@github.com/o/r.git && cd r', 'git clone https://x-access-token:[REDACTED]@github.com/o/r.git && cd r'],
      ['pip install --index-url https://__token__:p@ss@pypi.example.com/simple x', 'pip install --index-url https://__token__:[REDACTED]@pypi.example.com/simple x'],
      ['{"url": "https://gitlab-ci-token:abc@gitlab.com/g/p.git"}', '{"url": "https://gitlab-ci-token:[REDACTED]@gitlab.com/g/p.git"}'],
      ['token:abc@def ok', 'token:[REDACTED] ok'],
      ['see https://password:abc@host?email=a@b.com ok', 'see https://password:[REDACTED]@host?email=a@b.com ok'],
      ['see https://password:abc@host#a@b ok', 'see https://password:[REDACTED]@host#a@b ok'],
      ['{"url":"https:\\/\\/x-access-token:abc@github.com\\/o\\/r.git"}', '{"url":"https:\\/\\/x-access-token:[REDACTED]@github.com\\/o\\/r.git"}'],
      // A URL's userinfo may hold `;` and `,`; with no `@` the name is a host and the value its port.
      ['git clone https://x-access-token:abc;de,f@github.com/o/r.git', 'git clone https://x-access-token:[REDACTED]@github.com/o/r.git'],
      ['see http://token:5000/api ok', 'see http://token:5000/api ok'],
      ['curl https://token.actions.githubusercontent.com:443/x', 'curl https://token.actions.githubusercontent.com:443/x'],
      ['Vault is up at http://secret:8200.', 'Vault is up at http://secret:8200.'],
      ['VAULT_ADDRS=http://secret:8200,http://backup:8200', 'VAULT_ADDRS=http://secret:8200,http://backup:8200'],
      ['Running at http://password:3000: ok', 'Running at http://password:3000: ok'],
      ['see <http://secret:8200> and http://api_key:Qw3rty!Pass> ok', 'see <http://secret:8200> and http://api_key:[REDACTED]> ok'],
      ['see https://x/cb?token=Qw3rtyPass123#section-2 ok', 'see https://x/cb?token=[REDACTED]#section-2 ok'],
      // A value that is no port is a password whose host was cut off.
      ['redis://password:Qw3rty!Pass', 'redis://password:[REDACTED]'],
      ['git clone https://token:Qw3rty$Pass\n@github.com/o/r', 'git clone https://token:[REDACTED]\n@github.com/o/r'],
      ['see https://token:Abc123?x=1 ok', 'see https://token:[REDACTED]?x=1 ok'],
    ];
    for (const [text, want] of cases) expect.soft(scrubText(text), text).toBe(want);
    // Each URL's password is read to its host, not to the end of the line.
    const line = 'https://token:a@h'.repeat(5000);
    const started = performance.now();
    expect(scrubText(line)).toBe('https://token:[REDACTED]@h'.repeat(5000));
    expect(performance.now() - started, 'many URL users on one line').toBeLessThan(1_000);
  });

  it('masks a private key block whose first line a field also masks', () => {
    const body = Array.from({ length: 3 }, (_, n) => 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC'.slice(n) + 'x'.repeat(n + 14)).join('\n');
    // The armor is built here, so this file holds no key block for a secret scan to find.
    const armor = (edge: string) => `-----${edge} PRIVATE KEY-----`;
    const out = scrubText(`private_key: ${armor('BEGIN')}\n${body}\n${armor('END')}\n`);
    for (const line of body.split('\n')) expect(out, line).not.toContain(line);
  });

  // Quadratic reading of these takes minutes for a megabyte; a linear one takes milliseconds. Words that are
  // gitleaks keywords, such as token, are left out: its pattern pass is quadratic on such lines by itself.
  it('reads a megabyte of dense names and values in linear time', () => {
    const MB = 1_048_576;
    for (const unit of ['pwd', 'a pwd=b ', 'pwd=[', 'x pwd="', '"pwd":{"k":', 'a cookie=b ', '"pwd":[\n', '\\"pwd\\":[\\n', '"pwd":["\n', '\\"pwd\\":[\\"a', ')))x pwd=a)']) {
      const text = unit.repeat(Math.ceil(MB / unit.length));
      const started = performance.now();
      scrubText(text);
      expect(performance.now() - started, `1 MB of ${JSON.stringify(unit)}`).toBeLessThan(2_000);
    }
  });

  it('reads a megabyte-long word of names after `name: ` in linear time', () => {
    const MB = 1_048_576;
    for (const unit of ['pwd', 'x_pwd_', 'pwdx:', '!pwd: ', '&pwd: ']) {
      const text = `pwd: a ${unit.repeat(Math.ceil(MB / unit.length))}`;
      const started = performance.now();
      scrubText(text);
      expect(performance.now() - started, `pwd: a, then 1 MB of ${JSON.stringify(unit)}`).toBeLessThan(2_000);
    }
  });
});
