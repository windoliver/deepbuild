// AC15: for every JSON Schema in the contracts, a generator draws valid instances each consumer accepts and four
// mutations (a required field removed, an enum value off its list, a number past its range, an unknown field),
// each refused with its own code and the field's path, at 1,000 cases from a recorded seed.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listSchemas, validate } from '../../../packages/contracts/src/index.ts';
import type { JsonValue, Schema, SchemaEntry, Validation } from '../../../packages/contracts/src/index.ts';
import { draw, RECORDED_SEED } from '../../../packages/conformance/src/index.ts';
import type { Drawn, Mutation, MutationKind } from '../../../packages/conformance/src/index.ts';
import { isObject, lenientValidate, REPO } from './helpers.ts';

const CASES = 1000;
const RUST = join(REPO, 'target', 'debug', process.platform === 'win32' ? 'deep-contracts.exe' : 'deep-contracts');
const RUST_SAMPLE = 25;
const CODE_OF: Record<MutationKind, string> = { required_removed: 'required', enum_off_list: 'enum', number_past_range: 'range', unknown_field: 'unlisted_field' };
const KINDS = Object.keys(CODE_OF) as MutationKind[];

/** The mutation kinds a schema affords: it has a required field, an enum, a bounded number or a closed object anywhere. */
function affords(schema: Schema): Set<MutationKind> {
  const kinds = new Set<MutationKind>();
  const walk = (node: JsonValue): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isObject(node)) return;
    if (Array.isArray(node.required) && node.required.length) kinds.add('required_removed');
    if (Array.isArray(node.enum)) kinds.add('enum_off_list');
    if (typeof node.minimum === 'number' || typeof node.maximum === 'number') kinds.add('number_past_range');
    if (node.additionalProperties === false) kinds.add('unknown_field');
    for (const [key, value] of Object.entries(node)) if (key !== 'enum') walk(value);
  };
  walk(schema);
  return kinds;
}

/** The assertion AC15 makes of a consumer over one schema's draws: valid accepted, each mutation refused at its field with its code. */
function holdConsumer(consumer: (name: string, value: unknown) => Validation, entry: SchemaEntry, seed: number, drawn: Drawn[]): void {
  const where = `${entry.name} at seed ${seed}`;
  for (const [i, d] of drawn.entries()) {
    const ok = consumer(entry.name, d.valid);
    expect(ok.ok, `${where}: draw ${i} accepted ${ok.ok ? '' : JSON.stringify(ok.issues)}`).toBe(true);
    for (const m of d.mutations) {
      const result = consumer(entry.name, m.value);
      expect(result.ok, `${where}: draw ${i} ${m.kind} at ${m.path} refused`).toBe(false);
      if (result.ok) continue;
      expect(result.issues.map((issue) => `${issue.code} ${issue.path}`), `${where}: draw ${i} ${m.kind} refused with ${m.code} at ${m.path}`).toContain(`${m.code} ${m.path}`);
    }
  }
}

/** The 1,000 draws of a schema at the recorded seed, drawn once per run. */
const memo = new Map<string, Drawn[]>();
const drawnFor = (entry: SchemaEntry): Drawn[] => {
  let drawn = memo.get(entry.name);
  if (!drawn) memo.set(entry.name, (drawn = draw(entry.schema, RECORDED_SEED, CASES)));
  return drawn;
};
const drawnAll = { get: (name: string) => drawnFor(listSchemas().find((e) => e.name === name)!) };
/** Builds the Rust consumer; a build that fails fails the test that needs it, never skips it. */
function buildRust(): void {
  const build = spawnSync('cargo', ['build', '--locked', '-q', '-p', 'deep-contracts', '--bin', 'deep-contracts'], { cwd: REPO, encoding: 'utf8' });
  if (build.status !== 0) throw Error(`cargo build failed:\n${build.stderr}`);
}

