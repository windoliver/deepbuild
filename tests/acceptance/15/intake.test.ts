import { afterEach, describe, expect, it } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import type { MediaType, PutRequest } from '../../../packages/evidence/src/index.ts';
import { anyUse, jpegFixture, layoutFiles, mp4Fixture, png, removeRoots, sha256, T0, tempRoot } from './helpers.ts';

afterEach(removeRoots);

const journey = { role: 'deepbuild', via: 'journey' } as const;
const slot = (bytes: Uint8Array, declares: MediaType, kind = 'screenshot'): PutRequest => ({
  bytes, kind, source: 'journey:checkout#4', redaction: 'complete', license: anyUse, declares,
});

/** The MP4 fixture with its trailing moov box removed: ftyp, free and mdat still add up to the file. */
function mp4WithoutMoov(): Uint8Array {
  const b = Buffer.from(mp4Fixture());
  let at = 0;
  while (at < b.length) {
    const size = b.readUInt32BE(at);
    if (b.toString('latin1', at + 4, at + 8) === 'moov') return new Uint8Array(b.subarray(0, at));
    at += size;
  }
  throw Error('fixture has no moov box');
}

describe('AC7 binary evidence cut short is kept as truncated, naming what is missing', () => {
  const pngFile = png(48, 48, 7);
  const cases = [
    { name: 'a PNG cut 1 KB before its end', declares: 'png' as const, whole: pngFile, cut: pngFile.slice(0, pngFile.length - 1024), missing: /IEND/ },
    { name: 'a JPEG with its end-of-image marker cut off', declares: 'jpeg' as const, whole: jpegFixture(), cut: jpegFixture().slice(0, -2), missing: /EOI|end.of.image/i },
    { name: 'an MP4 with no moov box', declares: 'mp4' as const, whole: mp4Fixture(), cut: mp4WithoutMoov(), missing: /moov/ },
  ];

  it('AC7 the fixtures are what the criterion names', () => {
    expect(pngFile.length).toBeGreaterThan(2048);
    expect(Buffer.from(cases[0]!.cut).includes(Buffer.from('IEND'))).toBe(false);
    expect([...jpegFixture().slice(-2)]).toEqual([0xff, 0xd9]);
    expect(Buffer.from(cases[2]!.cut).includes(Buffer.from('moov'))).toBe(false);
  });

  for (const c of cases) {
    it(`AC7 ${c.name} is stored as truncated and its slot reads truncated`, async () => {
      const root = tempRoot();
      const store = await openEvidenceStore({ root, now: () => T0 });
      const writer = store.connect(journey);
      const kind = c.declares === 'png' ? 'screenshot' : c.declares === 'jpeg' ? 'video-frame' : 'recording';
      const whole = await writer.put(slot(c.whole, c.declares, kind));
      expect(whole.slot, `the whole ${c.declares} fixture`).toEqual({ state: 'captured' });

      const result = await writer.put(slot(c.cut, c.declares, kind));
      // A store that checks only the hash and the size records this one as captured.
      expect(result.status).toBe('stored');
      expect(result.slot.state, `${c.name} read as ${result.slot.state}`).toBe('truncated');
      if (result.slot.state === 'truncated') expect(result.slot.missing).toMatch(c.missing);
      if (result.status !== 'stored') return;
      expect(result.evidence.intake).toBe('truncated');
      expect(result.evidence.missing).toMatch(c.missing);
      expect(result.evidence.sha256).toBe(sha256(c.cut));
      expect((await store.get(sha256(c.cut)))?.intake).toBe('truncated');
      expect(layoutFiles(root, sha256(c.cut))).toHaveLength(1);
    });
  }
});

describe('AC8 a file of another type than its slot declares is refused', () => {
  it('AC8 a JPEG sent to a slot that declares PNG is refused naming both types, and the slot reads missing with that reason', async () => {
    const root = tempRoot();
    const store = await openEvidenceStore({ root, now: () => T0 });
    const jpeg = jpegFixture();
    const result = await store.connect(journey).put(slot(jpeg, 'png'));
    expect(result.status).toBe('refused');
    if (result.status !== 'refused') return;
    expect(result.reason).toMatch(/png/i);
    expect(result.reason).toMatch(/jpe?g/i);
    expect(result.slot).toEqual({ state: 'missing', reason: result.reason });
    expect(await store.get(sha256(jpeg))).toBeUndefined();
    expect(layoutFiles(root, sha256(jpeg))).toEqual([]);
  });
});

describe('AC9 a truncated screenshot never becomes a baseline', () => {
  it('AC9 a decision that would take a truncated screenshot as its baseline is refused, naming its hash', async () => {
    const store = await openEvidenceStore({ root: tempRoot(), now: () => T0 });
    const writer = store.connect(journey);
    const whole = png(40, 40, 9);
    const half = whole.slice(0, whole.length - 1024); // a journey that died while writing its last screenshot
    await writer.put(slot(whole, 'png'));
    await writer.put(slot(half, 'png'));
    await expect(store.admitBaseline(sha256(whole))).resolves.toBeUndefined();
    const refusal = await store.admitBaseline(sha256(half)).then(() => undefined, (error: unknown) => error);
    expect(refusal, `truncated screenshot ${sha256(half)} was admitted as a baseline`).toMatchObject({ code: 'refused' });
    expect((refusal as Error).message).toContain(sha256(half));
  });
});
