// Criterion 5: a test backend that wraps Rapier but whose `query()` ignores collision groups returns a hit on a body its
// ray's groups filter out and fails the query fixture, naming the fixture and the hit, while Rapier's `query()` matches
// the brute-force scan on every ray, sweep and overlap.
import { describe, expect, test } from 'vitest';
import {
  AC, EXPECTED, TIMEOUT, failFailures, fixturesOf, isObject, kitCall, kitReport, none, num, obj, physics, passFailures,
  prebuild, resultOf, show, strs, type JsonObject,
} from './helpers.ts';

prebuild(['shipped', 'test']);

/** The groups a shape use is a member of; null when it names none (a member of every group, which no filter leaves out). */
function members(world: JsonObject, body: string): (string[] | null)[] {
  const b = obj(obj(world['bodies'], 'the queries world: bodies')[body], `the queries world: bodies.${body}`);
  return (Array.isArray(b['shapes']) ? b['shapes'] : []).map((u) => (isObject(u) && Array.isArray(u['member']) ? strs(u['member'], `${body}'s member`) : null));
}

describe(`${AC[5]} queries through query() match a brute-force scan, groups applied`, () => {
  test(`${AC[5]} Rapier's query() matches the brute-force scan on every ray, sweep and overlap of the queries fixture`, () => {
    const r = resultOf(kitReport(physics([kitCall()])[0]!, 'behavior_kit on rapier3d'), 'queries', 'rapier3d');
    none(passFailures(r, EXPECTED.find((e) => e.name === 'queries')!, undefined), 'rapier3d on queries');
    const probes = obj(r.raw['probes'], 'queries: probes (how many of each kind it compared)');
    for (const kind of ['ray', 'sweep', 'overlap']) expect(num(probes[kind], `queries: probes.${kind}`), `queries compares at least one ${kind}`).toBeGreaterThan(0);
  }, TIMEOUT);

  test(`${AC[5]} query_ignores_groups fails queries, naming the fixture and a hit on a body its ray's groups filter out`, () => {
    const [fixtures, report] = physics([{ call: 'behavior_fixtures' }, kitCall()], { backend: 'query_ignores_groups' });
    const q = fixturesOf(fixtures!, 'behavior_fixtures').find((f) => f.name === 'queries');
    expect(q, 'the interface holds the queries fixture').toBeDefined();
    const r = resultOf(kitReport(report!, 'behavior_kit on query_ignores_groups'), 'queries', 'query_ignores_groups');
    const failures = failFailures(r, 'query_ignores_groups');
    const hit = r.raw['hit'];
    const probe = isObject(r.raw['probe']) ? r.raw['probe'] : null;
    if (typeof hit !== 'string') failures.push(`queries' fail names no hit (a body ID): ${show(r.raw)}`);
    else {
      if (!r.what.includes(hit)) failures.push(`queries' fail text doesn't name the hit ${hit}: ${JSON.stringify(r.what)}`);
      if (!probe || probe['kind'] !== 'ray' || !Array.isArray(probe['groups'])) failures.push(`queries' fail names no ray with its groups: ${show(probe)}`);
      else {
        const groups = strs(probe['groups'], 'the ray\'s groups');
        const uses = members(q!.world, hit);
        if (uses.length === 0 || uses.some((m) => m === null || m.some((g) => groups.includes(g)))) failures.push(`the hit ${hit} (members ${JSON.stringify(uses)}) isn't a body the ray's groups ${show(groups)} filter out`);
      }
    }
    none(failures, 'query_ignores_groups on queries');
  }, TIMEOUT);
});
