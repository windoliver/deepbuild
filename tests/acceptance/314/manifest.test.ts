// AC1, AC2 and AC7: the manifest schema, extension.manifest@1, in the one package envelope. A field it doesn't
// define or an access word outside the Access list fails naming it, while clipboard, window and agent pass; an
// envelope whose id isn't owner/name fails naming the field; a media use without its access word fails naming
// the word; a name added without its ext.<plugin>. prefix fails naming the name unless the piece replaces the
// shipped piece of that name; a use that names no minor fails naming the use.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fixtures, getSchema, lintSchemas, listSchemas, validate } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import {
  ACCESS_WORDS, asJson, check, deleteAt, ENVELOPE, envelope, expectAccepted, expectRefused, expectRefusedWord, getAt, isObject, MANIFEST, manifest,
  MEDIA, mentions, NAME_LISTS, openSchemaValidate, PLUGIN, publishedValidate, RUNS, setAt, withoutMicrophoneValidate,
} from './helpers.ts';

const word = fc.stringMatching(/^[a-z][a-z_]{0,15}$/);
const bareName = fc.stringMatching(/^[a-z][a-z0-9_]{0,8}(\.[a-z][a-z0-9_]{0,8}){0,2}$/).filter((n) => !n.startsWith('ext.'));

describe('the shipped manifest and envelope contracts, so every refusal below is the fault planted and nothing else', () => {
  it('extension.manifest@1 and package.envelope@1 are published, lint clean, and the fixture manifest passes the schema and the manifest check', () => {
    const names = listSchemas().map((e) => e.name);
    expect(names).toContain(MANIFEST);
    expect(names).toContain(ENVELOPE);
    expect(lintSchemas(listSchemas()).filter((p) => p.schema === MANIFEST || p.schema === ENVELOPE)).toEqual([]);
    expectAccepted(validate(MANIFEST, manifest()), 'the fixture manifest against the schema');
    expectAccepted(check(manifest()), 'the fixture manifest against the manifest check');
    expectAccepted(validate(ENVELOPE, envelope()), 'the fixture envelope');
  });

  it('the contracts ship manifest and envelope fixtures, every one accepted, and one manifest fixture names the microphone', () => {
    const shipped = fixtures(MANIFEST);
    expect(shipped.length, 'fixtures/extension.manifest@1/*.json').toBeGreaterThan(0);
    for (const [i, m] of shipped.entries()) {
      expectAccepted(validate(MANIFEST, m), `shipped manifest fixture ${i} against the schema`);
      expectAccepted(check(m), `shipped manifest fixture ${i} against the manifest check`);
    }
    const words = (m: JsonValue): JsonValue[] => { const w = getAt(m, '/access/words'); return Array.isArray(w) ? w : []; };
    expect(shipped.some((m) => words(m).includes('microphone')), 'a shipped fixture uses the microphone word').toBe(true);
    const envelopes = fixtures(ENVELOPE);
    expect(envelopes.length, 'fixtures/package.envelope@1/*.json').toBeGreaterThan(0);
    for (const [i, e] of envelopes.entries()) expectAccepted(validate(ENVELOPE, e), `shipped envelope fixture ${i}`);
  });

  it('the manifest check refuses whatever the schema refuses, so one check covers the manifest', () => {
    const unknown = setAt(manifest(), '/frobnicate', 1);
    expectRefused(validate(MANIFEST, unknown), '/frobnicate', 'the schema on an unknown field');
    expectRefused(check(unknown), '/frobnicate', 'the manifest check on the same field');
  });
});

