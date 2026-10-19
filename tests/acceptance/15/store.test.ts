import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EvidenceError, openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import type { PutRequest, Redaction } from '../../../packages/evidence/src/index.ts';
import { anyUse, DAY, filesEqual, layoutFiles, png, removeRoots, sha256, T0, tempRoot, utf8 } from './helpers.ts';

afterEach(removeRoots);

const journey = { role: 'deepbuild', via: 'journey' } as const;
const shot = (bytes: Uint8Array): PutRequest => ({ bytes, kind: 'screenshot', source: 'journey:checkout#1', redaction: 'complete', license: anyUse, declares: 'png' });
const blob = (bytes: Uint8Array, kind = 'log'): PutRequest => ({ bytes, kind, source: 'run:1', redaction: 'complete', license: anyUse });

describe('AC1 storing the same bytes twice keeps one file', () => {
  it('AC1 two puts of the same bytes leave one file at <root>/ab/cdef… and one record', async () => {
    const root = tempRoot();
    const store = await openEvidenceStore({ root, now: () => T0 });
    const writer = store.connect(journey);
    const bytes = png(32, 32, 1);
    const first = await writer.put(shot(bytes));
    const second = await writer.put(shot(bytes));
    expect(first.status).toBe('stored');
    expect(second.status).toBe('stored');
    const hash = sha256(bytes);
    if (first.status !== 'stored' || second.status !== 'stored') return;
    expect(first.evidence.sha256).toBe(hash);
    expect(second.evidence.sha256).toBe(hash);
    // A store that writes a copy per put leaves two files holding these bytes.
    expect(filesEqual(root, bytes)).toHaveLength(1);
    expect(layoutFiles(root, hash)).toHaveLength(1);
    expect(readFileSync(layoutFiles(root, hash)[0]!)).toEqual(Buffer.from(bytes));
    expect(first.evidence.size).toBe(bytes.length);
    expect(first.evidence.type).toBe('png');
    expect(Buffer.from(await store.read(hash))).toEqual(Buffer.from(bytes));
  });

  it('AC1 the default root is ~/.deepbuild/evidence', async () => {
    const home = tempRoot();
    const saved = process.env.HOME;
    process.env.HOME = home;
    try {
      const store = await openEvidenceStore({ now: () => T0 });
      const bytes = utf8('default root\n');
      await store.connect(journey).put(blob(bytes, 'trace'));
      expect(layoutFiles(join(home, '.deepbuild', 'evidence'), sha256(bytes))).toHaveLength(1);
    } finally {
      if (saved === undefined) delete process.env.HOME;
      else process.env.HOME = saved;
    }
  });
});

describe('AC3 retention', () => {
  it('AC3 removes uncited evidence after 30 days and keeps evidence behind a decision and archived transcripts', async () => {
    const root = tempRoot();
    let clock = T0;
    const store = await openEvidenceStore({ root, now: () => clock });
    const writer = store.connect({ role: 'deepbuild', via: 'capture' });
    const expired = utf8('uncited log from day 0\n');
    const decided = png(16, 16, 3);
    const transcript = utf8('{"session":"01J9","messages":[]}\n');
    const recent = utf8('uncited log from day 20\n');
    await writer.put(blob(expired));
    await writer.put({ ...blob(decided, 'screenshot'), declares: 'png' });
    await writer.put(blob(transcript, 'transcript'));
    clock = T0 + 20 * DAY;
    await writer.put(blob(recent));
    const [e, d, t, r] = [expired, decided, transcript, recent].map(sha256) as [string, string, string, string];
    const keep = { cited: new Set([d]), archived: new Set([t]) };

    clock = T0 + 29 * DAY;
    expect((await store.retain(keep)).removed).toEqual([]);
    expect(await store.get(e)).toBeDefined();

    clock = T0 + 31 * DAY;
    const { removed } = await store.retain(keep);
    expect(removed).toContain(e);
    expect(removed, 'evidence behind a decision was removed').not.toContain(d);
    // A retention pass that keeps only what a decision cites removes the 31-day-old archived transcript here.
    expect(removed, `the 31-day-old archived transcript ${t} was removed`).not.toContain(t);
    expect(removed, 'evidence 11 days old was removed').not.toContain(r);
    expect(await store.get(e)).toBeUndefined();
    expect(layoutFiles(root, e)).toEqual([]);
    await expect(store.read(e)).rejects.toMatchObject({ code: 'missing' });
    for (const h of [d, t, r]) {
      expect(layoutFiles(root, h), `kept file ${h}`).toHaveLength(1);
      expect(sha256(await store.read(h))).toBe(h);
    }

    clock = T0 + 400 * DAY;
    const later = await store.retain(keep);
    expect(later.removed).toContain(r);
    expect(later.removed).not.toContain(d);
    expect(later.removed, `the archived transcript ${t} was removed at day 400`).not.toContain(t);
    expect(sha256(await store.read(t))).toBe(t);
    expect(sha256(await store.read(d))).toBe(d);
  });
});

