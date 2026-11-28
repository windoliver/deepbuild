// #3428's `deep setup` against the stand-in paseo (README, The worlds): AC2 (a paseo newer than the facts gets no
// install, its config.json kept byte for byte, and a line naming its version and the versions covered), the covered
// side of that line, and AC3's setup half (a plugin paseo lists and refused at load isn't reported as set up).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC, OLD_RANGE, allEvents, changing, cleanup, covered, installs, linesOf, needCoveredRelease, newerThanFacts, newestCovered, redact, setup, shownCalls, source, world,
} from './world.ts';

afterEach(cleanup, 120_000);

/** What setup said of paseo, line by line, with the test's home written as ~. */
const ofPaseo = (w: Parameters<typeof redact>[0], lines: string[]): string => JSON.stringify(lines.filter((l) => /paseo/i.test(l)).map((l) => redact(w, l)));

describe(`${AC[2]} With a paseo newer than the facts on the PATH, deep setup runs no paseo plugin install, leaves paseo's config.json byte-equal, and its line names paseo's version and the versions covered`, () => {
  it(`${AC[2]} paseo one minor past the facts' newest: no paseo plugin install, config.json byte-equal, and a line naming both versions`, async () => {
    const running = newerThanFacts();
    const w = await world({ version: running, plugin: 'none', registry: 'serves', hub: true });
    const r = await setup(w);
    const lines = linesOf(r);
    const calls = w.calls();
    expect(installs(calls), `${AC[2]} paseo ${running} runs, newer than every version paseo's facts cover (${covered().join(', ')}): deep setup must run no paseo plugin install; it ran ${shownCalls(calls)}, and said of paseo ${ofPaseo(w, lines)}`).toEqual([]);
    expect(changing(calls), `${AC[2]} deep setup changes nothing of paseo ${running}'s: it ran ${shownCalls(calls)}`).toEqual([]);
    expect(readFileSync(w.configFile, 'utf8'), `${AC[2]} paseo's ${redact(w, w.configFile)} is byte for byte as it was before deep setup`).toBe(w.before.toString('utf8'));
    // "The versions covered": the newest and the oldest the facts cover, so a span or a list both read.
    const named = lines.find((l) => /paseo/i.test(l) && l.includes(running) && l.includes(newestCovered()) && l.includes(covered()[0]!));
    expect(named, `${AC[2]} one line of deep setup names paseo's version ${running} and the versions its facts cover (${covered().join(', ')}); setup said of paseo ${ofPaseo(w, lines)}`).toBeDefined();
  }, 600_000);

  it(`${AC[2]} ${AC[5]} the other side of the line: on the facts' newest paseo, with the source resolving, deep setup installs the plugin through paseo's own manager from the facts' source, once`, async () => {
    const w = await world({ version: newestCovered(), plugin: 'none', registry: 'serves', hub: true });
    const r = await setup(w);
    const calls = w.calls();
    const ran = installs(calls).map((c) => (c.words as string[])[2]);
    expect(ran, `${AC[2]} ${AC[5]} on paseo ${newestCovered()}, which the facts cover, deep setup runs paseo plugin install ${source().source} once; it ran ${shownCalls(calls)}, and said of paseo ${ofPaseo(w, linesOf(r))}`).toEqual([source().source]);
    const config = JSON.parse(readFileSync(w.configFile, 'utf8'));
    expect(Object.keys(config.plugins ?? {}), `${AC[2]} ${AC[5]} paseo holds the plugin as deepbuild once setup installed it: ${redact(w, JSON.stringify(config))}`).toContain('deepbuild');
    needCoveredRelease(`the install on paseo ${newestCovered()}`);
  }, 600_000);
});

describe(`${AC[3]} With the plugin listed in paseo and refused at load, deep setup doesn't report paseo as set up`, () => {
  it(`${AC[3]} paseo lists deepbuild, failed at load with paseo's own reason: deep setup reports no paseo set up, in its line or the record, and says paseo's reason`, async () => {
    const w = await world({ version: newestCovered(), plugin: 'old copy', registry: 'serves', hub: true });
    const state = `paseo ${newestCovered()} lists deepbuild with status failed: Plugin "deepbuild" requires Paseo ${OLD_RANGE}. Your daemon is ${newestCovered()}.`;
    const r = await setup(w);
    const lines = linesOf(r);
    // setup's one line (#1455): the agents whose settings now hold DeepBuild's part.
    const setUp = lines.filter((l) => /DeepBuild's hooks are in [^;]*paseo/.test(l));
    expect(setUp.map((l) => redact(w, l)), `${AC[3]} ${state} deep setup must not report paseo as set up; it said of paseo ${ofPaseo(w, lines)}`).toEqual([]);
    const steps = (await allEvents(w.hub!)).filter((e) => e.kind === 'setup.step' && e.data?.agent === 'paseo');
    expect(steps.map((e) => e.data), `${AC[3]} ${state} the record holds no setup step taken for paseo`).toEqual([]);
    // Scope: one that paseo lists and refused is said with paseo's own reason.
    const reason = lines.find((l) => l.includes(`requires Paseo ${OLD_RANGE}`));
    expect(reason, `${AC[3]} ${state} deep setup says paseo's own reason; it said of paseo ${ofPaseo(w, lines)}`).toBeDefined();
  }, 600_000);
});
