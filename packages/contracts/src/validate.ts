import { canonicalText } from './canonical.js';
import { ContractError, issue, type ContractIssue } from './errors.js';
import { isObject, resolveRef, segment, unionTag, type JsonValue, type Schema, type SchemaEntry } from './json.js';

export type Validation = { ok: true } | { ok: false; issues: ContractIssue[] };

export interface Registry {
  validate(name: string, value: unknown): Validation;
  /** Parses one JSON text, validates it and turns every `seq` into a bigint. */
  decode<T = unknown>(name: string, json: string): T;
  /** Writes every `seq` back as its decimal string, validates, and returns the RFC 8785 text. */
  encode(name: string, value: unknown): string;
}

const SEQ_MAX = 9223372036854775807n;
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const DECIMAL = /^(0|[1-9][0-9]{0,18})$/;
const isSeq = (text: string): boolean => DECIMAL.test(text) && BigInt(text) <= SEQ_MAX;

/** The listed string formats. `seq` is a canonical decimal string from 0 to 2^63 - 1, a bigint in code. */
export const FORMATS: Readonly<Record<string, (text: string) => boolean>> = { ulid: (text) => ULID.test(text), seq: isSeq };

type Check = (value: unknown, at: string, out: ContractIssue[]) => void;
type Transform = (value: unknown, toWire: boolean) => unknown;

function sameJson(value: unknown, want: string): boolean {
  try {
    return canonicalText(value as JsonValue) === want;
  } catch {
    return false;
  }
}

/**
 * True for a value JSON carries as it is: null, a string, a boolean, a finite number, an array with no
 * holes, or a plain object, all the way down and with no cycle.
 */
