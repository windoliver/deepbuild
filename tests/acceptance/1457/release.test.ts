// AC2 #1457: the release build has no DEEP_HUB_PLANT string and no plant path; a planted environment read fails the
// lint, naming the file. Plants are Cargo features: DEEP_HUB_PLANT, the card's Faults, DEEP_APP_NOTIFICATION_SETTING.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILD_MS, releaseBuild } from '../1408/helpers.ts';
import { copyApp, envLints, lint, plantIn, twin } from './helpers.ts';

/** What a release app must not carry: the plant switches' names, and the plants those switches select. */
const STRINGS = ['DEEP_HUB_PLANT', 'DEEP_APP_NOTIFICATION_SETTING', 'waiting-as-working'];
const held = (bytes: Buffer): string[] => STRINGS.filter((s) => bytes.includes(Buffer.from(s)));

describe('#1457 AC2 the release app holds no plant', () => {
  it('the release deep-app binary holds none of DEEP_HUB_PLANT, DEEP_APP_NOTIFICATION_SETTING or a plant name', async () => {
    const bin = join(await releaseBuild('deep-app'), 'deep-app');
    expect(held(readFileSync(bin)), `byte search of ${bin}`).toEqual([]);
  }, BUILD_MS);

  it('wrong program: the byte search finds each string in a file that holds it', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'da1457-bin-')), 'planted');
    writeFileSync(file, Buffer.concat(STRINGS.map((s) => Buffer.from(`\0${s}\0`))));
    expect(held(readFileSync(file))).toEqual(STRINGS);
  });
});

describe('#1457 AC2 a planted environment read fails the lint, naming the file', () => {
  it('the app as it stands passes every --root lint of the lint lane', async () => {
    const lints = await envLints();
    expect(lints.length, 'the lint lane has a --root lint of the app\'s source that reads environment variables').toBeGreaterThan(0);
    const root = copyApp();
    for (const script of lints) expect(lint(script, root).code, script).toBe(0);
  });

  it('a plain read of DEEP_HUB_PLANT in views.rs fails a lint, which names crates/deep-app/src/views.rs; the same read under a cargo feature passes', async () => {
    const lints = await envLints();
    const bad = copyApp();
    plantIn(bad, 'views.rs', /^\s*fn render\b/, twin('env-read.rs.txt'));
    const ran = lints.map((s) => lint(s, bad));
    expect(ran.some((r) => r.code === 1 && /^FAIL .*crates\/deep-app\/src\/views\.rs:\d+/m.test(r.out)), ran.map((r) => r.out).join('\n').slice(0, 600)).toBe(true);
    const gated = copyApp();
    plantIn(gated, 'views.rs', /^\s*fn render\b/, twin('env-read-gated.rs.txt'));
    for (const script of lints) expect(lint(script, gated).code, `${script} must let a feature-gated read through`).toBe(0);
  });
});
