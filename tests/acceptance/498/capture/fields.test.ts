// The Capture fields criterion 4 leans on, for the camera and microphone: `max: s = 120` (a hold keeps at most
// 120 s, the indicator off and the asset saved there while the chord is still held) and `via: os_permission +
// trusted control` (with the OS's permission denied, a panel's request is refused and a hold keeps nothing). Through
// `deep-show run` on the virtual clock (README: The surface under test). At the base `deep-show` has no device
// capture and answers every scenario here `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  DEVICES, Driver, MS, SEC, at, capturesOf, hid, holdProblems, indicatorOf, itemName, itemsIn, newFeeds, obj, openedOf,
  periodOf, request, storeFiles, useFolders, useShow, type Planted, type Source,
} from './helpers.ts';

const show = useShow();
const dirs = useFolders();
const SOURCES: Source[] = ['camera', 'microphone'];

describe('max: s = 120 for the camera and microphone', () => {
  const DOWN = 3 * SEC;
  const MAX = 120 * SEC;

  function run(planted?: Planted): string[] {
    const feeds = newFeeds();
    const dir = dirs();
    const d = new Driver(show(), { ...dir, feeds, ...(planted ? { planted } : {}) });
    const r = d.step([
      request(2 * SEC, 'camera'), request(2 * SEC, 'microphone'), hid(DOWN, 'down'),
      at('indicator', DOWN + MAX - 500 * MS), at('indicator', DOWN + MAX + 500 * MS), at('captures', DOWN + MAX + SEC),
      hid(DOWN + 125 * SEC, 'up'), at('captures', DOWN + 126 * SEC),
    ], `a 125 s hold${planted ? ` (planted ${planted})` : ''}`);
    const f: string[] = [];
    const ids = { camera: openedOf(r[0], 'the camera request'), microphone: openedOf(r[1], 'the microphone request') };
    const on = indicatorOf(r[3], 'the indicator 119.5 s into the hold');
    if (!on.system || !on.app) f.push(`the indicator 119.5 s into the hold is ${JSON.stringify(on)}, not both system and app`);
    const off = indicatorOf(r[4], 'the indicator 120.5 s into the hold');
    if (off.system || off.app) f.push(`the indicator 120.5 s into the hold, still held, is ${JSON.stringify(off)}: recording past 120 s`);
    const at121 = capturesOf(r[5], 'captures 121 s into the hold');
    const end = capturesOf(r[7], 'captures after the release');
    for (const s of SOURCES) {
      const c121 = at121.find((c) => c.capture === ids[s]);
      if (!c121?.asset) f.push(`121 s into the hold the ${s} capture is ${c121?.state ?? 'missing'} with no asset: not saved at 120 s`);
      const c = end.find((x) => x.capture === ids[s]);
      if (!c?.asset) { f.push(`after the release the ${s} capture has no asset`); continue; }
      const file = storeFiles(dir.evidence).find((e) => e.sha === c.asset!.sha256);
      if (!file) { f.push(`the ${s} asset is not in the evidence store`); continue; }
      const items = itemsIn(file.bytes, `the ${s} recording`);
      const dev = DEVICES[s];
      const late = items.filter((it) => it.t >= DOWN + MAX + periodOf(dev));
      if (late.length > 0) f.push(`${late.length} ${s} ${itemName(s)}(s) past 120 s into the hold, the first ${((late[0]!.t - DOWN) / SEC).toFixed(3)} s in`);
      const last = items[items.length - 1];
      if (!last || last.t < DOWN + MAX - periodOf(dev)) f.push(`the last ${s} ${itemName(s)} is ${last ? ((last.t - DOWN) / SEC).toFixed(3) : 'none'} s into the hold, not within one ${itemName(s)} of 120 s`);
      f.push(...holdProblems(items.filter((it) => it.t < DOWN + MAX + periodOf(dev)), dev, feeds[s], DOWN, DOWN + MAX, `the ${s} asset`));
    }
    const files = storeFiles(dir.evidence);
    if (files.length !== 2) f.push(`the evidence store holds ${files.length} files, not the two recordings`);
    return f;
  }

  it('max a 125 s hold keeps the camera\'s and the microphone\'s first 120 s and nothing after, turning the indicator off and saving both assets at 120 s while the chord is still held', () => {
    expect(run(), 'a hold keeps at most 120 s').toEqual([]);
    const twin = run('records_past_max');
    expect(twin.some((m) => /past 120 s/.test(m)), `the planted records_past_max fails, naming what it kept past 120 s: ${JSON.stringify(twin.slice(0, 4))}`).toBe(true);
  }, 900_000);
});

describe('via: os_permission + trusted control', () => {
  function run(planted?: Planted): string[] {
    const feeds = newFeeds();
    const dir = dirs();
    const d = new Driver(show(), { ...dir, feeds, permissions: { camera: 'denied', microphone: 'denied' }, ...(planted ? { planted } : {}) });
    const r = d.step([
      request(2 * SEC, 'camera'), request(2 * SEC, 'microphone'), hid(3 * SEC, 'down'), at('indicator', 4 * SEC),
      hid(5 * SEC, 'up'), at('captures', 6 * SEC),
    ], `requests with the OS permissions denied, then a hold${planted ? ` (planted ${planted})` : ''}`);
    const f: string[] = [];
    SOURCES.forEach((s, i) => {
      const reply = obj(r[i], `the reply to the ${s} request`);
      if (typeof reply['code'] !== 'string' || reply['code'] === '') f.push(`without the OS permission the ${s} request was not refused (${JSON.stringify(reply).slice(0, 300)})`);
      if ('capture' in reply) f.push(`without the OS permission the ${s} request opened a capture ${JSON.stringify(reply['capture'])}`);
    });
    const lit = indicatorOf(r[3], 'the indicator during the hold');
    if (lit.system || lit.app) f.push(`without the OS permission a hold lit the indicator (${JSON.stringify(lit)})`);
    const listed = capturesOf(r[5], 'captures after the hold');
    const kept = listed.filter((c) => c.frames > 0 || c.asset !== null);
    if (kept.length > 0) f.push(`without the OS permission ${kept.length} device capture(s) kept something, the first ${kept[0]!.source} with ${kept[0]!.frames}`);
    const files = storeFiles(dir.evidence);
    if (files.length > 0) f.push(`without the OS permission a hold left ${files.length} file(s) in the evidence store`);
    return f;
  }

  it('via with the camera and microphone permissions denied, the panel\'s requests are refused and a hold keeps nothing', () => {
    expect(run(), 'the camera and microphone only through the OS permission').toEqual([]);
    const twin = run('records_without_permission');
    expect(twin.some((m) => m.startsWith('without the OS permission')), `the planted records_without_permission fails: ${JSON.stringify(twin.slice(0, 4))}`).toBe(true);
  }, 900_000);
});