describe('AC4 evidence without a redaction label is refused', () => {
  it('AC4 a put or a text with no label, or a label outside the three, is refused and nothing is written', async () => {
    const root = tempRoot();
    const store = await openEvidenceStore({ root, now: () => T0 });
    const writer = store.connect(journey);
    const bytes = png(16, 16, 4);
    const { redaction: _drop, ...unlabelled } = shot(bytes);
    const noLabel = await writer.put(unlabelled as unknown as PutRequest);
    const badLabel = await writer.put({ ...shot(bytes), redaction: 'none' as unknown as Redaction });
    for (const result of [noLabel, badLabel]) {
      expect(result.status).toBe('refused');
      expect(result.slot.state).toBe('missing');
    }
    const sink = writer.text({ kind: 'log', source: 'run:1', license: anyUse } as unknown as Parameters<typeof writer.text>[0]);
    await sink.write('a log with no label\n');
    expect((await sink.close()).status).toBe('refused');
    expect(filesEqual(root, bytes)).toEqual([]);
    expect(await store.get(sha256(bytes))).toBeUndefined();
    expect(await store.get(sha256('a log with no label\n'))).toBeUndefined();
    // The same bytes with a label are stored, so the refusal is about the label.
    expect((await writer.put(shot(bytes))).status).toBe('stored');
  });
});

describe('AC17 stored bytes are checked on read, and a put survives a concurrent retention pass', () => {
  it('AC17 a file whose bytes change on disk is reported corrupt, naming its hash, and never served or sent as that hash', async () => {
    const root = tempRoot();
    const store = await openEvidenceStore({ root, now: () => T0 });
    const bytes = png(24, 24, 5);
    const hash = sha256(bytes);
    await store.connect(journey).put(shot(bytes));
    const [path] = layoutFiles(root, hash);
    const changed = Buffer.from(bytes);
    changed[changed.length - 20] = changed[changed.length - 20]! ^ 0xff;
    writeFileSync(path!, changed);

    // A store that trusts the file name serves the changed bytes here.
    const failure = await store.read(hash).then(
      (served) => Error(`served ${served.length} bytes as ${hash}`),
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(EvidenceError);
    expect(failure).toMatchObject({ code: 'corrupt' });
    expect((failure as Error).message).toContain(hash);

    const delivered: string[] = [];
    await store.send({ files: [hash], via: 'report', destination: 'reports.example' }, {
      ask: async () => true,
      deliver: async (file) => { delivered.push(sha256(file.bytes)); },
    }).catch(() => undefined);
    expect(delivered, `corrupt file ${hash} was sent`).toEqual([]);
    await expect(store.admitBaseline(hash)).rejects.toMatchObject({ code: 'refused' });
  });

  it('AC17 bytes stored while retention removes the same file stay present and cited', async () => {
    const root = tempRoot();
    let clock = T0;
    let store: Awaited<ReturnType<typeof openEvidenceStore>>;
    const bytes = utf8('a log written on day 0 and again on day 31\n');
    const hash = sha256(bytes);
    let race: string[] | undefined;
    let armed = false;
    store = await openEvidenceStore({
      root,
      now: () => clock,
      hooks: {
        async afterExistsCheck(sha) {
          if (!armed || sha !== hash) return;
          armed = false;
          // The retention pass runs between the put's existence check and its write.
          race = (await store.retain({ cited: new Set(), archived: new Set() })).removed;
        },
      },
    });
    const writer = store.connect({ role: 'deepbuild', via: 'capture' });
    await writer.put(blob(bytes));
    clock = T0 + 31 * DAY;
    armed = true;
    const result = await writer.put(blob(bytes));
    expect(race, 'the test hook did not run between the existence check and the write').toContain(hash);
    expect(result.status).toBe('stored');
    // A store that skips the write because the file existed leaves nothing here.
    expect(layoutFiles(root, hash), `file ${hash} is missing after a put that resolved`).toHaveLength(1);
    expect(await store.get(hash), `record ${hash} is missing after a put that resolved`).toBeDefined();
    expect(sha256(await store.read(hash))).toBe(hash);
    // It was just stored, so the next pass keeps it.
    expect((await store.retain({ cited: new Set(), archived: new Set() })).removed).not.toContain(hash);
  });
});