const isJson = (value: unknown, depth = 0): boolean => {
  if (depth > 256) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i) || !isJson(value[i], depth + 1)) return false;
    return true;
  }
  if (!isObject(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return (proto === Object.prototype || proto === null) && Object.values(value).every((v) => isJson(v, depth + 1));
};
const tagOf = (branch: Schema, tag: string): string => canonicalText(((branch.properties as Schema)[tag] as Schema).const!);

const num = (schema: Schema, key: string): number | undefined => (typeof schema[key] === 'number' ? schema[key] : undefined);

/** A check for one schema that pushes every refusal, each at the JSON Pointer it names. */
function compile(root: Schema): Check {
  const refs = new Map<string, Check>();
  const node = (schema: Schema): Check => {
    if (typeof schema.$ref === 'string') {
      const ref = schema.$ref;
      let check = refs.get(ref);
      if (!check) {
        let target: Check | undefined;
        check = (value, at, out) => target!(value, at, out);
        refs.set(ref, check);
        target = node(resolveRef(root, ref));
      }
      return check;
    }
    if ('x-opaque' in schema) return (value, at, out) => { if (!isJson(value)) out.push(issue('type', at, value)); };
    if ('const' in schema) {
      const want = canonicalText(schema.const!);
      return (value, at, out) => { if (!sameJson(value, want)) out.push(issue('const', at, value)); };
    }
    if (Array.isArray(schema.oneOf)) return union(schema.oneOf as Schema[]);
    if (Array.isArray(schema.type)) {
      const inner = typed(String(schema.type.find((t) => t !== 'null')), schema);
      return (value, at, out) => { if (value !== null) inner(value, at, out); };
    }
    return typed(String(schema.type), schema);
  };

  const union = (branches: Schema[]): Check => {
    const tag = unionTag(branches);
    const byTag = new Map(branches.map((b) => [tagOf(b, tag), node(b)]));
    const at = segment(tag);
    return (value, path, out) => {
      if (!isObject(value)) return void out.push(issue('type', path, value));
      if (!Object.hasOwn(value, tag)) return void out.push(issue('required', path + at, undefined));
      let branch: Check | undefined;
      try { branch = byTag.get(canonicalText(value[tag]!)); } catch { /* not JSON: no branch */ }
      if (branch) branch(value, path, out);
      else out.push(issue('union', path + at, value[tag]));
    };
  };

  const typed = (type: string, schema: Schema): Check => {
    switch (type) {
      case 'string': {
        const values = Array.isArray(schema.enum) ? new Set(schema.enum) : undefined;
        const pattern = typeof schema.pattern === 'string' ? new RegExp(schema.pattern, 'u') : undefined;
        const format = typeof schema.format === 'string' ? (Object.hasOwn(FORMATS, schema.format) ? FORMATS[schema.format] : () => false) : undefined;
        const min = num(schema, 'minLength');
        const max = num(schema, 'maxLength');
        return (value, at, out) => {
          if (typeof value !== 'string') return void out.push(issue('type', at, value));
          if (values && !values.has(value)) return void out.push(issue('enum', at, value));
          if (format && !format(value)) return void out.push(issue('format', at, value));
          if (pattern && !pattern.test(value)) return void out.push(issue('pattern', at, value));
          if (min !== undefined || max !== undefined) {
            const length = [...value].length;
            if ((min !== undefined && length < min) || (max !== undefined && length > max)) out.push(issue('length', at, value));
          }
        };
      }
      case 'integer':
      case 'number': {
        const min = num(schema, 'minimum');
        const max = num(schema, 'maximum');
        const whole = type === 'integer';
        return (value, at, out) => {
          // An integer is one both languages hold exactly: a JavaScript safe integer.
          if (typeof value !== 'number' || !Number.isFinite(value) || (whole && !Number.isSafeInteger(value))) return void out.push(issue('type', at, value));
          if ((min !== undefined && value < min) || (max !== undefined && value > max)) out.push(issue('range', at, value));
        };
      }
      case 'boolean':
        return (value, at, out) => { if (typeof value !== 'boolean') out.push(issue('type', at, value)); };
      case 'array': {
        const item = node(schema.items as Schema);
        const min = num(schema, 'minItems');
        const max = num(schema, 'maxItems');
        return (value, at, out) => {
          if (!Array.isArray(value)) return void out.push(issue('type', at, value));
          if ((min !== undefined && value.length < min) || (max !== undefined && value.length > max)) out.push(issue('length', at, value));
          for (let i = 0; i < value.length; i++) item(value[i], `${at}/${i}`, out);
        };
      }
      case 'object':
        return isObject(schema.properties) ? record(schema) : map(schema);
      default:
        throw Error(`not a closed node type: ${type}`);
    }
  };

  const record = (schema: Schema): Check => {
    const properties = new Map(Object.entries(schema.properties as Schema).map(([key, s]) => [key, { check: node(s as Schema), at: segment(key) }]));
    const required = ((schema.required ?? []) as string[]).map((key) => ({ key, at: segment(key) }));
    return (value, path, out) => {
      if (!isObject(value)) return void out.push(issue('type', path, value));
      for (const { key, at } of required) if (!Object.hasOwn(value, key)) out.push(issue('required', path + at, undefined));
      for (const key of Object.keys(value)) {
        const property = properties.get(key);
        if (property) property.check(value[key], path + property.at, out);
        else out.push(issue('unlisted_field', path + segment(key), value[key]));
      }
    };
  };

  const map = (schema: Schema): Check => {
    const keys = new RegExp(String((schema.propertyNames as Schema).pattern), 'u');
    const item = node(schema.additionalProperties as Schema);
    return (value, path, out) => {
      if (!isObject(value)) return void out.push(issue('type', path, value));
      for (const key of Object.keys(value)) {
        if (!keys.test(key)) out.push(issue('pattern', path + segment(key), key));
        else item(value[key], path + segment(key), out);
      }
    };
  };

  return node(root);
}

/** Moves every `seq` between its wire form (a decimal string) and a bigint; undefined when a schema has none. */
function seqTransform(root: Schema): Transform | undefined {
  // null while a definition is being built, so a $ref back into it waits for the finished transform.
  const refs = new Map<string, Transform | undefined | null>();
  const node = (schema: Schema): Transform | undefined => {
    if (typeof schema.$ref === 'string') {
      const ref = schema.$ref;
      if (refs.has(ref)) {
        const done = refs.get(ref);
        return done !== null ? done : (value, toWire) => { const f = refs.get(ref); return f ? f(value, toWire) : value; };
      }
      refs.set(ref, null);
      const built = node(resolveRef(root, ref));
      refs.set(ref, built);
      return built;
    }
    if (schema.format === 'seq') {
      return (value, toWire) => (toWire ? (typeof value === 'bigint' ? value.toString() : value)
        : typeof value === 'string' && isSeq(value) ? BigInt(value) : value);
    }
    if (Array.isArray(schema.oneOf)) {
      const branches = schema.oneOf as Schema[];
      const tag = unionTag(branches);
      const byTag = new Map(branches.map((b) => [tagOf(b, tag), node(b)]));
      if ([...byTag.values()].every((b) => !b)) return undefined;
      // Only the branch the value's tag names; validation has already refused any other tag.
      return (value, toWire) => {
        if (!isObject(value) || !Object.hasOwn(value, tag)) return value;
        let branch: Transform | undefined;
        try { branch = byTag.get(canonicalText(value[tag]!)); } catch { /* not JSON: no branch */ }
        return branch ? branch(value, toWire) : value;
      };
    }
    if (isObject(schema.items)) {
      const item = node(schema.items);
      return item && ((value, toWire) => (Array.isArray(value) ? value.map((v) => item(v, toWire)) : value));
    }
    if (isObject(schema.properties)) {
      const fields = Object.entries(schema.properties).flatMap(([key, s]) => {
        const f = node(s as Schema);
        return f ? [[key, f] as const] : [];
      });
      if (!fields.length) return undefined;
      return (value, toWire) => {
        if (!isObject(value)) return value;
        const copy: Record<string, unknown> = { ...value };
        for (const [key, f] of fields) if (Object.hasOwn(copy, key)) copy[key] = f(copy[key], toWire);
        return copy;
      };
    }
    if (isObject(schema.additionalProperties)) {
      const item = node(schema.additionalProperties);
      return item && ((value, toWire) => (isObject(value)
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, item(v, toWire)])) : value));
    }
    return undefined;
  };
  return node(root);
}

