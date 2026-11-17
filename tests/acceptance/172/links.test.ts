// AC5 #172.01200175: "A piece with stages, opened as `index.html#stage=<the fourth stage's ID>`, shows that stage's settled
// frame by hash once ready, and opened with `#t=12.5` it shows the frame the player shows when it plays to 12.5 s.
// `#t=abc`, `#stage=nowhere` and `#control.year=741` each open at the start with a notice naming the fragment, and the
// input track gains no entry. A planted player that writes a fragment as an input entry fails, naming the entry"
//
// The piece is helpers.ts `stagesDoc`: four stage markers, `descent` the fourth at 12 s, a dot whose x walks with time
// and whose y a driver takes from the slider `year` (default 2000). "By hash" is by the player's own record, never by
// pixels: probe()'s step, step hashes and evaluated data (README: probe()).
//
// asserts:
//   - `#stage=descent`, once ready: `stage` is `descent`, `currentTime` 12, and probe() reads what a host's
//     `stage = 'descent'` on a plainly opened page reads once it settles, its evaluated data the app's `eval` at 12 s;
//   - `#t=12.5`, once ready: `currentTime` 12.5, and probe() reads what a host's `currentTime = 12.5` reads, its
//     evaluated data the app's at 12.5 s;
//   - `#t=abc`, `#stage=nowhere`, `#control.year=741`: each ready at time 0 on stage `opening`, a notice
//     (`[data-deep-notice]`) holding the fragment as written, the evaluated data a plain page's at its start, and
//     `controls/year/value` still 2000: no input entry was written;
//   - the planted player `web_fragment_writes_entry` opened at `#control.year=741` fails that judgement, naming the
//     entry (`year = 741`).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, STAGES, STAGE_AT, STAGE_PATHS, TIMEOUT, YEAR_DEFAULT, appValues, bundleFailures, done, exportOnce, failsNaming, none, play, show, stagesDoc,
  useBrowsers, useShow, useTemp, webReceiptOf, type Probe, type Tab,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const browsers = useBrowsers();
const FOURTH = STAGES[3];
const BAD = ['t=abc', 'stage=nowhere', 'control.year=741'] as const;
const PLANTED = 'web_fragment_writes_entry';
/** The dot's paths, which the app's `eval` reads. */
const DOT = STAGE_PATHS.slice(0, 2);

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** Waits up to 10 s for the player's clock and stage to read `t` and `stage`; what they read last. */
async function settle(tab: Tab, t: number, stage: string | null): Promise<{ t: number; stage: string }> {
  const until = Date.now() + 10_000;
  let now = { t: NaN, stage: '' };
  while (Date.now() < until) {
    now = await tab.evaluate<{ t: number; stage: string }>(`(() => { const p = document.querySelector('deep-player'); return { t: p.currentTime, stage: String(p.stage) }; })()`);
    if (now.t === t && (stage === null || now.stage === stage)) break;
    await new Promise((d) => setTimeout(d, 100));
  }
  return now;
}
/** The probe's evaluated data at the piece's stable paths against `want` (the app's `eval` reads the dot's paths; the
 * slider's value it reads as null at the base, so against the app only the dot is compared); each failure names the path. */
function valueFailures(where: string, p: Probe, want: Record<string, unknown>, paths: readonly string[] = STAGE_PATHS): string[] {
  return paths.filter((k) => !same(p.values[k], want[k])).map((k) => `${where}: ${k} is ${show((p.values[k] ?? null) as never, 200)}, want ${show((want[k] ?? null) as never, 200)}`);
}
/** A page opened at a fragment the player can't read: ready, at the start, a notice naming it, no entry written. */
async function badFragmentFailures(folder: string, fragment: string, start: Probe): Promise<string[]> {
  const page = browsers(await play(folder, { fragment: `#${fragment}` }));
  const f: string[] = [];
  const s = await page.tab.ready(60_000);
  if (!s.ready) { await done(page); return [`#${fragment}: the player is not ready within 60 s; notices ${JSON.stringify(s.notices)}`]; }
  await new Promise((d) => setTimeout(d, 1_000));
  const now = await settle(page.tab, 0, STAGES[0]);
  if (now.t !== 0) f.push(`#${fragment} opens at ${now.t} s, not at the start`);
  if (now.stage !== STAGES[0]) f.push(`#${fragment} opens on the stage ${now.stage}, not ${STAGES[0]}`);
  const notices = (await page.tab.ready(1_000)).notices;
  if (!notices.some((n) => n.includes(fragment))) f.push(`#${fragment}: no notice names the fragment; the notices: ${JSON.stringify(notices)}`);
  const p = await page.tab.probe(`#${fragment}`);
  const year = p.values['controls/year/value'];
  if (year !== YEAR_DEFAULT) f.push(`#${fragment} wrote an input entry: year = ${show((year ?? null) as never)}`);
  f.push(...valueFailures(`#${fragment} against the plain start`, p, start.values));
  if (p.step !== start.step) f.push(`#${fragment} is at step ${p.step}, the plain start at ${start.step}`);
  await done(page);
  return f;
}
function exportStages(planted?: string): string {
  const out = join(temp(), 'bundle');
  const reply = exportOnce(shows(FULL), temp(), stagesDoc(), out, `the piece with stages${planted ? ` (planted ${planted})` : ''}`, planted ? { planted } : {});
  const receipt = webReceiptOf(reply, 'the piece with stages');
  none(bundleFailures(out, receipt, 'the piece\'s bundle'), 'the bundle holds every file its receipt names, each by its hash');
  return out;
}

