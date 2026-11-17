// #2218 AC5, the twin: this repo's own `done.yaml` is read whole, with no key refused (issue: Scope, "A key the hub
// doesn't read ... makes the claim BLOCKED"; every key this file writes is one the hub reads, so none is).
//
// The fixture repo's spec is this checkout's `.deepbuild/done.yaml`, byte for byte, read when the test runs. The repo
// holds what that spec's commands enter: a typecheck at node_modules/typescript/bin/tsc that finds nothing wrong, a
// test runner at node_modules/vitest/vitest.mjs that loads the node:test files under packages, and, first on the hub's
// PATH, programs that do nothing for the ones its `outside` build names (npm and cargo build this repo's workspaces and
// crate, which the fixture doesn't hold). Those are the fixture's own; the hub, deep-hook and the record are real. The
// session types the change, makes the fix and stops. Read whole: every check `claims.done.checks` names runs and
// passes, the build `outside` names ran, and the claim passes, which no claim with a refused key does.
//
// This test holds on the base commit too, where no key is refused yet. Its wrong program is a hub that refuses a key
// this file writes: a mutant of the fix's own lines, or a planted twin (README, Proof limits).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { AC5, REPO, SPEC_FILE, claimed, cleanup, fixture, shop, shownClaim, standIns } from './helpers.ts';

afterEach(cleanup, 60_000);

interface Spec { claims?: { done?: { checks?: unknown[] } }; checks?: Record<string, unknown>; outside?: { build?: unknown } }

describe(`${AC5} the twin: this repo's own done.yaml`, () => {
  it(`${AC5} a claim in a trusted repo whose spec is this repo's own done.yaml runs every check it names and passes: no key is refused`, async () => {
    const own = readFileSync(join(REPO, SPEC_FILE), 'utf8');
    const spec = parse(own) as Spec;
    const checks = (spec.claims?.done?.checks ?? Object.keys(spec.checks ?? {})).map(String);
    if (!checks.length) throw Error(`BLOCKED: ${AC5} this repo's ${SPEC_FILE} names no check for a done claim`);
    const build = typeof spec.outside?.build === 'string' ? spec.outside.build : '';
    const programs = [...new Set(build.split(/&&|\|\||;/).map((part) => part.trim().split(/\s+/)[0] ?? '').filter(Boolean))];
    const w = await shop({ spec: own, files: { 'node_modules/typescript/bin/tsc': fixture('tsc.js'), 'node_modules/vitest/vitest.mjs': fixture('vitest.mjs'), 'packages/token/token.mjs': fixture('token.mjs') } });
    const tools = standIns(w, programs);
    const c = await claimed(AC5, w, { done: (r) => r.outcome === 'PASS', path: tools.path });
    for (const name of checks) {
      expect(c.runs.some((r) => r.check === name && r.outcome === 'passed'), `${AC5} this repo's ${SPEC_FILE} names ${name} for a done claim, so it must run on the claim and pass in a repo that holds what its command enters: ${shownClaim(c)}`).toBe(true);
    }
    for (const program of programs) {
      expect(tools.calls().some((call) => call.startsWith(`${program} `)), `${AC5} this repo's ${SPEC_FILE} builds a checkout for the checks it lists under outside with \`${build}\`, so ${program} must have run: the build's programs ran as ${JSON.stringify(tools.calls())}; ${shownClaim(c)}`).toBe(true);
    }
    expect(c.outcome, `${AC5} this repo's own ${SPEC_FILE} must be read whole, with no key refused: every check it names passed, so the claim passes; it is ${c.outcome ?? 'without a verdict'}: ${shownClaim(c)}`).toBe('PASS');
  }, 1_800_000);
});
