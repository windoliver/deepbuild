// AC4: the generated TypeScript and Rust types carry the union and the nullable usage, the Rust
// `from_json` refuses what the TypeScript validator refuses (the `rust-checks` differential), and the
// catalogue lists both versions.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  catalogue, fixtures, generateRust, generateTypeScript, listSchemas, validate,
} from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import {
  buildRust, CAUSES, expectPublished, isObject, RESETS, RUST, rustAccepts, rustRoundtrip, stop, stopData, TYPES, typecheck,
  USAGE_ESTIMATED, USAGE_REPORTED, V1, V2,
} from './helpers.ts';
import type { JsonObject } from './helpers.ts';

beforeAll(() => { buildRust(); }, 600_000);

const EXPECTED_CAUSES = CAUSES.map((c) => JSON.stringify(c)).join(' | ');

describe('AC4 the generated types carry the union and the nullable usage', () => {
  it('AC4 the committed TypeScript and Rust files are the generators\' output over the published schemas, both versions among them', () => {
    expectPublished(V1);
    expectPublished(V2);
    expect(readFileSync(TYPES, 'utf8') === generateTypeScript(listSchemas()), 'types.ts is exactly generateTypeScript(listSchemas())').toBe(true);
    expect(readFileSync(RUST, 'utf8') === generateRust(listSchemas()), 'generated.rs is exactly generateRust(listSchemas())').toBe(true);
    expect(readFileSync(RUST, 'utf8'), 'the Rust roundtrip dispatches agent.stop@2').toContain(`"${V2}" =>`);
  });

  it('AC4 the TypeScript type of agent.stop@2 is a union on cause, exactly the closed set, with plan_resets only on plan_window_spent and usage required and nullable', () => {
    const diagnostics = typecheck(`
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type D = {{V2}}['data'];
export const causes: Equals<D['cause'], ${EXPECTED_CAUSES}> = true;
export const plan: D = { turn: 1, did_work: true, cause: 'plan_window_spent', plan_resets: ${RESETS}, usage: null };
export const other: D = { turn: 1, did_work: true, cause: 'rate_limited', usage: null };
// @ts-expect-error plan_window_spent needs plan_resets
export const planWithout: D = { turn: 1, did_work: true, cause: 'plan_window_spent', usage: null };
// @ts-expect-error usage is required, even when not captured
export const noUsage: D = { turn: 1, did_work: true, cause: 'unknown' };
export function resets(d: D): number | undefined {
  if (d.cause === 'plan_window_spent') { const at: number = d.plan_resets; return at; }
  // @ts-expect-error only plan_window_spent carries plan_resets
  return d.plan_resets;
}
export function covers(d: D): 'turn' | 'session' | null {
  // @ts-expect-error usage may be null
  void d.usage.covers;
  return d.usage === null ? null : d.usage.covers;
}
`);
    expect(diagnostics, 'tsc over the generated agent.stop@2 type').toEqual([]);
  }, 60_000);

  it('AC4 Rust round-trips a stop with usage null, a stop with a usage and a plan_window_spent stop to the same JSON', () => {
    expectPublished(V2);
    const values = [stop(stopData('unknown', null)), stop(stopData('rate_limited', USAGE_REPORTED)), stop(stopData('plan_window_spent', USAGE_ESTIMATED))];
    const rust = rustRoundtrip(V2, values);
    // A Rust type that drops a null usage on the way back, or a plan_resets it has no field for, fails here.
    expect(rust.ok ? '' : rust.error, 'Rust took the valid stops').toBe('');
    if (!rust.ok) return;
    values.forEach((value, i) => expect(JSON.parse(rust.out[i] ?? 'null'), `round trip ${i}`).toEqual(value));
  });
});

