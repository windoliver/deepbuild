// #855.1e8c7f85: costs.json from an optimized build gives text.shape, text.status and marks2d.frame
// coefficients each lower than today's debug-built ones, and a planted coefficient file marked with a
// debug profile is refused by the cost model, naming the profile.
//
// "Today's" are the base's committed terms (helpers.ts BASE_TERMS, read off crates/deep-canvas/costs.json
// at the base). The coefficient file records `build: {profile, toolchain}`, and so does the `costs` call's
// reply, from the binary that measured (README: The cost model). The planted file is
// fixtures/costs-dev.json, the base's terms marked with Cargo's debug profile `dev`, handed to the cost
// model by the startup argument `--costs <path>`; its twin marked `release` must be read, so a cost model
// that refuses every file can't pass. The wrong programs: the base (no profile recorded, no `--costs`, the
// debug-built terms); a file hand-marked optimized with the debug build's terms; a cost model that reads
// any profile.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BASE_TERMS, COSTS, REGISTRY, REPO, costTermsOf, environmentProblem, fixturePath, isObject, notLower, num, obj, optimizedProfile, refusedStart, run,
  scenario, str, toolchain, useBuilds, useTemp, type Build, type JsonObject, type JsonValue,
} from './helpers.ts';

const ID = '#855.1e8c7f85';
const FULL: Build = { set: 'full' };
const RELEASE: Build = { set: 'full', release: true };
const builds = useBuilds([FULL, RELEASE]);
const temp = useTemp();
const COMMITTED = join(REPO, 'crates', 'deep-canvas', 'costs.json');
const OPS = Object.keys(BASE_TERMS);

const termsOfFile = (file: JsonObject): Record<string, Record<string, number>> =>
  Object.fromEntries(Object.entries(obj(file['terms'], 'the file\'s terms')).map(([op, t]) => [op, Object.fromEntries(Object.entries(obj(t, `terms.${op}`)).map(([k, v]) => [k, num(v, `terms.${op}.${k}`)]))]));

/** A coefficient file's or a reply's `build`: its Cargo profile and toolchain. */
function buildOf(value: JsonValue | undefined, what: string): { profile: string; toolchain: string } {
  const b = obj(value, `${what}: build, the build profile and toolchain that measured the coefficients`);
  return { profile: str(b['profile'], `${what}: build.profile`), toolchain: str(b['toolchain'], `${what}: build.toolchain`) };
}

/** The `costs` call's reply from one binary. */
function measured(bin: string): JsonObject {
  const [reply] = run(bin, scenario(temp(), [COSTS]));
  return reply!;
}

