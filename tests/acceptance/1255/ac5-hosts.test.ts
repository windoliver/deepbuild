// Criterion 5, its hosts: "Forty movers over two hours: `conflicts` over the whole span runs in under 20 ms on the
// reference Mac, and its result is equal on macOS, Linux and in headless Chrome by state hash"
//
// Through `deep-logic first_party`, `about`, `bake`, `web_plan` and `web_runner`, the same checkout's `deep-logic` in a
// linux/amd64 container (#190's helpers: onLinux) and the web runner's `bake` in headless Chrome (inChrome), as #531
// and #190 run them (README: The surface). The forty movers (scenes.ts: FORTY) in a piece that checkpoints at every
// step: step 0 asks `conflicts` over the whole span, step 1 over the first 45 minutes, step 2 over the rest, so the
// state after each step holds a different result (9, 4 and 5 windows by the model) and the hashes compared are of
// states that change. "By state hash": every step's hash and every checkpoint's full-state hash, the one after step 0
// being the state that holds the whole span's result. This machine's bake is compared with Chrome's and then with
// Linux's; where this machine isn't macOS the criterion's macOS host hasn't run, and the test ends BLOCKED, never a
// pass. The timing is ac5-budget.test.ts.
import { describe, expect, it } from 'vitest';
import {
  ABOUT, TIMEOUT, WEB_RUNNER, arraysAt, bakeCall, bakeOf, blocked, cps, inChrome, logicBin, obj, onHost, onLinux, prebuild, show, str, webPlanCall, type Bake,
} from '../190/helpers.ts';
import { AC, INTERFACE, layout, piece, separation, windowsOf } from './helpers.ts';
import { conflicts, flyAll } from './model.ts';
import { script, scriptWrites } from './programs.ts';
import { FORTY } from './scenes.ts';

prebuild(() => { logicBin(); });

const STEPS = FORTY.sweep.length;
const stepHashes = (b: Bake): (string | null)[] => b.steps.map((s) => s.items['forty']?.hash ?? null);

describe(`${AC[5]} forty movers' conflicts, equal on every host by state hash`, () => {
  it(`${AC[5]} forty movers over two hours: the result of conflicts over the whole span is equal on macOS, Linux and in headless Chrome by state hash`, async () => {
    const flown = flyAll(FORTY.scene);
    const counts = FORTY.sweep.map((span) => conflicts(FORTY.scene, flown, ...span).length);
    expect(counts, 'by the model the three spans hold 9, 4 and 5 windows, so each step leaves another state').toEqual([9, 4, 5]);

    const S = separation();
    const writes = scriptWrites(FORTY.scene.movers.length);
    layout(writes);
    const program = script({ name: 'sweep', movers: FORTY.scene.movers.length, steps: FORTY.sweep.map((span) => [{ op: 'conflicts' as const, span }]) }, INTERFACE);
    const p = piece({ forty: { program, writes, scene: FORTY.scene, links: [S.ref], checkpoint: 1 } }, [], S.assets);
    const calls = [ABOUT, bakeCall(p, STEPS)];
    const here = onHost([...calls, WEB_RUNNER, webPlanCall(p, STEPS)]);

    // This machine: the model's counts at each step, a hash at every step, a checkpoint before and after each, no two alike.
    const mine = bakeOf(here[1]!, 'the forty movers\' bake on this machine');
    expect(mine.traps, `the forty movers run without a trap: ${show(mine.traps as never)}`).toEqual([]);
    expect(FORTY.sweep.map((_, k) => windowsOf(arraysAt(mine, 'forty', k)).length), 'each step holds its span\'s windows').toEqual(counts);
    const hashes = stepHashes(mine), states = cps(mine, 'forty');
    expect([hashes.every((h) => typeof h === 'string'), new Set(hashes).size], 'every step has a hash, each step another').toEqual([true, STEPS]);
    expect([states.map((c) => c.split(' ')[0]), new Set(states.map((c) => c.split(' ')[1])).size], 'a full-state hash before step 0 and after each step, each state another').toEqual([['0', '1', '2', '3'], STEPS + 1]);

    // Headless Chrome.
    expect(here[3]!['ok'], `web_plan gave the piece's request: ${show(here[3])}`).toBe(true);
    const chrome = await inChrome(str(here[2]!['source'], 'web_runner.source'), [here[3]!['request']!]);
    expect(chrome.userAgent, 'the page ran in headless Chrome').toMatch(/HeadlessChrome|Chrome/);
    const web = bakeOf(obj(chrome.replies[0], 'the forty movers in Chrome'), 'the forty movers\' bake in headless Chrome', true);
    expect(stepHashes(web), 'headless Chrome: the same step hash at every step').toEqual(hashes);
    expect(cps(web, 'forty'), 'headless Chrome: the same full-state hash at every checkpoint').toEqual(states);

    // Linux, in a linux/amd64 container (BLOCKED without Docker, the image or emulation).
    const there = onLinux(calls);
    expect(there[0]!['os'], 'the container\'s deep-logic runs on Linux').toBe('linux');
    const linux = bakeOf(there[1]!, 'the forty movers\' bake on Linux');
    expect(stepHashes(linux), 'Linux: the same step hash at every step').toEqual(hashes);
    expect(cps(linux, 'forty'), 'Linux: the same full-state hash at every checkpoint').toEqual(states);

    // macOS: this machine, where it is one. Elsewhere that host hasn't run.
    if (here[0]!['os'] !== 'macos') blocked(`the criterion's macOS host hasn't run: this machine is ${String(here[0]!['os'])}/${String(here[0]!['arch'])}; its hashes equal Chrome's and Linux's, and the macOS run is this file on a Mac`);
  }, TIMEOUT);
});