describe('AC4 Rust refuses what the TypeScript validator refuses', () => {
  /** Planted stops, each with the verdict the issue gives it. */
  function cases(): { why: string; value: JsonObject; valid: boolean }[] {
    const out: { why: string; value: JsonObject; valid: boolean }[] = [];
    const add = (why: string, data: JsonObject, valid: boolean) => out.push({ why, value: stop(data), valid });
    const usage = (change: (u: JsonObject) => void, base = USAGE_REPORTED): JsonObject => { const u = structuredClone(base); change(u); return u; };
    for (const cause of CAUSES) {
      add(`cause ${cause}, usage null`, stopData(cause), true);
      add(`cause ${cause}, a usage`, stopData(cause, USAGE_ESTIMATED), true);
      if (cause !== 'plan_window_spent') add(`cause ${cause} with plan_resets`, { ...stopData(cause), plan_resets: RESETS }, false);
    }
    const omit = (data: JsonObject, key: string): JsonObject => { const copy = structuredClone(data); delete copy[key]; return copy; };
    add('plan_window_spent without plan_resets', omit(stopData('plan_window_spent'), 'plan_resets'), false);
    for (const cause of ['overloaded', 'rate_limit', 'Unknown', '']) add(`cause ${JSON.stringify(cause)}`, stopData(cause), false);
    add('no usage', omit(stopData('unknown'), 'usage'), false);
    add('no cause', omit(stopData('unknown'), 'cause'), false);
    for (const count of ['input', 'cached', 'output']) {
      add(`${count} 0 with exact false`, stopData('unknown', usage((u) => { u[count] = { value: 0, exact: false }; })), false);
      add(`${count} 0 with exact true`, stopData('unknown', usage((u) => { u[count] = { value: 0, exact: true }; })), true);
    }
    add('estimated cost without rate_card', stopData('unknown', usage((u) => { delete (u.cost as JsonObject).rate_card; }, USAGE_ESTIMATED)), false);
    add('reported cost with a rate_card', stopData('unknown', usage((u) => { (u.cost as JsonObject).rate_card = 'openai-2026-10'; })), false);
    add('covers week', stopData('unknown', usage((u) => { u.covers = 'week'; })), false);
    add('context_fill 1.5', stopData('unknown', usage((u) => { u.context_fill = 1.5; })), false);
    add('an unlisted data field', { ...stopData('unknown'), reason: 'rate limit' }, false);
    return out;
  }

  it('AC4 every planted stop gets its expected verdict from the TypeScript validator, and the same verdict from the generated Rust from_json', () => {
    expectPublished(V2);
    const planted = cases();
    const ts = planted.map((c) => validate(V2, c.value).ok);
    expect(planted.filter((c, i) => ts[i] !== c.valid).map((c) => `${c.why}: TypeScript ${c.valid ? 'refuses' : 'accepts'}`), 'the TypeScript verdicts').toEqual([]);
    const rust = rustAccepts(V2, planted.map((c) => c.value));
    expect(rust).toHaveLength(planted.length);
    // A hand-written or stale Rust type (no union on cause, an Option<usage> that takes a missing field) fails here.
    expect(planted.flatMap((c, i) => (rust[i] === ts[i] ? [] : [`${c.why}: TypeScript ${ts[i] ? 'accepts' : 'refuses'}, Rust ${rust[i] ? 'accepts' : 'refuses'}`])), 'Rust and TypeScript disagree').toEqual([]);
  });

  it('AC4 the rust-checks differential reaches agent.stop@2: its fixtures validate and hold a usage, a usage null and a plan_window_spent stop', () => {
    expectPublished(V2);
    // packages/contracts/test/rust-checks.test.ts mutates each published schema's fixtures; it reaches the
    // union branch and the usage nodes only through fixtures that hold them.
    const found = fixtures(V2);
    expect(found.length, `${V2} has fixtures`).toBeGreaterThan(0);
    for (const f of found) expect(validate(V2, f).ok, `fixture ${JSON.stringify(f).slice(0, 200)}`).toBe(true);
    const data = found.map((f) => (isObject(f) && isObject(f.data) ? f.data : {}));
    expect(data.some((d) => d.usage === null), 'a fixture with usage null').toBe(true);
    expect(data.some((d) => isObject(d.usage)), 'a fixture with a usage').toBe(true);
    expect(data.some((d) => d.cause === 'plan_window_spent'), 'a plan_window_spent fixture').toBe(true);
    expect(rustAccepts(V2, found as JsonValue[]).every(Boolean), 'Rust takes every fixture').toBe(true);
  });
});

describe('AC4 the catalogue lists both versions, and agent.stop@1 stays frozen', () => {
  it('AC4 the catalogue lists agent.stop at versions 1 and 2, each with its schema', () => {
    const entries = catalogue().filter((e) => e.kind === 'agent.stop').map((e) => ({ version: e.version, schema: e.schema }));
    expect(entries.sort((a, b) => a.version - b.version)).toEqual([{ version: 1, schema: V1 }, { version: 2, schema: V2 }]);
  });
});