describe('AC1 a field the schema doesn\'t define, or an access word outside the Access list, fails naming it; clipboard, window and agent pass; an envelope id that isn\'t owner/name fails naming the field', () => {
  it('AC1 a manifest with a field extension.manifest@1 doesn\'t define fails its schema, naming the field', () => {
    expectRefused(validate(MANIFEST, setAt(manifest(), '/telemetry', { host: 'example.test' })), '/telemetry', 'an unknown top-level field');
    expectRefused(validate(MANIFEST, setAt(manifest(), '/panels/0/shortcut', 'cmd-k')), '/panels/0/shortcut', 'an unknown field inside a panel');
    expectRefused(validate(MANIFEST, setAt(manifest(), '/uses/0/pinned', true)), '/uses/0/pinned', 'an unknown field inside a use');
  });

  it('AC1 an access word outside the Access list fails its schema, naming the word', () => {
    for (const planted of ['network', 'keychain', 'notifications', 'secrets', 'schedule']) {
      const m = setAt(manifest(), '/access/words', ['files', planted]);
      expectRefusedWord(validate(MANIFEST, m), '/access/words/1', planted, `the word ${planted}`);
    }
  });

  it('AC1 every word the Access list names passes, and clipboard, window and agent pass together and each alone', () => {
    expectAccepted(validate(MANIFEST, setAt(manifest(), '/access/words', [...ACCESS_WORDS])), 'every listed word');
    expectAccepted(check(setAt(manifest(), '/access/words', [...ACCESS_WORDS])), 'every listed word, through the manifest check');
    expectAccepted(validate(MANIFEST, setAt(manifest(), '/access/words', ['clipboard', 'window', 'agent'])), 'clipboard, window and agent');
    for (const w of ['clipboard', 'window', 'agent']) expectAccepted(validate(MANIFEST, setAt(manifest(), '/access/words', [w])), w);
    expectAccepted(validate(MANIFEST, setAt(manifest(), '/access/words', ['device:ext.stocks.ticker@1'])), 'a device class of the plug-in\'s own');
  });

  it('AC1 notices, schedules and secrets are blocks a manifest declares, not access words: each fails as a word', () => {
    for (const block of ['notices', 'schedules', 'secrets']) {
      expectRefusedWord(validate(MANIFEST, setAt(manifest(), '/access/words', [block])), '/access/words/0', block, `${block} as an access word`);
    }
  });

  it('AC1 for any word outside the list, the schema refuses it naming the word, and the listed words pass (1,000 cases)', () => {
    const listed = new Set<string>(ACCESS_WORDS);
    fc.assert(fc.property(word, fc.constantFrom(...ACCESS_WORDS), (planted, good) => {
      fc.pre(!listed.has(planted));
      expectRefusedWord(validate(MANIFEST, setAt(manifest(), '/access/words', [good, planted])), '/access/words/1', planted, `the word ${planted}`);
      expectAccepted(validate(MANIFEST, setAt(manifest(), '/access/words', [good])), `the word ${good}`);
    }), RUNS);
  });

  it('AC1 for any field name the schema doesn\'t define, the schema refuses it naming the field (1,000 cases)', () => {
    const defined = new Set(Object.keys((getSchema(MANIFEST).properties ?? {}) as object));
    fc.assert(fc.property(word, (field) => {
      fc.pre(!defined.has(field));
      expectRefused(validate(MANIFEST, setAt(manifest(), `/${field}`, 'planted')), `/${field}`, `the field ${field}`);
    }), RUNS);
  });

  it('AC1 a package envelope whose id isn\'t owner/name fails, naming the field, in the envelope and at the manifest\'s root', () => {
    for (const id of ['stocks', 'acme/stocks/beta', '/stocks', 'acme/', 'acme stocks/app', '']) {
      expectRefused(validate(ENVELOPE, setAt(envelope(), '/id', id)), '/id', `the envelope id ${JSON.stringify(id)}`);
      expectRefused(validate(MANIFEST, setAt(manifest(), '/id', id)), '/id', `the manifest id ${JSON.stringify(id)}`);
    }
    expectRefused(validate(ENVELOPE, deleteAt(envelope(), '/id')), '/id', 'an envelope with no id');
    expectRefused(validate(ENVELOPE, deleteAt(envelope(), '/version')), '/version', 'an envelope with no version');
    expectRefused(validate(ENVELOPE, deleteAt(envelope(), '/digest')), '/digest', 'an envelope with no digest');
    expectRefused(validate(ENVELOPE, setAt(envelope(), '/digest', 'abc')), '/digest', 'a digest that names no algorithm');
    expectRefused(validate(ENVELOPE, setAt(envelope(), '/signature', 'x')), '/signature', 'an envelope field the schema doesn\'t define');
    const properties = (getSchema(ENVELOPE).properties ?? {}) as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual(['digest', 'id', 'publisher_key', 'version']);
    expect((getSchema(ENVELOPE).required as string[]).sort()).toEqual(['digest', 'id', 'version']);
  });

  it('AC1 for any id without exactly one slash between two names, the envelope fails naming /id (1,000 cases)', () => {
    const name = fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,11}$/);
    fc.assert(fc.property(name, name, fc.constantFrom('none', 'two', 'leading', 'trailing'), (owner, pkg, shape) => {
      const id = shape === 'none' ? owner : shape === 'two' ? `${owner}/${pkg}/${pkg}` : shape === 'leading' ? `/${pkg}` : `${owner}/`;
      expectRefused(validate(ENVELOPE, setAt(envelope(), '/id', id)), '/id', `id ${id}`);
      expectAccepted(validate(ENVELOPE, setAt(envelope(), '/id', `${owner}/${pkg}`)), `id ${owner}/${pkg}`);
    }), RUNS);
  });

  it('AC1 (wrong program) a schema that accepts unknown fields passes the first shipped fixture and fails this test', () => {
    const first = fixtures(MANIFEST)[0]!;
    const open = openSchemaValidate();
    expectAccepted(open(first), 'the open twin on the first fixture');
    const planted = setAt(first, '/telemetry', { host: 'example.test' });
    expect(() => expectRefused(open(planted), '/telemetry', 'an unknown top-level field')).toThrow(/should be refused/);
    // The published schema refuses it where the twin lets it through.
    expectRefused(publishedValidate(planted), '/telemetry', 'an unknown top-level field');
  });
});