export function registry(entries: readonly SchemaEntry[]): Registry {
  const schemas = new Map(entries.map((entry) => [entry.name, entry.schema]));
  const compiled = new Map<string, { check: Check; seq: Transform | undefined }>();
  const get = (name: string) => {
    let found = compiled.get(name);
    if (!found) {
      const schema = schemas.get(name);
      if (!schema) throw new ContractError(issue('unknown_schema', '', name));
      found = { check: compile(schema), seq: seqTransform(schema) };
      compiled.set(name, found);
    }
    return found;
  };
  const validate = (name: string, value: unknown): Validation => {
    const out: ContractIssue[] = [];
    get(name).check(value, '', out);
    return out.length ? { ok: false, issues: out } : { ok: true };
  };
  const refuse = (result: Validation): void => { if (!result.ok) throw new ContractError(result.issues[0]!); };
  return {
    validate,
    decode<T = unknown>(name: string, json: string): T {
      const { seq } = get(name);
      let value: unknown;
      try { value = JSON.parse(json); } catch { throw new ContractError(issue('not_json', '', json)); }
      refuse(validate(name, value));
      return (seq ? seq(value, false) : value) as T;
    },
    encode(name: string, value: unknown): string {
      const { seq } = get(name);
      const wire = seq ? seq(value, true) : value;
      refuse(validate(name, wire));
      return canonicalText(wire as JsonValue);
    },
  };
}
