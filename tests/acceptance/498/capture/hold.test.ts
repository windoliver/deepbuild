// Criterion 4, the hold: with DeepBuild holding the camera and microphone permissions, a panel's capture keeps no
// frame or sample until the trusted control is held, keeps none within one frame after release, and keeps nothing on a
// later request until the next hold; a planted capture that keeps its session open between holds keeps samples after
// release and fails, naming the first. With the Capture fields this test can see: `via: os_permission + trusted
// control`, `hold: shortcut`, `indicator: system + app`, `out: asset` (redaction `unknown`), "never record without
// the hold" and "never a standing grant". Through `deep-show run` on the virtual clock, the camera and microphone as
// scenario inputs (README: The surface under test). At the base `deep-show` has no device capture and answers every
// scenario here `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  DEVICES, Driver, FORMS, MS, PANEL, SEC, at, capturesOf, hid, holdProblems, indicatorOf, itemName, itemsIn, newFeeds,
  openedOf, request, storeFiles, synthetic, useFolders, useShow,
  type Capture, type Planted, type Source,
} from './helpers.ts';

const show = useShow();
const dirs = useFolders();

const T0 = 2 * SEC;
const DOWN1 = 7 * SEC;
/** Mid-period for both devices: the camera's frames fall at 5 ms + k·33.3 ms, the microphone's at 1 ms + k·10 ms. */
const UP1 = 9 * SEC + 10.5 * MS;
const LATER = UP1 + 2 * SEC;
const DOWN2 = UP1 + 6 * SEC;
const UP2 = DOWN2 + 1.5 * SEC + 3.25 * MS;
const SOURCES: Source[] = ['camera', 'microphone'];
const VIA = 'os_permission + trusted control';