describe(`${AC[5]} a link opens at a stage or a time, and a fragment it can't read opens at the start, naming it, writing nothing`, () => {
  it(`${AC[5]} #stage=${FOURTH} shows the fourth stage settled, and #t=12.5 the frame at 12.5 s, as a host's seek and the app show them`, async () => {
    const out = exportStages();
    const [atStage, atTime] = appValues(shows(FULL), temp(), stagesDoc(), [STAGE_AT[FOURTH], 12.5], DOT, 'the piece with stages');
    const failures: string[] = [];

    const plain = browsers(await play(out));
    await plain.tab.mustBeReady('the piece, opened plainly');
    await plain.tab.evaluate(`void (document.querySelector('deep-player').stage = ${JSON.stringify(FOURTH)})`);
    const hostStage = await settle(plain.tab, STAGE_AT[FOURTH], FOURTH);
    if (hostStage.stage !== FOURTH || hostStage.t !== STAGE_AT[FOURTH]) failures.push(`a host's stage = ${FOURTH} reads stage ${hostStage.stage} at ${hostStage.t} s`);
    const byHostStage = await plain.tab.probe('a host\'s stage');
    await plain.tab.evaluate(`void (document.querySelector('deep-player').currentTime = 12.5)`);
    await settle(plain.tab, 12.5, null);
    const byHostTime = await plain.tab.probe('a host\'s currentTime');
    await done(plain);

    const linkStage = browsers(await play(out, { fragment: `#stage=${FOURTH}` }));
    await linkStage.tab.mustBeReady(`#stage=${FOURTH}`);
    const s = await settle(linkStage.tab, STAGE_AT[FOURTH], FOURTH);
    if (s.stage !== FOURTH || s.t !== STAGE_AT[FOURTH]) failures.push(`#stage=${FOURTH} reads stage ${s.stage} at ${s.t} s once ready`);
    const p = await linkStage.tab.probe(`#stage=${FOURTH}`);
    if (p.step !== byHostStage.step || !same(p.step_hash, byHostStage.step_hash)) failures.push(`#stage=${FOURTH} is at step ${p.step} ${show(p.step_hash as never)}, a host's stage at ${byHostStage.step} ${show(byHostStage.step_hash as never)}`);
    failures.push(...valueFailures(`#stage=${FOURTH} against a host's stage`, p, byHostStage.values), ...valueFailures(`#stage=${FOURTH} against the app at ${STAGE_AT[FOURTH]} s`, p, atStage!, DOT));
    await done(linkStage);

    const linkTime = browsers(await play(out, { fragment: '#t=12.5' }));
    await linkTime.tab.mustBeReady('#t=12.5');
    const t = await settle(linkTime.tab, 12.5, null);
    if (t.t !== 12.5) failures.push(`#t=12.5 reads currentTime ${t.t} once ready`);
    const q = await linkTime.tab.probe('#t=12.5');
    if (q.step !== byHostTime.step || !same(q.step_hash, byHostTime.step_hash)) failures.push(`#t=12.5 is at step ${q.step}, a host's currentTime = 12.5 at ${byHostTime.step}`);
    failures.push(...valueFailures('#t=12.5 against a host\'s currentTime', q, byHostTime.values), ...valueFailures('#t=12.5 against the app at 12.5 s', q, atTime!, DOT));
    await done(linkTime);
    none(failures, 'the stage and time links open where a host\'s seek and the app put the piece');
  }, TIMEOUT);

  it(`${AC[5]} #t=abc, #stage=nowhere and #control.year=741 each open at the start with a notice naming the fragment, and no input entry`, async () => {
    const out = exportStages();
    const plain = browsers(await play(out));
    await plain.tab.mustBeReady('the piece, opened plainly');
    const start = await plain.tab.probe('the plain start');
    expect(start.values['controls/year/value'], 'the plain start reads the slider year at its default').toBe(YEAR_DEFAULT);
    await done(plain);
    const failures: string[] = [];
    for (const fragment of BAD) failures.push(...await badFragmentFailures(out, fragment, start));
    none(failures, 'each unreadable fragment opens at the start, names itself, and writes no entry');
  }, TIMEOUT);

  it(`${AC[5]} the planted player ${PLANTED}, opened at #control.year=741, fails, naming the entry`, async () => {
    const out = exportStages();
    const planted = exportStages(PLANTED);
    const plain = browsers(await play(out));
    await plain.tab.mustBeReady('the piece, opened plainly');
    const start = await plain.tab.probe('the plain start');
    await done(plain);
    failsNaming(await badFragmentFailures(planted, 'control.year=741', start), 'year = 741', `the planted player ${PLANTED}`);
  }, TIMEOUT);
});