describe('AC2 a manifest that uses sound, the microphone or the camera without its access word fails, naming the word', () => {
  const using = (media: readonly string[], words: readonly string[]): JsonValue => setAt(setAt(manifest(), '/panels/0/media', [...media]), '/access/words', ['files', ...words]);

  it.each(MEDIA)('AC2 a panel that uses %s without its access word fails the manifest check, naming the word', (medium) => {
    expectRefusedWord(check(using([medium], [])), '/panels/0/media/0', medium, `${medium} without its word`);
    expectAccepted(check(using([medium], [medium])), `${medium} with its word`);
  });

  it('AC2 the word that is missing is the one named: the microphone with sound granted names microphone, not sound', () => {
    const result = check(using(['sound', 'microphone'], ['sound']));
    expectRefusedWord(result, '/panels/0/media/1', 'microphone', 'microphone without its word');
    if (!result.ok) expect(result.issues.map((i) => i.actual)).not.toContain('sound');
  });

  it('AC2 for any media a panel uses and any media words granted, the check passes exactly when every used medium is granted, naming each missing one (1,000 cases)', () => {
    fc.assert(fc.property(fc.subarray([...MEDIA]), fc.subarray([...MEDIA]), (used, granted) => {
      const result = check(using(used, granted));
      const missing = used.filter((m) => !granted.includes(m));
      if (missing.length === 0) expectAccepted(result, `used ${used} with ${granted}`);
      else for (const m of missing) expectRefusedWord(result, `/panels/0/media/${used.indexOf(m)}`, m, `used ${used} with ${granted}`);
    }), RUNS);
  });

  it('AC2 the published schema lists the microphone word, and a shipped fixture uses it with its word', () => {
    expect(mentions(getSchema(MANIFEST), 'microphone'), 'the schema names microphone among the access words').toBe(true);
    const fixture = fixtures(MANIFEST).find((m) => { const w = getAt(m, '/access/words'); return Array.isArray(w) && w.includes('microphone'); });
    expect(fixture, 'a shipped fixture with the microphone word').toBeDefined();
    expectAccepted(validate(MANIFEST, fixture!), 'the microphone fixture against the published schema');
  });

  it('AC2 (wrong program) a schema that leaves the microphone word out fails on its fixture, and this test names the fixture\'s refusal', () => {
    const fixture = fixtures(MANIFEST).find((m) => { const w = getAt(m, '/access/words'); return Array.isArray(w) && w.includes('microphone'); })!;
    const without = withoutMicrophoneValidate();
    const result = without(fixture);
    expect(result.ok, 'the twin refuses the fixture that uses the microphone').toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.actual)).toContain('microphone');
    expect(() => expectAccepted(result, 'the microphone fixture against the published schema')).toThrow(/microphone fixture.*should be accepted/);
    expectAccepted(publishedValidate(fixture), 'the microphone fixture against the published schema');
  });
});

