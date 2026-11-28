import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  Agent, allowOnHub, askAddress, blocked, card, cleanup, copyRecord, decidedPage, DECIDED_RECORD, held, ID, inconclusive, MINUTE, NOW, PUSH, PUSH_TAG, quote, Replica,
  rowNodes, screensDir, SECOND, sha256, shows, STARTS_IN, stopHub, SUITE, undoControls, world, type World,
} from './helpers.ts';

interface Taste { verdict?: string | null; who?: string | null; when?: string | null; files?: Record<string, string>; note?: string }
const sorted = (files: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.entries(files).sort()));
const worlds: World[] = [];

afterAll(async () => {
  for (const w of worlds.splice(0)) await stopHub(w.hub).catch(() => undefined);
  await cleanup();
}, 5 * MINUTE);

describe(`#1807 AC6 ${ID.shown}`, () => {
  it(`${ID.shown} Shown to you: an answered row counting down beside the next ask's card, the last receipt on its page and the Decided page, light and dark, judged only by the recorded taste call`, async () => {
    const dir = screensDir();
    const w = await world();
    worlds.push(w);
    const a = await Agent.start(w);
    const first = await held(w, a, PUSH);
    const start = (await allowOnHub(w, first)).ts;
    const last = await copyRecord(w);
    const next = await held(w, a, PUSH_TAG);
    if (next.ts >= start + 9 * SECOND) inconclusive(`the second ask ${next.ask} was raised ${((next.ts - start) / 1000).toFixed(1)} s into the hold of ${first.ask}, too late to picture both`);
    const beside = await copyRecord(w);
    const failures: string[] = [];
    const files: Record<string, string> = {};
    for (const theme of ['light', 'dark'] as const) {
      let r = await Replica.on(beside.file, { theme });
      try {
        await r.at(Math.max(start + 4 * SECOND + 200, next.ts + 500));
        await r.open(askAddress(next));
        const seen = await r.see();
        const row = rowNodes(seen, first.ask);
        if (!shows(row, STARTS_IN) || seen.address !== askAddress(next)) failures.push(`${theme}: no answered row counting down beside the next ask's card to picture: ${first.ask}'s row reads ${quote(row)}, the page is ${String(seen.address)}`);
        else files[`answered-row-beside-next-${theme}.png`] = await r.screenshot(join(dir, `answered-row-beside-next-${theme}.png`));
      } finally {
        await r.stop();
      }
      r = await Replica.on(last.file, { theme });
      try {
        await r.at(start + 4 * SECOND + 200);
        await r.open(askAddress(first));
        const shown = card(await r.see());
        if (!shows(shown, STARTS_IN) || !undoControls(shown).length) failures.push(`${theme}: no last receipt with Undo on its page to picture: it reads ${quote(shown)}`);
        else files[`last-receipt-${theme}.png`] = await r.screenshot(join(dir, `last-receipt-${theme}.png`));
      } finally {
        await r.stop();
      }
      r = await Replica.on(DECIDED_RECORD, { theme });
      try {
        await r.at(NOW + SECOND);
        const opened = await decidedPage(r, 'menu');
        if (opened.failure) failures.push(`${theme}: no Decided page to picture: ${opened.failure}`);
        else files[`decided-${theme}.png`] = await r.screenshot(join(dir, `decided-${theme}.png`));
      } finally {
        await r.stop();
      }
    }
    expect(failures, `each state is right before its picture is taken: ${failures.join('\n')}`).toEqual([]);
    writeFileSync(join(dir, 'run.json'), `${JSON.stringify({ issue: 1807, files: Object.keys(files).sort() }, null, 2)}\n`);
    files['run.json'] = sha256(readFileSync(join(dir, 'run.json')));
    const taste = JSON.parse(readFileSync(join(SUITE, 'TASTE.json'), 'utf8')) as Taste;
    if (!taste.verdict) inconclusive(`no taste call is recorded in TASTE.json for the pictures in ${dir}`);
    if (sorted(taste.files ?? {}) !== sorted(files)) inconclusive(`TASTE.json's call is on other pictures than this run's: it names ${sorted(taste.files ?? {})}, this run wrote ${sorted(files)}`);
    if (taste.verdict !== 'looks_right' && taste.verdict !== 'looks_wrong') blocked(`TASTE.json's verdict is ${JSON.stringify(taste.verdict)}, not looks_right or looks_wrong`);
    expect(taste.verdict, `the recorded taste call says they look wrong: ${taste.note ?? ''}`).toBe('looks_right');
  }, 180 * MINUTE);
});
