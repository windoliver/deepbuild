import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { calls, launched, needHook, stopHubs } from '../1812/helpers.ts';
import { built, cleanup as cleanup1856, finishSetup, guardAdd, guardFile, makeHome, seedDefaults, startHub, stopHub, type Guard } from '../1856/helpers.ts';
import { GUARD_FILE, ID, LINT, SECOND, cleanup, deep, lint, plantYourRules, scratchCheckout, shown, wordingFailures, world, type Ran } from './helpers.ts';

afterAll(async () => { await cleanup(); await cleanup1856(); }, 60 * SECOND);

const ADDED = 't-1814';

async function guardAdded(): Promise<Ran> {
  built();
  const home = makeHome();
  seedDefaults(home);
  finishSetup(home);
  const hub = await startHub(home);
  try {
    const guard: Guard = { match: 'run:gh pr merge', scope: 'all_repos', mode: 'block', reason: `Test entry ${ADDED} holds this call.`, next_step: `Leave ${ADDED} alone; this is a test.`, fail_closed: false };
    const r = await guardAdd(home, guardFile(ADDED, guard, 'gh pr merge 12', "echo 'gh pr merge 12'"));
    if (r.code !== 0) throw Error(`BLOCKED: deep guard add didn't add ${ADDED}: exit ${r.code}, stdout ${JSON.stringify(r.stdout)}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`);
    return { code: r.code, signal: r.signal, stdout: r.stdout, stderr: r.stderr, timedOut: r.timedOut };
  } finally {
    await stopHub(hub);
  }
}

async function setUpPrinted(): Promise<Ran> {
  needHook();
  const w = world();
  mkdirSync(join(w.home, '.local', 'bin'), { recursive: true });
  writeFileSync(join(w.home, '.local', 'bin', 'claude'), `#!/bin/sh\nprintf 'claude %s\\n' "$*" >> '${w.bin}/calls.log'\nexit 1\n`, { mode: 0o755 });
  try {
    const r = await deep(w, ['setup'], { hub: 'starts', timeoutMs: 240 * SECOND });
    const reached = calls(w).filter((line) => /^(installer|curl|wget|claude) /.test(line));
    if (reached.length) throw Error(`BLOCKED: deep setup reached past the stand-ins: ${reached.join('; ')}`);
    if (r.code !== 0 || !launched(w).length) throw Error(`BLOCKED: deep setup didn't set the home up with a hub: ${shown(r)}`);
    return r;
  } finally {
    await stopHubs(w);
  }
}

describe(`${ID.guardEntries} guard entries are guard entries where a person reads them`, () => {
  it(`${ID.guardEntries} deep guard add and deep setup print "guard entries" and never "rules" for them`, async () => {
    const added = await guardAdded();
    const setUp = await setUpPrinted();
    const failures = [...wordingFailures('deep guard add', added), ...wordingFailures('deep setup', setUp)];
    expect(failures, `deep guard add and deep setup must call guard entries "guard entries":\n${failures.join('\n')}`).toEqual([]);
  }, 600 * SECOND);

  it(`${ID.guardEntries} a planted "your rules" fails the lint lane, naming the file`, () => {
    const at = scratchCheckout();
    const control = lint(at);
    expect(control.status, `${LINT} passes on the unplanted copy before it is held to the plant:\n${control.output}`).toBe(0);
    plantYourRules(at);
    const { status, output, fails } = lint(at);
    expect(fails.some((fail) => fail.includes(GUARD_FILE)), `the lint must fail the planted "your rules" on a FAIL line naming ${GUARD_FILE}:\n${output}`).toBe(true);
    expect(status, `the lint exits 1 on the planted "your rules":\n${output}`).toBe(1);
  }, 900 * SECOND);
});
