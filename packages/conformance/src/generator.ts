// The generator (#313, AC15): for any contract schema, valid instances drawn from a seed, each with the four
// mutations every consumer must refuse with its own code at the field's path: a required field removed, an
// enum value off its list, a number past its range, an unknown field.
import { compilePattern, registry } from '@deepbuild/contracts';
import type { Inst, JsonValue, Schema } from '@deepbuild/contracts';
import { segment } from './pointer.js';
import { isObject } from './types.js';
import type { Drawn, Mutation, MutationKind } from './types.js';

/** The seed recorded for the preflight's draws. */
export const RECORDED_SEED = 313;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_OF: Record<MutationKind, string> = { required_removed: 'required', enum_off_list: 'enum', number_past_range: 'range', unknown_field: 'unlisted_field' };

/** mulberry32: a small seeded generator, the same stream for the same seed on every machine. */
class Random {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0; }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }
  pick<T>(items: readonly T[]): T { return items[this.int(0, items.length - 1)]!; }
  chance(p: number): boolean { return this.next() < p; }
}

const programs = new Map<string, Inst[]>();
const program = (pattern: string): Inst[] => {
  let found = programs.get(pattern);
  if (!found) programs.set(pattern, (found = compilePattern(pattern)));
  return found;
};

/** A code point from the ranges, printable ASCII where the ranges allow it, so both consumers read the same text. */
function codePoint(random: Random, ranges: readonly [number, number][]): number {
  const printable = ranges.flatMap(([lo, hi]) => { const a = Math.max(lo, 0x21), b = Math.min(hi, 0x7e); return a <= b ? [[a, b] as [number, number]] : []; }).filter(([lo, hi]) => !(lo <= 0x5c && 0x5c <= hi && lo === hi));
  const from = printable.length ? printable : ranges;
  const [lo, hi] = random.pick(from);
  let c = random.int(lo, hi);
  if (c === 0x5c || c === 0x22) c = lo === hi ? c : (c === hi ? c - 1 : c + 1);
  return c;
}

/** A string the pattern's Pike VM program accepts: a random walk from its first step, loops taken a few times. */
function fromPattern(random: Random, pattern: string, budget: number): string {
  const steps = program(pattern);
  const out: number[] = [];
  let pc = 0;
  let visits = 0;
  const seen = new Map<number, number>();
  while (visits++ < 4096) {
    const inst = steps[pc]!;
    if (inst.op === 'match') break;
    if (inst.op === 'char') { out.push(codePoint(random, inst.ranges)); pc++; continue; }
    if (inst.op === 'jmp') { pc = inst.to; continue; }
    // A split: the branch that leaves a loop more often as the string grows.
    const times = (seen.get(pc) ?? 0) + 1;
    seen.set(pc, times);
    const stay = out.length < budget && random.chance(times > 2 ? 0.25 : 0.6);
    pc = stay ? inst.x : inst.y;
  }
  return String.fromCodePoint(...out);
}