describe('criterion 4: a panel\'s camera and microphone capture keeps only what a hold of the trusted control covers', () => {
  function run(planted?: Planted): string[] {
    const feeds = newFeeds();
    const dir = dirs();
    const d = new Driver(show(), { ...dir, feeds, ...(planted ? { planted } : {}) });
    const tag = planted ? ` (planted ${planted})` : '';
    const f: string[] = [];
    const byId = (caps: Capture[], id: string, what: string): Capture | undefined => {
      const c = caps.find((x) => x.capture === id);
      if (!c) f.push(`${what}: the capture ${id} is not listed`);
      return c;
    };

    // 1. The panel asks for the camera and the microphone; nothing is held, only eight synthetic presses of the chord
    //    in #339's four forms are posted. Nothing may be kept.
    const presses = Array.from({ length: 8 }, (_, i) => {
      const form = FORMS[i % 4]!;
      const t = 3 * SEC + i * 250 * MS;
      return [synthetic(t, 'down', form.state, form.pid), synthetic(t + 100 * MS, 'up', form.state, form.pid)];
    }).flat();
    const r1 = d.step([
      request(T0, 'camera'), request(T0, 'microphone'), ...presses,
      at('indicator', 3 * SEC + 50 * MS), at('indicator', 4 * SEC + 50 * MS), at('captures', 6 * SEC),
    ], `the panel's requests, then synthetic presses${tag}`);
    const first = { camera: openedOf(r1[0], 'the camera request'), microphone: openedOf(r1[1], 'the microphone request') };
    const looks = [r1[2 + presses.length], r1[3 + presses.length]].map((r, k) => indicatorOf(r, `the indicator during synthetic press ${k * 4 + 1}`));
    if (looks.some((i) => i.system || i.app)) f.push(`before the hold: the indicator showed during synthetic presses (${JSON.stringify(looks)})`);
    const before = capturesOf(r1[r1.length - 1], 'captures before any hold');
    for (const s of SOURCES) {
      const c = byId(before, first[s], `before the hold, the ${s} capture`);
      if (!c) continue;
      if (c.via !== VIA) f.push(`the ${s} capture's via is ${JSON.stringify(c.via)}, not ${JSON.stringify(VIA)}`);
      if (c.hold !== 'shortcut') f.push(`the ${s} capture's hold is ${JSON.stringify(c.hold)}, not "shortcut"`);
      if (c.panel !== PANEL) f.push(`the ${s} capture's panel is ${JSON.stringify(c.panel)}, not ${PANEL}`);
      if (c.state !== 'armed') f.push(`before the hold: the ${s} capture is ${c.state}, not armed and waiting for the hold`);
      if (c.frames !== 0 || c.first !== null) f.push(`before the hold: the ${s} capture keeps ${c.frames} ${itemName(s)}(s), the first at ${c.first}, with the shortcut never held`);
      if (c.asset !== null) f.push(`before the hold: the ${s} capture has an asset ${c.asset.sha256}`);
    }
    const early = storeFiles(dir.evidence);
    if (early.length > 0) f.push(`before the hold: ${early.length} file(s) in the evidence store, the first ${early[0]!.path}`);

    // 2. The chord held on the keyboard from 7 s to 9.0105 s, a synthetic up inside the hold (which ends nothing).
    const r2 = d.step([
      hid(DOWN1, 'down'), at('indicator', 8 * SEC), synthetic(8 * SEC + 200 * MS, 'up', 1, 0), hid(UP1, 'up'),
      at('indicator', UP1 + 500 * MS), at('captures', UP1 + 500 * MS),
    ], `the first hold${tag}`);
    const during = indicatorOf(r2[1], 'the indicator during the first hold');
    if (!during.system || !during.app) f.push(`the hold: the indicator during it is ${JSON.stringify(during)}, not both system and app`);
    const after = indicatorOf(r2[4], 'the indicator after the first release');
    if (after.system || after.app) f.push(`after the release: the indicator 500 ms after it is ${JSON.stringify(after)}, not off`);
    const held = capturesOf(r2[5], 'captures after the first hold');
    const firstAssets: string[] = [];
    for (const s of SOURCES) {
      const c = byId(held, first[s], `after the first hold, the ${s} capture`);
      if (!c) continue;
      if (c.asset === null) { f.push(`the hold: the ${s} capture is ${c.state} with no asset 500 ms after the release`); continue; }
      firstAssets.push(c.asset.sha256);
      if (c.asset.redaction !== 'unknown') f.push(`the hold: the ${s} asset is labelled redaction ${JSON.stringify(c.asset.redaction)}, not unknown`);
      if (c.asset.origin !== 'deepbuild') f.push(`the hold: the ${s} asset's origin is ${JSON.stringify(c.asset.origin)}, not deepbuild`);
      const file = storeFiles(dir.evidence).find((e) => e.sha === c.asset!.sha256);
      if (!file) { f.push(`the hold: the ${s} asset ${c.asset.sha256} is not in the evidence store`); continue; }
      const items = itemsIn(file.bytes, `the ${s} recording of the first hold`);
      if (c.frames !== items.length) f.push(`the hold: captures says the ${s} capture kept ${c.frames}, its asset holds ${items.length}`);
      if (items.length > 0 && (c.first !== items[0]!.t || c.last !== items[items.length - 1]!.t)) f.push(`the hold: the ${s} capture's first and last (${c.first}, ${c.last}) are not its asset's (${items[0]!.t}, ${items[items.length - 1]!.t})`);
      f.push(...holdProblems(items, DEVICES[s], feeds[s], DOWN1, UP1, `the first hold's ${s} asset`));
    }

    // 3. A later request from the same panel: it keeps nothing until the next hold. A granted permission and an
    //    earlier hold are no standing grant.
    const r3 = d.step([
      request(LATER, 'camera'), request(LATER, 'microphone'), at('indicator', UP1 + 5 * SEC), at('captures', UP1 + 5 * SEC),
    ], `the later request${tag}`);
    const later = { camera: openedOf(r3[0], 'the later camera request'), microphone: openedOf(r3[1], 'the later microphone request') };
    for (const s of SOURCES) if (later[s] === first[s]) f.push(`the later ${s} request reopened the released capture ${first[s]}, not a new one`);
    const idle = indicatorOf(r3[2], 'the indicator between the holds');
    if (idle.system || idle.app) f.push(`after the release: the indicator between the holds is ${JSON.stringify(idle)}, not off`);
    const between = capturesOf(r3[3], 'captures between the holds');
    for (const s of SOURCES) {
      const c = byId(between, later[s], `between the holds, the later ${s} capture`);
      if (!c) continue;
      if (c.frames !== 0 || c.first !== null) {
        const t = c.first ?? NaN;
        f.push(`after the release: the later ${s} request keeps ${c.frames} ${itemName(s)}(s) before the next hold, the first at ${t} (${((t - UP1) / MS).toFixed(2)} ms after the release at ${UP1})`);
      }
      if (c.state !== 'armed') f.push(`the later ${s} capture is ${c.state} before the next hold, not armed`);
      if (c.asset !== null) f.push(`after the release: the later ${s} capture has an asset before the next hold`);
    }
    const mid = storeFiles(dir.evidence).map((e) => e.sha).sort();
    if (JSON.stringify(mid) !== JSON.stringify([...firstAssets].sort())) f.push(`after the release: between the holds the evidence store holds ${mid.length} file(s), not just the first hold's ${firstAssets.length} asset(s)`);

    // 4. The next hold: only its own frames and samples.
    const r4 = d.step([hid(DOWN2, 'down'), hid(UP2, 'up'), at('captures', UP2 + 500 * MS)], `the second hold${tag}`);
    const second = capturesOf(r4[2], 'captures after the second hold');
    for (const s of SOURCES) {
      const c = byId(second, later[s], `after the second hold, the later ${s} capture`);
      if (!c) continue;
      if (c.asset === null) { f.push(`the second hold: the later ${s} capture is ${c.state} with no asset`); continue; }
      if (c.asset.redaction !== 'unknown') f.push(`the second hold: the ${s} asset is labelled redaction ${JSON.stringify(c.asset.redaction)}, not unknown`);
      const file = storeFiles(dir.evidence).find((e) => e.sha === c.asset!.sha256);
      if (!file) { f.push(`the second hold: the ${s} asset is not in the evidence store`); continue; }
      const items = itemsIn(file.bytes, `the ${s} recording of the second hold`);
      // Anything from before the second hold's down was kept after the first release.
      const carried = items.filter((it) => it.uuid === DEVICES[s].uuid && it.t < DOWN2);
      if (carried.length > 0) f.push(`after the release: the second hold's ${s} asset holds ${carried.length} ${itemName(s)}(s) from between the holds, the first at ${carried[0]!.t} (${((carried[0]!.t - UP1) / MS).toFixed(2)} ms after the first release at ${UP1})`);
      f.push(...holdProblems(items.filter((it) => it.t >= DOWN2), DEVICES[s], feeds[s], DOWN2, UP2, `the second hold's ${s} asset`));
    }
    const all = storeFiles(dir.evidence);
    if (all.length !== 4) f.push(`after both holds the evidence store holds ${all.length} file(s), not the four recordings`);
    return f;
  }

  it('criterion 4 the panel\'s camera and microphone requests keep nothing through synthetic presses; a 2 s hold keeps every frame and sample of it and none from one frame after the release; a later request keeps nothing until the next hold, which keeps only its own', () => {
    expect(run(), 'only a hold of the trusted control keeps frames and samples').toEqual([]);
  }, 900_000);

  it('criterion 4 a planted capture that keeps its session open between holds keeps samples after the release and fails, naming the first', () => {
    const twin = run('keeps_session_open');
    const named = twin.filter((m) => /^after the release: .*the first at \d+/.test(m));
    expect(named.length > 0, `the planted keeps_session_open fails, naming the first frame or sample kept after the release: ${JSON.stringify(twin.slice(0, 6))}`).toBe(true);
  }, 900_000);

  it('criterion 4 a planted gate that takes synthetic presses as the hold fails before the hold; a planted label of redaction complete fails naming the label', () => {
    const posted = run('records_without_hold');
    expect(posted.some((m) => m.startsWith('before the hold:')), `the planted records_without_hold fails before the hold: ${JSON.stringify(posted.slice(0, 6))}`).toBe(true);
    const labelled = run('labels_redaction_complete');
    expect(labelled.some((m) => /labelled redaction "complete"/.test(m)), `the planted labels_redaction_complete fails, naming the label: ${JSON.stringify(labelled.slice(0, 6))}`).toBe(true);
  }, 900_000);
});