describe(`${ID} coefficients measured from an optimized build are lower than today's debug-built ones for text.shape, text.status and marks2d.frame; a planted file marked with a debug profile is refused, naming the profile`, () => {
  it(`${ID} the committed costs.json records an optimized build profile and the toolchain, and its text.shape, text.status and marks2d.frame coefficients are each lower than the debug build's`, () => {
    const file = obj(JSON.parse(readFileSync(COMMITTED, 'utf8')) as JsonValue, 'crates/deep-canvas/costs.json');
    const build = buildOf(file['build'], 'crates/deep-canvas/costs.json');
    expect(optimizedProfile(build.profile), `the committed coefficients were measured from an optimized build, not ${build.profile}`).toBe(true);
    expect(build.toolchain, 'the file names the toolchain that built the measuring binary').toMatch(/^rustc \d+\.\d+\.\d+/);
    const terms = termsOfFile(file);
    console.log(`${ID} committed coefficients beside today's: ${OPS.map((op) => `${op} ${JSON.stringify(terms[op])} (was ${JSON.stringify(BASE_TERMS[op])})`).join('; ')}`);
    expect(notLower(terms, 'crates/deep-canvas/costs.json'), 'each of the three operators\' coefficients is lower than today\'s debug-built one').toEqual([]);
  });

  it(`${ID} the costs call reports the build that measured: the debug binary its dev profile, the release binary an optimized one, both with the checkout's toolchain`, () => {
    const rustc = toolchain();
    const debug = buildOf(measured(builds.bin(FULL))['build'], 'the debug binary\'s costs reply');
    expect(debug.profile, 'the debug binary measures under Cargo\'s dev profile').toBe('dev');
    expect(debug.toolchain, 'the debug binary names the toolchain that built it').toBe(rustc);
    const release = buildOf(measured(builds.bin(RELEASE))['build'], 'the release binary\'s costs reply');
    expect(optimizedProfile(release.profile), `the release binary's profile ${release.profile} is optimized`).toBe(true);
    expect(release.toolchain, 'the release binary names the toolchain that built it').toBe(rustc);
  }, 3_600_000);

  it(`${ID} measured on this checkout's optimized build, text.shape, text.status and marks2d.frame each come out lower than today's debug-built coefficients (a timing reading: INCONCLUSIVE off a quiet reference Mac on mains)`, (ctx) => {
    const reply = measured(builds.bin(RELEASE));
    const build = buildOf(reply['build'], 'the release binary\'s costs reply');
    expect(optimizedProfile(build.profile), `the measurement comes from an optimized build, not ${build.profile}`).toBe(true);
    const terms = Object.fromEntries(Object.entries(obj(reply['terms'], 'the costs reply\'s terms')).map(([op, t]) => [op, isObject(t) ? Object.fromEntries(Object.entries(t).map(([k, v]) => [k, num(v, `terms.${op}.${k}`)])) : {}]));
    const failures = notLower(terms, 'the optimized build\'s measurement');
    const reading = OPS.map((op) => `${op} ${JSON.stringify(terms[op])} (was ${JSON.stringify(BASE_TERMS[op])})`).join('; ');
    console.log(`${ID} measured here: ${reading}`);
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}; ${failures.length ? failures.join('; ') : reading}`);
    expect(failures, 'each operator\'s optimized coefficients are lower than the debug build\'s').toEqual([]);
  }, 3_600_000);

  it(`${ID} a planted coefficient file marked with the debug profile dev is refused by the cost model at startup, naming the profile`, () => {
    const line = refusedStart(builds.bin(FULL), ['--costs', fixturePath('costs-dev.json')]);
    expect(line['code'], `the refusal is the cost model's: ${JSON.stringify(line)}`).toBe('costs_refused');
    expect(line['profile'], 'the refusal names the profile').toBe('dev');
  });

  it(`${ID} a file with no build profile at all, today's costs.json, is refused too: nothing missing passes`, () => {
    const line = refusedStart(builds.bin(FULL), ['--costs', fixturePath('costs-base.json')]);
    expect(line['code'], `the refusal is the cost model's: ${JSON.stringify(line)}`).toBe('costs_refused');
    expect(line['profile'], 'no profile to name').toBeNull();
  });

  it(`${ID} the planted file's twin marked release is read: the build starts and its registry's costs are that file's terms; the committed file is read the same way`, () => {
    const twin = termsOfFile(obj(JSON.parse(readFileSync(fixturePath('costs-release.json'), 'utf8')) as JsonValue, 'costs-release.json'));
    const [reg] = run(builds.bin(FULL), scenario(temp(), [REGISTRY]), ['--costs', fixturePath('costs-release.json')]);
    const costs = costTermsOf(reg!);
    for (const op of OPS) expect(costs[op], `${op}'s terms are read from the file --costs names`).toEqual(twin[op]);
    const committed = termsOfFile(obj(JSON.parse(readFileSync(COMMITTED, 'utf8')) as JsonValue, 'crates/deep-canvas/costs.json'));
    const [own] = run(builds.bin(FULL), scenario(temp(), [REGISTRY]), ['--costs', COMMITTED]);
    for (const op of OPS) expect(costTermsOf(own!)[op], `${op}'s terms are the committed file's`).toEqual(committed[op]);
  });
});