describe('AC15 a generator draws valid instances and four mutations for every schema, at 1,000 cases from the recorded seed', () => {
  it('AC15 the recorded seed is a whole number, and the same seed draws the same instances while another seed draws others', () => {
    expect(Number.isInteger(RECORDED_SEED)).toBe(true);
    const [entry] = listSchemas();
    expect(draw(entry!.schema, RECORDED_SEED, 50)).toEqual(draw(entry!.schema, RECORDED_SEED, 50));
    const differs = listSchemas().some((e) => JSON.stringify(draw(e.schema, RECORDED_SEED, 20)) !== JSON.stringify(draw(e.schema, RECORDED_SEED + 1, 20)));
    expect(differs, 'another seed draws other instances').toBe(true);
  });

  it('AC15 every schema draws 1,000 valid instances the TypeScript validator accepts, each mutation refused with its own code at the field\'s path', () => {
    for (const entry of listSchemas()) {
      const drawn = drawnAll.get(entry.name)!;
      expect(drawn.length, `${entry.name} draws ${CASES}`).toBe(CASES);
      holdConsumer(validate, entry, RECORDED_SEED, drawn);
    }
  }, 600_000);

  it('AC15 each mutation names its kind, its code (required, enum, range, unlisted_field) and a JSON Pointer; every kind the schema affords is drawn', () => {
    for (const entry of listSchemas()) {
      const drawn = drawnAll.get(entry.name)!;
      const seen = new Set<MutationKind>();
      for (const d of drawn) for (const m of d.mutations) {
        expect(KINDS, `${entry.name}: kind ${m.kind}`).toContain(m.kind);
        expect(m.code, `${entry.name}: ${m.kind} raises ${CODE_OF[m.kind]}`).toBe(CODE_OF[m.kind]);
        expect(m.path === '' || m.path.startsWith('/'), `${entry.name}: ${m.path} is a JSON Pointer`).toBe(true);
        seen.add(m.kind);
      }
      for (const kind of affords(entry.schema)) expect(seen.has(kind), `${entry.name} affords ${kind}, so the draws include it`).toBe(true);
      expect(drawn.some((d) => d.mutations.length > 0), `${entry.name} draws mutations`).toBe(true);
    }
  });

  it('AC15 the mutations are the four and nothing else: a removed required field is absent, an off-list value is not in the enum, a number past its range is outside it, an unknown field is one the schema does not list', () => {
    const at = (value: JsonValue, pointer: string): JsonValue | undefined => pointer.split('/').slice(1).reduce<JsonValue | undefined>((node, raw) => {
      const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      return Array.isArray(node) ? node[Number(key)] : isObject(node) ? node[key] : undefined;
    }, value);
    for (const entry of listSchemas()) {
      for (const d of drawnAll.get(entry.name)!.slice(0, 100)) for (const m of d.mutations) {
        const before = at(d.valid, m.path);
        const after = at(m.value, m.path);
        if (m.kind === 'required_removed') { expect(before, `${entry.name} ${m.path} existed`).toBeDefined(); expect(after).toBeUndefined(); }
        if (m.kind === 'enum_off_list') { expect(after).toBeDefined(); expect(after).not.toEqual(before); }
        if (m.kind === 'number_past_range') { expect(typeof after).toBe('number'); expect(after).not.toEqual(before); }
        if (m.kind === 'unknown_field') { expect(before).toBeUndefined(); expect(after).toBeDefined(); }
      }
    }
  });

  it('AC15 the Rust consumer (deep-contracts check) accepts the valid draws and refuses the off-list mutations, on a sample of each schema', () => {
    buildRust();
    for (const entry of listSchemas()) {
      const drawn = drawnAll.get(entry.name)!.slice(0, RUST_SAMPLE);
      const offList: Mutation[] = drawn.flatMap((d) => d.mutations.filter((m) => m.kind === 'enum_off_list'));
      const values: JsonValue[] = [...drawn.map((d) => d.valid), ...offList.map((m) => m.value)];
      const run = spawnSync(RUST, ['check', entry.name], { input: `${values.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
      expect(run.status, `deep-contracts check ${entry.name}: ${run.stderr}`).toBe(0);
      const verdicts = run.stdout.trimEnd().split('\n');
      expect(verdicts.length).toBe(values.length);
      verdicts.slice(0, drawn.length).forEach((v, i) => expect(v, `${entry.name} at seed ${RECORDED_SEED}: Rust accepts draw ${i}`).toBe('ok'));
      verdicts.slice(drawn.length).forEach((v, i) => expect(v, `${entry.name} at seed ${RECORDED_SEED}: Rust refuses off-list ${offList[i]!.path}`).not.toBe('ok'));
    }
  }, 600_000);

  it('AC15 (wrong program) a consumer that accepts the off-list value fails this test, naming the schema and the seed', () => {
    const withEnum = listSchemas().find((e) => affords(e.schema).has('enum_off_list') && drawnAll.get(e.name)!.some((d) => d.mutations.some((m) => m.kind === 'enum_off_list')))!;
    expect(withEnum, 'some schema has an enum').toBeDefined();
    let thrown: unknown;
    try { holdConsumer(lenientValidate, withEnum, RECORDED_SEED, drawnAll.get(withEnum.name)!); } catch (error) { thrown = error; }
    expect(thrown, 'the lenient consumer is caught').toBeDefined();
    expect(String((thrown as Error).message)).toContain(withEnum.name);
    expect(String((thrown as Error).message)).toContain(`seed ${RECORDED_SEED}`);
  });
});
