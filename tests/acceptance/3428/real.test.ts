// #3428's AC1 (README, AC1): #55's real-daemon cases pass on the newest stable paseo, and the facts and the plugin's
// range name that release. The release is paseo's newest stable one as this job read it (NEWEST_STABLE), or a newer
// stable one given through DEEP_PASEO_CLI. The run is #55's own `tests/acceptance/55/real.test.ts`, unchanged, on the
// paseo DEEP_PASEO_CLI names: it reads BLOCKED, never PASS and never a skip, while that paseo is missing, isn't the
// newest stable release, or isn't the one the facts and the range name.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir, run } from '../27/helpers.ts';
import { AC, MANIFEST_FILE, NEWEST_STABLE, NODE, REPO, cleanup, covered, newestCovered, range, type Line } from './world.ts';
import { compare, parse, satisfies } from './range.ts';

afterEach(cleanup, 120_000);

/** The paseo given by hand (README, Run), read before anything else could. */
const GIVEN = process.env.DEEP_PASEO_CLI;
const versionOf = (cli: string): string => execFileSync(cli, ['--version'], { encoding: 'utf8', env: { PATH: `${dirname(NODE)}:/usr/bin:/bin`, HOME: tempDir() }, timeout: 60_000 }).trim().replace(/^v/, '');
/** The newest stable paseo: NEWEST_STABLE, or the one given when it is stable and newer. */
function newestStable(): string {
  if (!GIVEN || !existsSync(GIVEN)) return NEWEST_STABLE;
  const v = versionOf(GIVEN);
  return parse(v) && compare(parse(v)!, parse(NEWEST_STABLE)!) > 0 ? v : NEWEST_STABLE;
}

describe(`${AC[1]} #55's real-daemon cases pass on the newest stable paseo, and the facts and the plugin's range name that release`, () => {
  it(`${AC[1]} the facts' newest version is paseo's newest stable release, and the plugin's range holds it and every version the facts cover`, () => {
    const newest = newestStable();
    expect(newestCovered(), `${AC[1]} adapters/paseo.facts.json's versions end at paseo's newest stable release ${newest}; they are ${covered().join(', ')}`).toBe(newest);
    expect(satisfies(newest, range()), `${AC[1]} the plugin's requirements.paseo (${range()} in packages/paseo/paseo-plugin.json) holds ${newest}`).toBe(true);
    expect(covered().filter((v) => !satisfies(v, range())), `${AC[1]} the plugin's range ${range()} holds every version the facts cover (${covered().join(', ')}), as #55's suite requires`).toEqual([]);
  });

  it(`${AC[1]} #55's real-daemon cases (tests/acceptance/55/real.test.ts) pass on a real daemon of that release`, async () => {
    if (!GIVEN || !existsSync(GIVEN)) throw Error(`BLOCKED: no real paseo: set DEEP_PASEO_CLI to the paseo command of @getpaseo/cli ${NEWEST_STABLE} or a newer stable release (got ${GIVEN ?? 'nothing'}); #55's real-daemon cases run on nothing else (README, Run)`);
    const version = versionOf(GIVEN);
    if (!parse(version) || compare(parse(version)!, parse(NEWEST_STABLE)!) < 0) throw Error(`BLOCKED: DEEP_PASEO_CLI is paseo ${version}, not the newest stable release (${NEWEST_STABLE}, npm's latest on Nov 27 2026, or a newer stable one)`);
    if (newestCovered() !== version || !satisfies(version, range())) throw Error(`BLOCKED: DEEP_PASEO_CLI is paseo ${version}, and the facts' newest version is ${newestCovered()} with the plugin's range ${range()} (${MANIFEST_FILE.slice(REPO.length)}): #55's real-daemon cases run on the release the facts pin, so they can't run on ${version} until the facts and the range name it`);

    const out = join(tempDir(), 'real-55.json');
    const r = await run(NODE, [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--root', join(REPO, 'tests/acceptance/55'), 'real.test.ts', '--no-file-parallelism', '--testTimeout=900000', '--reporter=json', `--outputFile=${out}`], { env: { ...process.env, DEEP_PASEO_CLI: GIVEN }, cwd: REPO, timeoutMs: 3_000_000 });
    if (!existsSync(out)) throw Error(`BLOCKED: #55's real.test.ts wrote no report (exit ${r.code}): ${r.stderr.slice(-2000)}`);
    const cases = ((JSON.parse(readFileSync(out, 'utf8')) as Line).testResults as Line[]).flatMap((f) => f.assertionResults as Line[]);
    // #55's phone half needs a paired phone, not a daemon: it reads BLOCKED in #55's own suite, and is no daemon case.
    const phone = (c: Line) => /phone app/.test(String(c.title)) && !/session ID/.test(String(c.title));
    const daemon = cases.filter((c) => !phone(c));
    const said = (c: Line) => `${String(c.title)}: ${c.status}${c.failureMessages?.length ? ` (${String(c.failureMessages[0]).split('\n')[0]!.slice(0, 600)})` : ''}`;
    const blocked = daemon.filter((c) => c.status !== 'passed' && String(c.failureMessages?.[0] ?? '').includes('BLOCKED'));
    if (blocked.length) throw Error(`BLOCKED: #55's real-daemon cases didn't all run on paseo ${version}: ${blocked.map(said).join('; ')}`);
    expect(daemon.length, `${AC[1]} #55's real.test.ts holds its three real-daemon cases (AC1's turn end, AC5's tools, AC7's removal): ${cases.map(said).join('; ')}`).toBe(3);
    expect(daemon.filter((c) => c.status !== 'passed').map(said), `${AC[1]} each of #55's real-daemon cases passes on paseo ${version}`).toEqual([]);
  }, 3_000_000);
});
