import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** The checkout root (tests/acceptance/389 is three levels down) and the binary the tests drive. */
export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const BIN = join(REPO, 'target', 'debug', process.platform === 'win32' ? 'deep-canvas.exe' : 'deep-canvas');
export const LINT = join(REPO, 'scripts', 'canvas-lint.mjs');

export function fixture<T = JsonValue>(name: string): T {
  return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8')) as T;
}

export function sha256(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

export function clone<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Builds the binary; returns '' or the build's error text. The build is cached between files. */
export function buildBinary(): string {
  const run = spawnSync('cargo', ['build', '--locked', '-p', 'deep-canvas', '--bin', 'deep-canvas'], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo build -p deep-canvas failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting/.test(l)).join('\n')}`;
}

/** Builds the binary once per file and fails every test of the file, not just the hook, when it can't be built. */
export function useBinary(): void {
  let error = '';
  beforeAll(() => { error = buildBinary(); }, 600_000);
  beforeEach(() => { expect(error, 'the deep-canvas binary builds').toBe(''); });
}

/** Pipes every input line into one run of `deep-canvas <args>` and returns one parsed JSON value per line. */
export function batch(args: string[], inputs: JsonValue[]): JsonValue[] {
  const run = spawnSync(BIN, args, {
    input: `${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  if (run.error) throw Error(`deep-canvas ${args.join(' ')}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`deep-canvas ${args.join(' ')} exited ${run.status}:\n${run.stderr}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `deep-canvas ${args.join(' ')}: one output line per input line`).toBe(inputs.length);
  return lines.map((line) => JSON.parse(line) as JsonValue);
}

export function one(args: string[], input: JsonValue): JsonObject {
  const out = batch(args, [input])[0];
  expect(typeof out === 'object' && out !== null && !Array.isArray(out), `deep-canvas ${args.join(' ')}: an object per line`).toBe(true);
  return out as JsonObject;
}

// ---------------------------------------------------------------------------------------------------
// A seeded PRNG of this file's own: splitmix32 seeds four xorshift128 words. Fixed seeds live below.

export const SEEDS = { time: 0x3891_0001, unit: 0x3891_0002, path: 0x3891_0003, handle: 0x3891_0004, id: 0x3891_0005, mutate: 0x3891_0006, permute: 0x3891_0007 } as const;

export class Rng {
  private a: number; private b: number; private c: number; private d: number;
  constructor(seed: number) {
    let s = seed >>> 0;
    const next = (): number => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next(); this.b = next(); this.c = next(); this.d = next() | 1;
  }
  /** A 32-bit unsigned integer. */
  u32(): number {
    let t = this.d;
    const s = this.a;
    this.d = this.c; this.c = this.b; this.b = s;
    t ^= t << 11; t ^= t >>> 8;
    this.a = (t ^ s ^ (s >>> 19)) >>> 0;
    return this.a;
  }
  /** An integer in [0, n). */
  below(n: number): number { return this.u32() % n; }
  /** An integer in [lo, hi]. */
  range(lo: number, hi: number): number { return lo + this.below(hi - lo + 1); }
  pick<T>(items: readonly T[]): T {
    const item = items[this.below(items.length)];
    if (item === undefined) throw Error('pick from an empty list');
    return item;
  }
  chance(p: number): boolean { return this.u32() / 4294967296 < p; }
}

// ---------------------------------------------------------------------------------------------------
// Exact rationals over bigint, for the reference evaluator.

export interface Rational { num: bigint; den: bigint }

function gcd(a: bigint, b: bigint): bigint { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { [a, b] = [b, a % b]; } return a; }
export function rational(num: bigint, den = 1n): Rational {
  if (den === 0n) throw Error('zero denominator');
  if (den < 0n) { num = -num; den = -den; }
  const g = gcd(num, den) || 1n;
  return { num: num / g, den: den / g };
}
export function mul(x: Rational, y: Rational): Rational { return rational(x.num * y.num, x.den * y.den); }
/** The rational a decimal text names: "-12.50" is -1250/100. */
export function decimal(text: string): Rational {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw Error(`not a decimal: ${text}`);
  const digits = (m[2] ?? '') + (m[3] ?? '');
  const scale = 10n ** BigInt((m[3] ?? '').length);
  const value = rational(BigInt(digits), scale);
  return m[1] === '-' ? rational(-value.num, value.den) : value;
}
export function sameRational(x: Rational, y: Rational): boolean { return x.num === y.num && x.den === y.den; }
export function printRational(x: Rational): string { return x.den === 1n ? `${x.num}` : `${x.num}/${x.den}`; }

export const FLICKS_PER_SECOND = 705_600_000n;

// ---------------------------------------------------------------------------------------------------
// Generators and printers, one per grammar. Each generator draws a canonical text (what the printer
// writes), so a round trip must give the same text back, and gives the value the reference computes.

export type Grammar = 'time' | 'unit' | 'path' | 'handle' | 'id';
export const GRAMMARS: readonly Grammar[] = ['time', 'unit', 'path', 'handle', 'id'];
/** The code each grammar's refusal carries. A path can also fail on the ID it holds. */
export const REFUSAL_CODES: Record<Grammar, readonly string[]> = {
  time: ['bad_time'], unit: ['bad_unit'], path: ['bad_path', 'bad_id'], handle: ['bad_handle'], id: ['bad_id'],
};

export interface Case { input: JsonObject; printed: string; value: JsonValue }

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const ID_FIRST = LOWER + DIGITS;
const ID_REST = LOWER + DIGITS + '_-';

function chars(rng: Rng, alphabet: string, n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += alphabet[rng.below(alphabet.length)];
  return out;
}
function digitsText(rng: Rng, maxDigits: number): string {
  const n = rng.range(1, maxDigits);
  if (n === 1) return chars(rng, DIGITS, 1);
  return chars(rng, '123456789', 1) + chars(rng, DIGITS, n - 1);
}
/** A fraction of 1 to `max` digits with no trailing zero. */
function fractionText(rng: Rng, max: number): string {
  const n = rng.range(1, max);
  return (n === 1 ? '' : chars(rng, DIGITS, n - 1)) + chars(rng, '123456789', 1);
}

export function genId(rng: Rng): string {
  const segments = rng.chance(0.6) ? 1 : rng.range(2, 8);
  const parts: string[] = [];
  for (let i = 0; i < segments; i++) {
    const length = rng.chance(0.9) ? rng.range(1, 12) : rng.range(13, 48);
    parts.push(chars(rng, ID_FIRST, 1) + chars(rng, ID_REST, length - 1));
  }
  return parts.join('.');
}
export function idCase(rng: Rng): Case {
  const text = genId(rng);
  return { input: { text }, printed: text, value: { segments: text.split('.') } };
}

/** Valid frame rates (p/q) whose frame is a whole number of flicks. */
export const VALID_RATES: readonly [number, number][] = [[24, 1], [25, 1], [30, 1], [48, 1], [50, 1], [60, 1], [120, 1], [24000, 1001], [30000, 1001], [60000, 1001]];

export function flicksOfSeconds(text: string): bigint {
  const r = mul(decimal(text), rational(FLICKS_PER_SECOND));
  if (r.den !== 1n) throw Error(`${text} s is not a whole number of flicks`);
  return r.num;
}
export function flicksOfFrames(frames: bigint, fps: readonly [number, number]): bigint {
  const r = rational(frames * FLICKS_PER_SECOND * BigInt(fps[1]), BigInt(fps[0]));
  if (r.den !== 1n) throw Error(`frame at ${fps[0]}/${fps[1]} is not a whole number of flicks`);
  return r.num;
}
export function timeCase(rng: Rng): Case {
  const fps = rng.pick(VALID_RATES);
  if (rng.chance(0.5)) {
    const whole = digitsText(rng, 7);
    const text = rng.chance(0.7) ? `${whole}.${fractionText(rng, 5)}s` : `${whole}s`;
    return { input: { text, fps: [fps[0], fps[1]] }, printed: text, value: { flicks: `${flicksOfSeconds(text.slice(0, -1))}` } };
  }
  const frames = digitsText(rng, 8);
  const text = `${frames}f`;
  return { input: { text, fps: [fps[0], fps[1]] }, printed: text, value: { flicks: `${flicksOfFrames(BigInt(frames), fps)}` } };
}

/** The unit families a field declares, with each unit's exact factor into the field's unit. */
export const UNIT_FAMILIES: Record<string, Record<string, Rational>> = {
  m: { m: rational(1n), cm: rational(1n, 100n), mm: rational(1n, 1000n), km: rational(1000n) },
  u: { u: rational(1n) },
  deg: { deg: rational(1n), turn: rational(360n) },
};
export const FIELD_UNITS = Object.keys(UNIT_FAMILIES);
export function unitCase(rng: Rng): Case {
  const field = rng.pick(FIELD_UNITS);
  const family = UNIT_FAMILIES[field]!;
  const sign = rng.chance(0.2) ? '-' : '';
  const whole = digitsText(rng, 6);
  const number = rng.chance(0.6) ? `${whole}.${fractionText(rng, 6)}` : whole;
  const suffix = rng.chance(0.75) ? rng.pick(Object.keys(family)) : '';
  const printed = `${sign}${number}${suffix}`;
  const value = mul(decimal(`${sign}${number}`), suffix === '' ? rational(1n) : family[suffix]!);
  return { input: { text: printed, unit: field }, printed, value: { num: `${value.num}`, den: `${value.den}` } };
}

export const HANDLE_SCHEMES = ['task', 'ask', 'claim', 'verdict', 'run', 'req', 'decision', 'plan', 'lease', 'reading', 'notice', 'doc', 'ev', 'session'] as const;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function genUlid(rng: Rng): string { return chars(rng, '01234567', 1) + chars(rng, CROCKFORD, 25); }
export function genHex64(rng: Rng): string { return chars(rng, '0123456789abcdef', 64); }
const FRAG_FIRST = LOWER + LOWER.toUpperCase() + DIGITS;
const FRAG_REST = FRAG_FIRST + '_.-';
export function handleCase(rng: Rng): Case {
  const scheme = rng.pick(HANDLE_SCHEMES);
  const id = rng.chance(0.7) ? genUlid(rng) : genHex64(rng);
  const fragment = rng.chance(0.5) ? chars(rng, FRAG_FIRST, 1) + chars(rng, FRAG_REST, rng.range(0, 11)) : null;
  const printed = fragment === null ? `${scheme}:${id}` : `${scheme}:${id}#${fragment}`;
  const value: JsonObject = { scheme, id };
  if (fragment !== null) value['fragment'] = fragment;
  return { input: { text: printed }, printed, value };
}

export const SECTIONS = ['items', 'controls', 'channels', 'markers', 'data', 'inputs', 'assemblies'] as const;
const SUB_FIRST = LOWER + DIGITS;
const SUB_REST = SUB_FIRST + '_.-';
const FIELD_FIRST = LOWER + DIGITS + '_';
const FIELD_REST = FIELD_FIRST + '-';
export function pathCase(rng: Rng): Case {
  const section = rng.pick(SECTIONS);
  const id = genId(rng);
  const sub = rng.chance(0.25) ? chars(rng, SUB_FIRST, 1) + chars(rng, SUB_REST, rng.range(0, 7)) : null;
  const fields: string[] = [];
  const n = rng.range(1, 4);
  for (let i = 0; i < n; i++) {
    fields.push(rng.chance(0.3) ? `${rng.below(10)}` : chars(rng, FIELD_FIRST, 1) + chars(rng, FIELD_REST, rng.range(0, 9)));
  }
  const printed = `${section}/${id}${sub === null ? '' : `#${sub}`}/${fields.join('/')}`;
  return { input: { text: printed }, printed, value: { section, id, sub, fields } };
}

export const GENERATORS: Record<Grammar, (rng: Rng) => Case> = { time: timeCase, unit: unitCase, path: pathCase, handle: handleCase, id: idCase };

// ---------------------------------------------------------------------------------------------------
// Mutations that leave each grammar. Every one is outside the grammar as the README defines it.

function splice(text: string, rng: Rng, insert: string): string {
  const at = rng.range(0, text.length);
  return text.slice(0, at) + insert + text.slice(at);
}
const BAD_CHARS = ['/', '#', ':', '@', '~', ' ', 'A', 'é', '.', '\t', '"', '\\'];

export function mutateId(text: string, rng: Rng): string {
  switch (rng.below(8)) {
    case 0: return splice(text, rng, rng.pick(['/', '#', ':', '@', '~', ' ', 'é']));
    case 1: { const at = rng.below(text.length); const c = text[at] ?? 'a'; return /[a-z]/.test(c) ? text.slice(0, at) + c.toUpperCase() + text.slice(at + 1) : `${text}.A`; }
    case 2: return `${rng.pick(['-', '_'])}${text}`;
    case 3: return rng.pick([`.${text}`, `${text}.`, text.includes('.') ? text.replace('.', '..') : `${text}..x`]);
    case 4: return `${text}.${'s.'.repeat(8)}x`;
    case 5: return `${text.split('.')[0]}${'x'.repeat(49)}`;
    case 6: return '';
    default: return `${text}.`;
  }
}
export function mutateTime(text: string, rng: Rng): string {
  const number = text.slice(0, -1);
  const unit = text.slice(-1);
  switch (rng.below(14)) {
    case 0: return number;
    case 1: return `${number}${unit.toUpperCase()}`;
    case 2: return `${number}${rng.pick(['sec', 'ms', 'fr', 'fps', 'ss', 'ff', 'sf'])}`;
    case 3: return unit === 'f' ? `${number}.5f` : `${number}.s`;
    case 4: return number.includes('.') ? `${number.replace('.', '..')}${unit}` : `${number}..5${unit}`;
    case 5: return `.${number.split('.')[1] ?? '5'}${unit}`;
    case 6: return `0${text}`;
    case 7: return `${number.includes('.') ? number : `${number}.`}${'7'.repeat(6)}${unit}`;
    case 8: return rng.pick(['', unit, ' ', `${unit}${number}`]);
    case 9: return `${number} ${unit}`;
    case 10: return `${text}${rng.pick(['x', ' ', '0', 's'])}`;
    case 11: return `${rng.pick(['+', '-'])}${text}`;
    case 12: return `${number}e1${unit}`;
    default: return splice(text, rng, rng.pick(BAD_CHARS));
  }
}
export function mutateUnit(text: string, field: string, rng: Rng): string {
  const m = /^(-?\d+(?:\.\d+)?)([a-z]*)$/.exec(text);
  const number = m?.[1] ?? '1';
  const unit = m?.[2] ?? '';
  const family = Object.keys(UNIT_FAMILIES[field]!);
  const others = FIELD_UNITS.filter((f) => f !== field).flatMap((f) => Object.keys(UNIT_FAMILIES[f]!));
  switch (rng.below(13)) {
    case 0: return `${number}${rng.pick(others)}`;
    case 1: return `${number}${rng.pick(['ft', 'pt', 'xx', 'inch', 'mmm', 'uu', 'degs', 'rad'])}`;
    case 2: return `${number}${rng.pick(family)} ${rng.pick(family)}`;
    case 3: return `${number}  ${rng.pick(family)}`;
    case 4: return rng.pick([` ${text}`, `${text} `]);
    case 5: return `${number.replace('.', ',')}${unit}` === text ? `${number},5${unit}` : `${number.replace('.', ',')}${unit}`;
    case 6: return `${number.includes('.') ? number.split('.')[0] : number}.${unit}`;
    case 7: return `.${number.split('.')[1] ?? '5'}${unit}`;
    case 8: return `${number}e2${unit}`;
    case 9: return `${rng.pick(['--', '+', '- '])}${number.replace('-', '')}${unit}`;
    case 10: return `${number}${(unit || rng.pick(family)).toUpperCase()}`;
    case 11: return rng.pick(['', unit || rng.pick(family), `${number}${unit || rng.pick(family)}5`, 'nan', 'inf']);
    default: return splice(text, rng, rng.pick(['/', '#', ':', '@', '~', 'é', '"']));
  }
}
export function mutateHandle(text: string, rng: Rng): string {
  const colon = text.indexOf(':');
  const scheme = text.slice(0, colon);
  const rest = text.slice(colon + 1);
  const hash = rest.indexOf('#');
  const id = hash < 0 ? rest : rest.slice(0, hash);
  switch (rng.below(12)) {
    case 0: return `${rng.pick(['url', 'http', 'tasks', 'item', 'docs', 'evt', 'session1'])}:${rest}`;
    case 1: return `${scheme[0]!.toUpperCase()}${scheme.slice(1)}:${rest}`;
    case 2: return `${scheme}${rest}`;
    case 3: return `${scheme}:`;
    case 4: return `${scheme}:${id.length === 26 ? id.slice(1) : id.slice(1)}${hash < 0 ? '' : rest.slice(hash)}`;
    case 5: return `${scheme}:${id.length === 26 ? `${id.slice(0, 10)}${rng.pick(['I', 'L', 'O', 'U'])}${id.slice(11)}` : `${id.slice(0, 10)}${rng.pick(['g', 'z', 'G', 'A'])}${id.slice(11)}`}${hash < 0 ? '' : rest.slice(hash)}`;
    case 6: return `${scheme}:${id.length === 26 ? `${rng.pick(['8', '9', 'Z'])}${id.slice(1)}` : id.toUpperCase()}`;
    case 7: return `${scheme}:${id.length === 26 ? id.toLowerCase() : `${id}0`}`;
    case 8: return `${scheme}:${id}#`;
    case 9: return `${scheme}:${id}#${rng.pick(['a b', 'a/b', '#x', 'x#y', '.x', '-x'])}`;
    case 10: return rng.pick(['', ':', `:${rest}`, `${scheme}::${rest}`, `${text}:`]);
    default: return splice(text, rng, rng.pick([' ', '/', 'é', '"', '\t']));
  }
}
export function mutatePath(text: string, rng: Rng): string {
  const parts = text.split('/');
  const section = parts[0]!;
  const after = parts.slice(1).join('/');
  const idPart = parts[1]!;
  switch (rng.below(12)) {
    case 0: return `${rng.pick(['item', 'Items', 'layers', 'docs', 'params', 'ITEMS', 'control'])}/${after}`;
    case 1: return `/${after}`;
    case 2: return `${section}//${after.split('/').slice(1).join('/')}`;
    case 3: return `${section}/${idPart}`;
    case 4: return `${text}/`;
    case 5: return `/${text}`;
    case 6: return text.replace(`/${idPart}/`, `/${idPart}//`);
    case 7: return `${section}/${idPart.replace(/#.*$/, '')}#${rng.pick(['', '#x', 'A', 'a b'])}/${parts.slice(2).join('/')}`;
    case 8: { const fields = parts.slice(2); const i = rng.below(fields.length); fields[i] = `${fields[i]!.toUpperCase()}Q`; return `${section}/${idPart}/${fields.join('/')}`; }
    case 9: return `${section}/${mutateId(idPart.replace(/#.*$/, ''), rng).replace(/[/#]/g, '\\')}${idPart.includes('#') ? idPart.slice(idPart.indexOf('#')) : ''}/${parts.slice(2).join('/')}`;
    case 10: return `${section}\\${after}`;
    default: return splice(text, rng, rng.pick([' ', 'é', '"', '\t', '//', '#']));
  }
}

/** A mutation of a valid case that leaves the grammar; `fps`/`unit` stay as the valid case's. */
export function mutate(grammar: Grammar, valid: Case, rng: Rng): JsonObject {
  const text = valid.printed;
  const input: JsonObject = { ...valid.input };
  const mutated = grammar === 'id' ? mutateId(text, rng)
    : grammar === 'time' ? mutateTime(text, rng)
      : grammar === 'unit' ? mutateUnit(text, String(valid.input['unit']), rng)
        : grammar === 'handle' ? mutateHandle(text, rng)
          : mutatePath(text, rng);
  input['text'] = mutated;
  return input;
}

/** Whether a text is inside its grammar as the README defines it (the reference recognizer). */
export function inGrammar(grammar: Grammar, input: JsonObject): boolean {
  const text = String(input['text']);
  const ID = /^[a-z0-9][a-z0-9_-]{0,47}(\.[a-z0-9][a-z0-9_-]{0,47}){0,7}$/;
  switch (grammar) {
    case 'id': return ID.test(text);
    case 'time': return /^(0|[1-9][0-9]*)(\.[0-9]{1,5})?s$/.test(text) || /^(0|[1-9][0-9]*)f$/.test(text);
    case 'unit': {
      const m = /^(-?[0-9]+(?:\.[0-9]+)?) ?([a-z]*)$/.exec(text);
      if (!m) return false;
      const units = Object.keys(UNIT_FAMILIES[String(input['unit'])] ?? {});
      return m[2] === '' || units.includes(m[2]!);
    }
    case 'handle': {
      const m = /^([a-z]+):([0-7][0-9A-HJKMNP-TV-Z]{25}|[0-9a-f]{64})(?:#([A-Za-z0-9][A-Za-z0-9_.-]*))?$/.exec(text);
      return m !== null && (HANDLE_SCHEMES as readonly string[]).includes(m[1]!);
    }
    case 'path': {
      const m = /^([a-z]+)\/([^/#]+)(?:#([a-z0-9][a-z0-9_.-]{0,47}))?((?:\/[a-z0-9_][a-z0-9_-]{0,47})+)$/.exec(text);
      return m !== null && (SECTIONS as readonly string[]).includes(m[1]!) && ID.test(m[2]!);
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Raw JSON: a parse that keeps each number's text, so a difference in float digits names its field.

export type Raw = { kind: 'num'; text: string } | { kind: 'str'; value: string } | { kind: 'lit'; value: 'true' | 'false' | 'null' } | { kind: 'arr'; items: Raw[] } | { kind: 'obj'; entries: [string, Raw][] };

export function parseRaw(text: string): Raw {
  let i = 0;
  const ws = (): void => { while (i < text.length && /\s/.test(text[i]!)) i++; };
  const str = (): string => {
    let out = '';
    i++;
    while (text[i] !== '"') {
      if (i >= text.length) throw Error('unterminated string');
      if (text[i] === '\\') {
        const e = text[i + 1];
        if (e === 'u') { out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16)); i += 6; continue; }
        out += ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' } as Record<string, string>)[e ?? ''] ?? '';
        i += 2;
        continue;
      }
      out += text[i]; i++;
    }
    i++;
    return out;
  };
  const value = (): Raw => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++; ws();
      const entries: [string, Raw][] = [];
      if (text[i] === '}') { i++; return { kind: 'obj', entries }; }
      for (;;) {
        ws(); const key = str(); ws();
        if (text[i] !== ':') throw Error(`expected : at ${i}`);
        i++;
        entries.push([key, value()]);
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return { kind: 'obj', entries }; }
        throw Error(`expected , or } at ${i}`);
      }
    }
    if (c === '[') {
      i++; ws();
      const items: Raw[] = [];
      if (text[i] === ']') { i++; return { kind: 'arr', items }; }
      for (;;) {
        items.push(value()); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return { kind: 'arr', items }; }
        throw Error(`expected , or ] at ${i}`);
      }
    }
    if (c === '"') return { kind: 'str', value: str() };
    const m = /^(true|false|null)/.exec(text.slice(i));
    if (m) { i += m[0].length; return { kind: 'lit', value: m[0] as 'true' | 'false' | 'null' }; }
    const n = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (!n) throw Error(`bad JSON at ${i}: ${text.slice(i, i + 20)}`);
    i += n[0].length;
    return { kind: 'num', text: n[0] };
  };
  const out = value();
  ws();
  if (i !== text.length) throw Error(`trailing text at ${i}`);
  return out;
}

/** The first path (JSON Pointer) where two raw trees differ, numbers by their text, or null. */
export function firstDifference(a: Raw, b: Raw, at = ''): string | null {
  if (a.kind !== b.kind) return at || '/';
  if (a.kind === 'num' && b.kind === 'num') return a.text === b.text ? null : at || '/';
  if (a.kind === 'str' && b.kind === 'str') return a.value === b.value ? null : at || '/';
  if (a.kind === 'lit' && b.kind === 'lit') return a.value === b.value ? null : at || '/';
  if (a.kind === 'arr' && b.kind === 'arr') {
    for (let i = 0; i < Math.max(a.items.length, b.items.length); i++) {
      const x = a.items[i]; const y = b.items[i];
      if (!x || !y) return `${at}/${i}`;
      const d = firstDifference(x, y, `${at}/${i}`);
      if (d) return d;
    }
    return null;
  }
  if (a.kind === 'obj' && b.kind === 'obj') {
    for (let i = 0; i < Math.max(a.entries.length, b.entries.length); i++) {
      const x = a.entries[i]; const y = b.entries[i];
      if (!x || !y) return `${at}/${(x ?? y)![0]}`;
      if (x[0] !== y[0]) return `${at}/${x[0]} (key order: ${y[0]} expected)`;
      const d = firstDifference(x[1], y[1], `${at}/${x[0]}`);
      if (d) return d;
    }
    return null;
  }
  return at || '/';
}

/** Asserts the binary's canonical text equals the fixture's, naming the first field that differs. */
export function expectCanonical(got: string, want: string, label: string): void {
  if (got === want) return;
  let where = '(not JSON)';
  try { where = firstDifference(parseRaw(got), parseRaw(want)) ?? '(same tokens, other bytes)'; } catch { /* keep */ }
  expect(got, `${label}: canonical bytes differ at ${where}`).toBe(want);
}

// ---------------------------------------------------------------------------------------------------
// Documents, issues and patches as the README defines them.

export interface Issue { check: string; code: string; severity: string; ids: string[]; path: string; actual: JsonValue; what: string; fix: JsonValue; forms?: string[] }
export interface Notice { code: string; severity: 'notice'; ids: string[]; path: string; actual: JsonValue; what: string; kind?: string; from?: number; to?: number }
export interface CheckResult { ok: boolean; issues: Issue[]; notices: Notice[]; draws: string[]; lowered: JsonObject }
export interface ApplyResult { outcome: 'applied' | 'refused'; issues: Issue[]; hash: string; doc: JsonObject }

export function check(doc: JsonObject): CheckResult {
  const out = one(['check'], { doc });
  expect(Array.isArray(out['issues']), 'check: issues is a list').toBe(true);
  expect(Array.isArray(out['notices']), 'check: notices is a list').toBe(true);
  return out as unknown as CheckResult;
}
export function apply(doc: JsonObject, writer: string, patches: JsonValue[]): ApplyResult {
  const out = one(['apply'], { doc, writer, patches });
  expect(['applied', 'refused'], 'apply: outcome').toContain(out['outcome']);
  return out as unknown as ApplyResult;
}
export function canonical(doc: JsonObject): { bytes: string; sha256: string } {
  const out = one(['canonical'], { doc });
  return { bytes: String(out['bytes']), sha256: String(out['sha256']) };
}

/** Every issue of a code, or the whole list for a message. */
export function issuesOf(result: { issues: Issue[] }, code: string): Issue[] { return result.issues.filter((i) => i.code === code); }
export function describeIssues(result: { issues: Issue[] }): string { return JSON.stringify(result.issues.map((i) => ({ check: i.check, code: i.code, ids: i.ids, path: i.path }))); }

/** The item IDs of a document, sorted. */
export function itemIds(doc: JsonObject): string[] { return Object.keys((doc['items'] as JsonObject) ?? {}).sort(); }

/** A deep copy with every object's keys shuffled by the seeded PRNG (maps included). */
export function permuteKeys(value: JsonValue, rng: Rng): JsonValue {
  if (Array.isArray(value)) return value.map((v) => permuteKeys(v, rng));
  if (value === null || typeof value !== 'object') return value;
  const keys = Object.keys(value);
  for (let i = keys.length - 1; i > 0; i--) { const j = rng.below(i + 1); [keys[i], keys[j]] = [keys[j]!, keys[i]!]; }
  const out: JsonObject = {};
  for (const key of keys) out[key] = permuteKeys(value[key]!, rng);
  return out;
}
