// #824 AC4's two wrong programs, selected with DEEP_HUB_PLANT, fail the per-session reading on any machine that can
// take it, each naming the per-session growth and the process that grew. The unplanted run on the same machine is the
// comparison, so a benchmark that fails everything, or a plant that adds nothing, fails here: each plant must raise its
// own process's growth per added session by at least 20 MB over the unplanted run's (README, Defined here, 3).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, MINUTE, sizesNamed } from '../helpers.ts';
import { AC4, bench, CRITERION, grewMost, lineFrom, perSessionGrowth, roleGrowth, shown, worded, type Ran, type Role } from './helpers.ts';

afterEach(cleanup, MINUTE);

/** What a plant adds per session at least: with the two MCP servers' own few MB a session, it crosses 25 MB anywhere. */
const AT_LEAST = 20_000_000;
/** And at most: the small wrong program the issue names, not a flood any reading would see. */
const AT_MOST = 200_000_000;

let unplanted: Promise<Ran> | undefined;

describe(`${AC4} ${CRITERION}: the planted wrong programs`, () => {
  it.each([
    ['mcp-loads-hub', 'deep mcp', /\bdeep mcp\b(?! actions)/],
    ['waiter-keeps-transcript', 'waiter', /\bwaiter\b/],
  ] as const)(`${AC4} %s fails it, naming the per-session growth and %s as the process that grew`, async (plant, role: Role, named) => {
    const planted = await bench({ plant });
    const line = lineFrom(planted);
    const growth = perSessionGrowth(line);
    expect(planted.code, `a planted run fails the benchmark, exit non-zero: ${shown(planted)}`).not.toBe(0);
    const fail = worded(planted, 'FAIL');
    expect(fail, `it prints a line starting FAIL: ${shown(planted)}`).toBeDefined();
    expect(sizesNamed(fail!).some((n) => Math.abs(n - growth) <= growth * 0.15), `the line names the per-session growth, ${growth} B, recomputed from its readings: "${fail}"`).toBe(true);
    expect(fail, `the line names the process that grew, ${role}`).toMatch(named);
    expect(grewMost(line), `${role} is the process that grew most per added session, by its own readings`).toBe(role);
    expect(line.grew.role).toBe(role);

    // The plant is what moved the reading: its process grew per session beside the unplanted run's on this machine.
    unplanted ??= bench();
    const healthy = lineFrom(await unplanted);
    const added = roleGrowth(line, role) - roleGrowth(healthy, role);
    console.log(`#824 ${plant}: ${role} +${Math.round(added)} B per added session over the unplanted run's ${Math.round(roleGrowth(healthy, role))} B; summed ${growth} B against ${perSessionGrowth(healthy)} B`);
    expect(added, `${plant} raises ${role}'s growth per added session by at least ${AT_LEAST} B: a whole hub package, or a 32 MiB transcript, in every session`).toBeGreaterThanOrEqual(AT_LEAST);
    expect(added, `${plant} is the wrong program the issue names, not a flood`).toBeLessThanOrEqual(AT_MOST);
  }, 60 * MINUTE);
});
