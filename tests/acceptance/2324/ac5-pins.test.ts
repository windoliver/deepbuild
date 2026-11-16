// #2324 AC5: The metering table and sandbox@1's pins name the new version, the fuel a fixture program is charged per
// step is unchanged, and `scripts/repo-rules.mjs` passes with the three rows moved.
//
// "The new version" is the one Cargo.lock holds (AC1 judges it). The pins are read where they are served: deep-sandbox's
// and deep-logic's `about`, deep-show `full`'s seal, and the committed schedule. The fuel per step is each #531 fixture's
// in the merge base's bake (fixtures/base-bake.json). repo-rules.mjs already fails on main for lines that aren't this
// issue's (BASE-FAILURE.txt), so its run passes here when no line it doesn't pass names the engine or the three
// manifests. The issue's scope also keeps sandbox.alt on another patch that holds the fixes: deep-show
// `full,test-sandbox-alt` pins an exact release other than Cargo.lock's, outside every one of the 17 advisories.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import {
  AC, ADVISORIES, BASE_BAKE, L, OLD, REPO, S, TIMEOUT, bakeRecords, deepShow, fixtureBake, inside, isExact, lockedVersion, none, type JsonObject,
} from './helpers.ts';

const MANIFESTS = ['crates/deep-sandbox-wasmtime/Cargo.toml', 'crates/deep-logic/Cargo.toml', 'spikes/245/Cargo.toml'];
S.prebuild(() => { S.macSandbox(); L.logicBin(); deepShow(['full']); deepShow(['full', 'test-sandbox-alt']); });
const temp = S.useTemp();

/** sandbox@1's wasmtime pin in a `schedule` reply (or the committed snapshot). */
const pinOf = (schedule: JsonObject, what: string): string =>
  S.str(S.obj(S.obj(S.obj(S.obj(S.obj(schedule['interfaces'], `${what}: interfaces`)['sandbox@1'], `${what}: sandbox@1`)['implementation'], `${what}: implementation`)['pins'], `${what}: pins`)['wasmtime'], `${what}: pins.wasmtime`)['version'], `${what}: pins.wasmtime.version`);

describe(`${AC[5]} the metering table and sandbox@1's pins name the new engine, its fuel per step is the old one's, and repo-rules passes`, () => {
  it(`${AC[5]} the metering table, sandbox@1's pins and the three repo-rules rows name the engine Cargo.lock holds, each #531 fixture is charged the fuel per step it was on the old engine, and repo-rules passes`, () => {
    const v = lockedVersion();
    const failures: string[] = [];
    if (v === OLD) failures.push(`Cargo.lock still holds wasmtime ${OLD}, so the table, the pins and the rows below are read against the old engine`);
    const want = (what: string, got: unknown, expected: string): void => { if (got !== expected) failures.push(`${what} is ${JSON.stringify(got)}, not ${expected}`); };

    const metering = JSON.parse(readFileSync(join(REPO, 'crates', 'deep-logic', 'metering.json'), 'utf8')) as { engines?: { app?: string } };
    want('the metering table\'s engine (crates/deep-logic/metering.json engines.app)', metering.engines?.app, `wasmtime ${v}`);
    const [sandbox] = S.onMac([S.about]);
    want('deep-sandbox\'s engine', S.obj(sandbox!['engine'], 'deep-sandbox about: engine')['version'], v);
    const sandboxPins = S.obj(S.obj(sandbox!['implementation'], 'deep-sandbox about: implementation')['pins'], 'deep-sandbox about: pins');
    want('sandbox@1\'s pin in deep-sandbox', S.obj(sandboxPins['wasmtime'], 'deep-sandbox about: pins.wasmtime')['version'], `=${v}`);
    const [logic] = L.onMac([L.ABOUT]);
    want('deep-logic\'s engine', S.obj(logic!['engine'], 'deep-logic about: engine')['version'], v);
    const [schedule] = S.runShow(deepShow(['full']), S.scenario(temp(), [S.SCHEDULE]));
    want('sandbox@1\'s pin in the seal of deep-show full', pinOf(schedule!, 'deep-show full: schedule'), `=${v}`);
    const snapshot = JSON.parse(readFileSync(join(REPO, 'crates', 'deep-show', 'schedule', 'full.json'), 'utf8')) as JsonObject;
    want('sandbox@1\'s pin in crates/deep-show/schedule/full.json', pinOf(snapshot, 'schedule/full.json'), `=${v}`);

    // The scope's sandbox.alt: another exact release, outside every advisory against 49.0.2.
    const [altSchedule] = S.runShow(deepShow(['full', 'test-sandbox-alt']), S.scenario(temp(), [S.SCHEDULE]));
    const alt = pinOf(altSchedule!, 'deep-show full,test-sandbox-alt: schedule').replace(/^=/, '');
    if (!isExact(alt) || !ADVISORIES.releases.includes(alt)) failures.push(`sandbox.alt pins =${alt}, not an exact, published release of the engine`);
    else if (alt === v) failures.push(`sandbox.alt pins =${alt}, the shipped implementation's own version`);
    else for (const a of inside(alt)) failures.push(`sandbox.alt pins =${alt}, still inside ${a.id} (first fixed in ${a.first_fixed_49})`);

    const [bake] = L.onMac([fixtureBake()]);
    const here = bakeRecords(bake!, 'the bake on macOS arm64');
    for (const [id, r] of Object.entries(BASE_BAKE().items)) {
      const k = r.steps.findIndex((s, i) => s[1] !== here[id]?.steps[i]?.[1]);
      if (k >= 0) failures.push(`${id} is charged ${here[id]?.steps[k]?.[1] ?? '(nothing)'} fuel at step ${k}, ${r.steps[k]![1]} on the old engine`);
    }

    const rules = JSON.parse(readFileSync(join(REPO, 'scripts', 'repo-rules.json'), 'utf8')) as { deps: Record<string, { dependencies?: Record<string, { spec?: string }> }> };
    for (const m of MANIFESTS) want(`scripts/repo-rules.json's wasmtime row for ${m}`, rules.deps[m]?.dependencies?.['wasmtime']?.spec, `=${v}`);
    const run = spawnSync(process.execPath, [join(REPO, 'scripts', 'repo-rules.mjs')], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const lines = `${run.stdout}\n${run.stderr}`.split('\n').filter((l) => /^(FAIL|INVALID|BLOCKED) /.test(l));
    for (const l of lines.filter((x) => x.includes('wasmtime') || MANIFESTS.some((m) => x.includes(m)))) failures.push(`scripts/repo-rules.mjs: ${l}`);
    console.log(`scripts/repo-rules.mjs exited ${run.status}; its other lines that don't pass: ${lines.length}`);

    none(failures, `the metering table, the pins and the rows name wasmtime ${v}, fuel per step is unchanged, and repo-rules passes for the engine`);
  }, TIMEOUT);
});
