// AC7 (#1101.cf35fa4c): Shown to you: screenshots of the held push card with its countdown and Undo, and the receipt
// after it ran, taken by the check run from the app at the reference window, with a recording of the countdown, are
// attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it
// the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// The check run takes the pictures from the app's views at the reference window, drawn by the replica over copies of a
// real hub's record (README): the held push's page 200 ms into its hold, a recording of its countdown to 10 s, and its
// page a second after it ran. Each state is read off the text snapshot before its picture is taken. The pictures and
// run.json go to $DA1101_SCREENS. "Attached to the PR and shown to you in the session" no test can see: the implementing
// agent does it. Whether they look right is one taste call in TASTE.json; without one on exactly these files the run is
// INCONCLUSIVE, never PASS.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  Agent, allowOnCard, attempt, awaitRecord, blocked, CANT_UNDO, cleanup, clock, copyRecord, held, HOLD_MS, ID, inconclusive, MINUTE, PUSH, quoted, ranTries,
  Replica, screensDir, SECOND, settleTries, sha256, shows, STARTS_IN, stepTo, stopHub, SUITE, undoControls, world, type World,
} from './helpers.ts';

interface Taste { verdict?: string | null; who?: string | null; when?: string | null; files?: Record<string, string>; note?: string }
const sorted = (files: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.entries(files).sort()));
const worlds: World[] = [];

afterAll(async () => {
  for (const w of worlds.splice(0)) await stopHub(w.hub).catch(() => undefined);
  await cleanup();
}, 5 * MINUTE);

describe(`#1101 AC7 ${ID.shown}`, () => {
  it(`${ID.shown} Shown to you: the held push card with its countdown and Undo, its recording, and the receipt after it ran, judged only by the recorded taste call`, async () => {
    const dir = screensDir();
    const w = await world();
    worlds.push(w);
    const a = await Agent.start(w);
    const h = await held(w, a, PUSH);
    const start = (await allowOnCard(w, h)).ts;
    await attempt(w, a, PUSH);
    const during = await copyRecord(w);
    const failures: string[] = [];
    if (ranTries(w, PUSH).some((t) => t.at < start + HOLD_MS)) failures.push(`the push of ${h.ask} ran before 10 s, so there is no held card to picture`);
    await stepTo(w, start + HOLD_MS);
    await settleTries(w, 30 * SECOND);
    if (!ranTries(w, PUSH).length) await attempt(w, a, PUSH, 60 * SECOND);
    const ran = ranTries(w, PUSH)[0];
    if (!ran) failures.push(`the push of ${h.ask} never ran, so there is no receipt after it ran to picture`);
    else await awaitRecord(w, (all) => all.find((e) => e.kind === 'tool.after' && e.data.call === ran.call), `the PostToolUse of ${PUSH.command}`);
    const after = ran ? { fixture: await copyRecord(w), at: (await clock(w)) + SECOND } : undefined;
    expect(failures, `each state is right before its picture is taken: ${failures.join('\n')}`).toEqual([]);

    const files: Record<string, string> = {};
    let r = await Replica.on(during);
    try {
      await r.at(start + 200);
      const p = await r.page(h.ask);
      if (!shows(p, STARTS_IN(10)) || !undoControls(p).length) failures.push(`the held push's page shows no "${STARTS_IN(10)}" with Undo to picture: it reads ${quoted(p)}`);
      else {
        files['held-push-card.png'] = await r.screenshot(join(dir, 'held-push-card.png'));
        await r.must('the recording\'s start', { call: 'record', record: { action: 'start', fps: 2, marks: 'per_action', mask: [], mask_kind: 'fill' } });
        await r.at(start + HOLD_MS, 500);
        const video = await r.must('the recording\'s stop', { call: 'record', record: { action: 'stop' } });
        copyFileSync(String(video.path), join(dir, 'countdown.png'));
        files['countdown.png'] = sha256(readFileSync(join(dir, 'countdown.png')));
      }
    } finally {
      await r.stop();
    }
    r = await Replica.on(after!.fixture);
    try {
      await r.at(after!.at);
      const p = await r.page(h.ask);
      if (!shows(p, CANT_UNDO) || undoControls(p).length) failures.push(`the receipt after the push ran doesn't say it can't be undone with no Undo, to picture: it reads ${quoted(p)}`);
      else files['receipt-after-ran.png'] = await r.screenshot(join(dir, 'receipt-after-ran.png'));
    } finally {
      await r.stop();
    }
    expect(failures, 'each state is right before its picture is taken').toEqual([]);
    writeFileSync(join(dir, 'run.json'), `${JSON.stringify({ issue: 1101, files: Object.keys(files) }, null, 2)}\n`);
    files['run.json'] = sha256(readFileSync(join(dir, 'run.json')));
    const taste = JSON.parse(readFileSync(join(SUITE, 'TASTE.json'), 'utf8')) as Taste;
    if (!taste.verdict) inconclusive(`no taste call is recorded in TASTE.json for the pictures in ${dir}`);
    if (sorted(taste.files ?? {}) !== sorted(files)) inconclusive(`TASTE.json's call is on other pictures than this run's: it names ${sorted(taste.files ?? {})}, this run wrote ${sorted(files)}`);
    if (taste.verdict !== 'looks_right' && taste.verdict !== 'looks_wrong') blocked(`TASTE.json's verdict is ${JSON.stringify(taste.verdict)}, not looks_right or looks_wrong`);
    expect(taste.verdict, `the recorded taste call says they look wrong: ${taste.note ?? ''}`).toBe('looks_right');
  }, 180 * MINUTE);
});
