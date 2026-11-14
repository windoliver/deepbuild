// #1723.ee326673: "`logic.determinism` named in a build without `logic` reads BLOCKED with `module_missing`, never PASS."
//
// The canvas core the hub runs is a build without the logic module: its `registry` lists no `logic` (the default
// `full` set holds none; once one lands, build deep-show with `--features test-leave-out-logic`). The repo's spec
// names one check, scene-determinism: logic.determinism on doc DOC1. The session draws the scene with the crate resting
// on the floor, saves it (R1's drafted check passes) and stops.
//
// asserts: no verdict on the claim is PASS; its verdict is BLOCKED; and that verdict, or the record of scene-determinism's
// run on the claim, names module_missing.
import { afterEach, describe, it } from 'vitest';
import {
  AC3, CLEAN, DETERMINISM, DOC1, Session, TEST_MS, cleanup, drawAndStop, hubCanvasCore, judged, judgedBy, modulesOf, must, openTask, openWorld, outcomeOf,
  prerequisites, runsOfCheck, sayRuns, sayVerdicts,
} from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC3} logic.determinism named in a build without logic reads BLOCKED with module_missing, never PASS`, () => {
  it(`${AC3} the spec's ${DETERMINISM.name} names logic.determinism on the scene, in a hub whose canvas core has no logic module: the claim is BLOCKED naming module_missing, never PASS`, async () => {
    prerequisites(AC3);
    const core = hubCanvasCore()!;
    const modules = modulesOf(core);
    must(modules.length > 0 && !modules.includes('logic'), `BLOCKED: ${AC3} the hub's canvas core ${core} must be a build without the logic module (cargo build --locked -p deep-show --features test-leave-out-logic); its registry lists ${modules.join(', ')}`);
    const { hub, w } = await openWorld([DETERMINISM]);
    const s = new Session(w);
    const ref = await openTask(hub, s, AC3);
    const c = await drawAndStop(hub, s, ref, DOC1, CLEAN, AC3);
    const events = await judged(hub, c.claim, DETERMINISM.name);
    const verdicts = judgedBy(events, c.claim);
    must(verdicts.length > 0, `${AC3} ${c.claim} must be judged: no verdict was recorded; its runs: ${sayRuns(events, c.claim)}`);
    must(!verdicts.some((v) => outcomeOf(v) === 'PASS'), `${AC3} ${c.claim}: its spec names ${DETERMINISM.name}, logic.determinism, which this build's canvas core can't run, so the claim is never PASS: ${sayVerdicts(verdicts)}; its runs: ${sayRuns(events, c.claim)}`);
    const last = verdicts.at(-1)!;
    must(outcomeOf(last) === 'BLOCKED', `${AC3} ${c.claim}: ${DETERMINISM.name} needs the logic module, which the build lacks, so the claim is BLOCKED: ${sayVerdicts(verdicts)}`);
    const said = [JSON.stringify(last.data), ...runsOfCheck(events, c.claim, DETERMINISM.name).map((r) => JSON.stringify(r.finished?.data ?? {}))].join(' ');
    must(said.includes('module_missing'), `${AC3} ${c.claim}: the BLOCKED from ${DETERMINISM.name} names module_missing, in the verdict or the check's run: ${said.slice(0, 1500)}`);
  }, TEST_MS);
});