/** The schemas whose instances are drawn, compiled once per draw() call for the self-check. */
function instanceOf(random: Random, root: Schema): JsonValue {
  const defs = isObject(root.$defs) ? root.$defs : {};
  const resolve = (node: Schema): Schema => (typeof node.$ref === 'string' ? resolve(defs[node.$ref.replace(/^#\/\$defs\//, '')] as Schema) : node);
  const word = (min: number, max: number): string => {
    const length = random.int(Math.max(1, min), Math.min(Math.max(min + 1, 12), max));
    return Array.from({ length }, () => CROCKFORD[random.int(10, 31)]!.toLowerCase()).join('');
  };
  const opaque = (): JsonValue => random.pick<JsonValue>([null, true, 7, 'opaque', { planted: 1 }, [1, 'two']]);
  const string = (s: Schema): string => {
    if (Array.isArray(s.enum)) return String(random.pick(s.enum));
    const min = typeof s.minLength === 'number' ? s.minLength : 0;
    const max = typeof s.maxLength === 'number' ? s.maxLength : 64;
    if (s.format === 'ulid') return `0${Array.from({ length: 25 }, () => CROCKFORD[random.int(0, 31)]).join('')}`;
    if (s.format === 'seq') return String(random.int(0, 2 ** 40));
    if (typeof s.pattern === 'string') {
      for (let tries = 0; tries < 8; tries++) {
        const text = fromPattern(random, s.pattern, Math.max(4, Math.min(24, max)));
        const length = [...text].length;
        if (length >= min && length <= max) return text;
      }
      return fromPattern(random, s.pattern, 8);
    }
    return word(min, max);
  };
  const number = (s: Schema, whole: boolean): number => {
    const min = typeof s.minimum === 'number' ? s.minimum : (typeof s.maximum === 'number' ? Math.min(0, s.maximum) : 0);
    const max = typeof s.maximum === 'number' ? s.maximum : min + 1000;
    const hi = Math.min(max, min + 100_000);
    if (whole) return random.int(Math.ceil(min), Math.floor(hi));
    const value = min + random.next() * (hi - min);
    return Math.round(value * 1000) / 1000;
  };
  const node = (schema: Schema): JsonValue => {
    const s = resolve(schema);
    if ('x-opaque' in s) return opaque();
    if ('const' in s) return s.const as JsonValue;
    if (Array.isArray(s.oneOf)) return node(random.pick(s.oneOf as Schema[]));
    let type = s.type;
    if (Array.isArray(type)) {
      if (random.chance(0.3)) return null;
      type = type.find((t) => t !== 'null');
    }
    switch (type) {
      case 'string': return string(s);
      case 'integer': return number(s, true);
      case 'number': return number(s, false);
      case 'boolean': return random.chance(0.5);
      case 'array': {
        const min = typeof s.minItems === 'number' ? s.minItems : 0;
        const max = typeof s.maxItems === 'number' ? s.maxItems : min + 2;
        return Array.from({ length: random.int(min, Math.min(max, min + 2)) }, () => node(s.items as Schema));
      }
      case 'object': {
        if (isObject(s.properties)) {
          const required = new Set(Array.isArray(s.required) ? s.required.map(String) : []);
          const out: { [k: string]: JsonValue } = {};
          for (const [key, child] of Object.entries(s.properties)) if (required.has(key) || random.chance(0.6)) out[key] = node(child as Schema);
          return out;
        }
        const out: { [k: string]: JsonValue } = {};
        const keys = random.int(0, 2);
        const pattern = String((s.propertyNames as Schema).pattern);
        for (let k = 0; k < keys; k++) out[fromPattern(random, pattern, 10)] = node(s.additionalProperties as Schema);
        return out;
      }
      default: return null;
    }
  };
  return node(root);
}

interface Site { kind: MutationKind; path: string; mutate(copy: JsonValue): JsonValue }

/** Every place in an instance a mutation can plant, found by walking the value beside its schema. */
function sites(root: Schema, value: JsonValue): Site[] {
  const defs = isObject(root.$defs) ? root.$defs : {};
  const resolve = (node: Schema): Schema => (typeof node.$ref === 'string' ? resolve(defs[node.$ref.replace(/^#\/\$defs\//, '')] as Schema) : node);
  const found: Site[] = [];
  const parentOf = (copy: JsonValue, path: string): { [k: string]: JsonValue } | JsonValue[] => {
    let at: JsonValue = copy;
    for (const key of path === '' ? [] : path.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))) at = Array.isArray(at) ? at[Number(key)]! : (at as { [k: string]: JsonValue })[key]!;
    return at as { [k: string]: JsonValue } | JsonValue[];
  };
  const set = (copy: JsonValue, path: string, next: JsonValue | undefined): JsonValue => {
    if (path === '') return next as JsonValue;
    const keys = path.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
    const last = keys.pop()!;
    const parent = parentOf(copy, keys.length ? `/${keys.map((k) => k.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}` : '');
    if (Array.isArray(parent)) parent[Number(last)] = next as JsonValue;
    else if (next === undefined) delete parent[last];
    else parent[last] = next;
    return copy;
  };
  const walk = (schema: Schema, v: JsonValue, path: string): void => {
    const s = resolve(schema);
    if ('x-opaque' in s || 'const' in s) return;
    if (Array.isArray(s.oneOf)) {
      const branch = (s.oneOf as Schema[]).map(resolve).find((b) => isObject(b.properties) && isObject(v) && Object.entries(b.properties).some(([k, p]) => isObject(p) && 'const' in p && v[k] === p.const));
      if (branch) walk(branch, v, path);
      return;
    }
    if (v === null) return;
    const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type;
    if (type === 'string' && typeof v === 'string' && Array.isArray(s.enum)) {
      found.push({ kind: 'enum_off_list', path, mutate: (copy) => set(copy, path, `${v}_off_list`) });
    } else if ((type === 'integer' || type === 'number') && typeof v === 'number' && (typeof s.minimum === 'number' || typeof s.maximum === 'number')) {
      const past = typeof s.maximum === 'number' && s.maximum < MAX_SAFE ? s.maximum + 1 : typeof s.minimum === 'number' && s.minimum > -MAX_SAFE ? s.minimum - 1 : undefined;
      if (past !== undefined) found.push({ kind: 'number_past_range', path, mutate: (copy) => set(copy, path, past) });
    } else if (type === 'array' && Array.isArray(v)) {
      v.forEach((item, i) => walk(s.items as Schema, item, path + segment(i)));
    } else if (type === 'object' && isObject(v)) {
      if (isObject(s.properties)) {
        const required = Array.isArray(s.required) ? s.required.map(String).filter((k) => Object.hasOwn(v, k)) : [];
        for (const key of required) found.push({ kind: 'required_removed', path: path + segment(key), mutate: (copy) => set(copy, path + segment(key), undefined) });
        if (s.additionalProperties === false) {
          let name = 'planted_unknown';
          while (Object.hasOwn(s.properties, name)) name = `${name}_`;
          found.push({ kind: 'unknown_field', path: path + segment(name), mutate: (copy) => set(copy, path + segment(name), 'planted') });
        }
        for (const [key, child] of Object.entries(v)) if (Object.hasOwn(s.properties, key)) walk(s.properties[key] as Schema, child, path + segment(key));
      } else if (isObject(s.additionalProperties)) {
        for (const [key, child] of Object.entries(v)) walk(s.additionalProperties as Schema, child, path + segment(key));
      }
    }
  };
  walk(root, value, '');
  return found;
}

/**
 * `cases` draws of valid instances from `seed`, each with one mutation: the kinds the instance affords take
 * turns across the draws, so every kind the schema affords is drawn about cases / kinds times.
 */
const KINDS = ['required_removed', 'enum_off_list', 'number_past_range', 'unknown_field'] as const;

export function draw(schema: Schema, seed: number, cases: number): Drawn[] {
  const random = new Random(seed);
  const check = registry([{ name: 'drawn@1', schema }]);
  const out: Drawn[] = [];
  for (let i = 0; i < cases; i++) {
    let valid: JsonValue | undefined;
    let last = '';
    for (let tries = 0; tries < 32 && valid === undefined; tries++) {
      const candidate = instanceOf(random, schema);
      const result = check.validate('drawn@1', candidate);
      if (result.ok) valid = candidate;
      else last = JSON.stringify(result.issues.map((issue) => `${issue.code} ${issue.path}`));
    }
    if (valid === undefined) throw Error(`seed ${seed}, draw ${i}: no valid instance in 32 tries; last refusal ${last}`);
    const found = sites(schema, valid);
    const kinds = KINDS.filter((kind) => found.some((s) => s.kind === kind));
    const mutations: Mutation[] = [];
    if (kinds.length) {
      const kind = kinds[i % kinds.length]!;
      const site = random.pick(found.filter((s) => s.kind === kind));
      mutations.push({ kind, path: site.path, code: CODE_OF[kind], value: site.mutate(structuredClone(valid)) });
    }
    out.push({ valid, mutations });
  }
  return out;
}