describe('AC7 a name added without its ext.<plugin>. prefix fails, naming the name, unless the piece replaces the shipped piece of that name; a use that names no minor fails, naming the use', () => {
  it.each(NAME_LISTS)('AC7 in %s, ext.stocks.alert passes and stocks.alert fails, naming the name', (list) => {
    expectAccepted(check(setAt(manifest(), `/${list}`, ['ext.stocks.alert'])), `${list}: ext.stocks.alert`);
    expectRefusedWord(check(setAt(manifest(), `/${list}`, ['stocks.alert'])), `/${list}/0`, 'stocks.alert', `${list}: stocks.alert`);
    expectRefusedWord(check(setAt(manifest(), `/${list}`, ['ext.stocks.alert', 'alert'])), `/${list}/1`, 'alert', `${list}: a bare second name`);
  });

  it('AC7 an output interface a piece provides is named the same way: ext.stocks.quote@1 passes, quote@1 fails naming it', () => {
    expectAccepted(check(setAt(manifest(), '/provides/0/interface', 'ext.stocks.quote@1')), 'ext.stocks.quote@1');
    expectRefusedWord(check(setAt(manifest(), '/provides/0/interface', 'quote@1')), '/provides/0/interface', 'quote@1', 'a bare output interface');
  });

  it('AC7 the prefix is the plug-in\'s own: a name under another plug-in\'s prefix fails, naming the name', () => {
    expect(getAt(manifest(), '/id')).toBe(`acme/${PLUGIN}`);
    expectRefusedWord(check(setAt(manifest(), '/events', ['ext.weather.alert'])), '/events/0', 'ext.weather.alert', 'another plug-in\'s prefix');
  });

  it('AC7 a bare name passes when the manifest declares that it replaces the shipped piece of that name', () => {
    // The fixture's own declared names all carry the prefix, so the refusals here are about the names planted.
    const m = manifest();
    for (const list of NAME_LISTS) expect(Array.isArray(m[list]) && (m[list] as JsonValue[]).every((n) => typeof n === 'string' && n.startsWith(`ext.${PLUGIN}.`)), list).toBe(true);
    expect(isObject(m.access) && Array.isArray(asJson(m.access.words))).toBe(true);
    expectAccepted(check(m), 'the fixture manifest');
    expectAccepted(check(setAt(setAt(manifest(), '/events', ['stocks.alert']), '/replaces', ['stocks.alert'])), 'a replaced event kind');
    expectAccepted(check(setAt(setAt(manifest(), '/provides/0/interface', 'needs-you@1'), '/replaces', ['needs-you@1'])), 'a view that replaces needs-you@1');
    expectRefusedWord(check(setAt(setAt(manifest(), '/provides/0/interface', 'needs-you@1'), '/replaces', ['session.row@1'])), '/provides/0/interface', 'needs-you@1', 'replacing another piece');
  });

  it('AC7 for any name without the prefix, each list refuses it naming the name, and the same name under ext.stocks. passes (1,000 cases)', () => {
    fc.assert(fc.property(bareName, fc.constantFrom(...NAME_LISTS), (name, list) => {
      expectRefusedWord(check(setAt(manifest(), `/${list}`, [name])), `/${list}/0`, name, `${list}: ${name}`);
      expectAccepted(check(setAt(manifest(), `/${list}`, [`ext.${PLUGIN}.${name.replace(/\./g, '_')}`])), `${list}: ext.${PLUGIN}.${name}`);
      expectAccepted(check(setAt(setAt(manifest(), `/${list}`, [name]), '/replaces', [name])), `${list}: ${name} replaced`);
    }), RUNS);
  });

  it('AC7 a manifest whose use names no minor fails its schema, naming the use', () => {
    expectRefused(validate(MANIFEST, deleteAt(manifest(), '/uses/0/minor')), '/uses/0/minor', 'a use with no minor');
    expectRefused(check(deleteAt(manifest(), '/uses/0/minor')), '/uses/0/minor', 'a use with no minor, through the manifest check');
    expectRefused(validate(MANIFEST, setAt(manifest(), '/uses/0/minor', 'latest')), '/uses/0/minor', 'a use whose minor is not a number');
    expectAccepted(validate(MANIFEST, setAt(manifest(), '/uses/0/minor', 3)), 'a use at minor 3');
    expectRefused(validate(MANIFEST, deleteAt(manifest(), '/provides/0/minor')), '/provides/0/minor', 'a provided output with no minor');
  });

  it('AC7 for any list of uses, the one whose minor is left out is the use named (1,000 cases)', () => {
    const use = (i: number): JsonValue => ({ interface: `reading.batch@${i + 1}`, minor: i, digest: `d1:${'0'.repeat(63)}${i}` });
    fc.assert(fc.property(fc.integer({ min: 1, max: 5 }), fc.nat(4), (count, which) => {
      fc.pre(which < count);
      const uses = Array.from({ length: count }, (_, i) => use(i));
      const m = setAt(manifest(), '/uses', uses);
      expectAccepted(validate(MANIFEST, m), `${count} uses`);
      expectRefused(validate(MANIFEST, deleteAt(m, `/uses/${which}/minor`)), `/uses/${which}/minor`, `use ${which} without its minor`);
    }), RUNS);
  });

});
