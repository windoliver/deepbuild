// #138.230a6b92, blind redraft (issue #3648) of manifest.test.ts's "each fixture holds a document and a sidecar of
// known keys, ..." test. Same surfaces: the `manifest` and `kit` calls and the `test-kit-formula` build
// (../138/README.md). What changed: a check's keys are no longer closed at the nine common Check input fields.
// The design gives every check kind fields of its own beside them (canvas-primitives.md, "Check input" and every
// "Check input: ..." section), so a key belongs to a check when it is a common field or a field of the check's
// own kind: the core's kinds are held to the fields the design lists for them, and any other kind's own field
// must run, in the kit, as that kind's input without failing (an unknown field is refused, technical-design.md,
// "Generated edges and exact issues"). See DISPUTE.md.
import { describe, expect, it } from 'vitest';
import {
  MANIFEST, arr, isObject, kit, obj, run, scenario, show, str, strs, useBuilds, useEvidence,
  type Build, type JsonObject, type JsonValue,
} from '../138/helpers.ts';

const FULL: Build = { set: 'full' };
const FORMULA: Build = { set: 'full', with: ['test-kit-formula'] };
const builds = useBuilds([FULL, FORMULA]);
const evidence = useEvidence();

/** The sidecar's keys, and no others (README: Calls added, Sidecar). */
const SIDECAR_KEYS = ['checks', 'oracles', 'covers', 'codes', 'twin', 'expected_from', 'criteria', 'inputs', 'at_times'];
/** The one input shape every document check shares (canvas-primitives.md, Check input: Fields). */
const COMMON = ['kind', 'probe', 'at_times', 'expect', 'tolerance', 'except', 'render', 'sweeps', 'declared_cuts'];
/** The core's own kinds and the fields the design adds to them (Check input; Check input: loop kinds, Extended kinds). */
const CORE_KINDS: Record<string, string[]> = {
  'document.validate': ['assets'], 'document.budget': ['lod'], 'document.frame_time': [], 'document.layout': [],
  'document.determinism': [], 'geometry.audit': [], 'film.audit': [], 'film.flicker': [], 'film.layout': [],
  honest_numbers: [], kind_rules: [],
};
/** Sidecar-level keys that decide a verdict there; inside a check they'd be a second source no scan reads. */
const SIDECAR_ONLY = ['oracle', 'oracles', 'covers', 'codes', 'twin', 'expected_from', 'criteria'];
const RENDER_KEYS = ['seconds', 'pixels', 'theme', 'reduced_motion', 'widths'];
const TOLERANCE_KEYS = ['within', 'on', 'ceiling', 'window', 'reason'];
const EXPECTED_FROM = ['analytic', 'upstream', 'issue', 'second_implementation'];
/** A may-fail mark, as a key or a value: no fixture may be marked may-fail, and only your decision waives one. */
const MAY_FAIL_KEY = /^(may_?fail|xfail|expected_?failure|allow_?fail(ure)?|known_?failure|skip(ped)?|flaky|waive[dr]?|must_pass)$/i;
const MAY_FAIL_TEXT = /\bmay[-_ ]?fail\b|\bxfail\b/i;
/** What a formula or code looks like in a string: operators, calls, blocks, assignments, keywords. */
const FORMULA_TEXT = /[(){};=^*+]|=>|\b(fn|function|return|let|const|var|lambda)\b/;
/** Prose fields a reader writes for people; the formula scan skips them. */
const PROSE = new Set(['reason', 'what', 'description', 'title', 'name']);

/** Every key and every non-prose string in a value, with its path. */
function walk(value: JsonValue, path: string, keys: [string, string][], texts: [string, string][]): void {
  if (typeof value === 'string') texts.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}/${i}`, keys, texts));
  else if (isObject(value)) for (const [k, v] of Object.entries(value)) {
    keys.push([`${path}/${k}`, k]);
    if (!PROSE.has(k)) walk(v, `${path}/${k}`, keys, texts);
  }
}

function manifestOf(build: Build): JsonObject {
  const [m] = run(builds.bin(build), scenario(evidence(), [MANIFEST]));
  return m!;
}

interface Scan { problems: string[]; ownKeys: Map<string, string[]>; modules: Set<string> }

/** Holds every manifest fixture's sidecar to the criterion; `ownKeys` lists, per fixture, keys its checks' own kinds hold. */
function scan(m: JsonObject): Scan {
  const kinds = new Set(strs(m['check_kinds'], 'manifest.check_kinds'));
  const oracles = new Set(strs(m['oracles'], 'manifest.oracles'));
  for (const o of ['analytic', 'cpu_reference', 'golden', 'reftest']) expect(oracles.has(o), `the closed oracle list names ${o}`).toBe(true);
  for (const k of ['document.validate', 'document.budget', 'kind_rules']) expect(kinds.has(k), `the check kinds hold the core's ${k}`).toBe(true);
  const problems: string[] = [];
  const ownKeys = new Map<string, string[]>();
  const modules = new Set<string>();
  for (const f of arr(m['fixtures'], 'manifest.fixtures').map((x, i) => obj(x, `fixtures[${i}]`))) {
    const name = str(f['name'], 'fixture.name');
    modules.add(str(f['module'], `${name}: module`));
    if (f['profile'] !== 'scene') {
      const d = obj(f['document'], `${name}: document`);
      if (typeof d['format'] !== 'number' || !isObject(d['items'])) problems.push(`${name}: its document has no format or items`);
    }
    const sidecar = obj(f['sidecar'], `${name}: sidecar`);
    for (const k of Object.keys(sidecar)) if (!SIDECAR_KEYS.includes(k)) problems.push(`${name}: sidecar key ${k} is no sidecar key`);
    for (const [i, c] of arr(sidecar['checks'] ?? [], `${name}: checks`).entries()) {
      const check = obj(c, `${name}: checks[${i}]`);
      const kind = String(check['kind']);
      if (!kinds.has(kind)) problems.push(`${name}: checks[${i}] kind ${kind} is no existing check kind`);
      for (const k of Object.keys(check)) {
        if (COMMON.includes(k)) continue;
        if (SIDECAR_ONLY.includes(k)) problems.push(`${name}: checks[${i}] key ${k} belongs to the sidecar, not a check`);
        else if (kind in CORE_KINDS) { if (!CORE_KINDS[kind]!.includes(k)) problems.push(`${name}: checks[${i}] key ${k} is no field of the core's ${kind}`); }
        else if (!/^[a-z][a-z0-9_]*$/.test(k)) problems.push(`${name}: checks[${i}] key ${JSON.stringify(k)} is no field name`);
        else ownKeys.set(name, [...(ownKeys.get(name) ?? []), `checks[${i}].${k} (${kind})`]);
      }
      if (isObject(check['render'])) for (const k of Object.keys(check['render'])) if (!RENDER_KEYS.includes(k)) problems.push(`${name}: checks[${i}] render key ${k}`);
      const tol = check['tolerance'];
      if (isObject(tol) && ('within' in tol || 'on' in tol)) {
        for (const k of Object.keys(tol)) if (!TOLERANCE_KEYS.includes(k)) problems.push(`${name}: checks[${i}] tolerance key ${k}`);
        if (isObject(tol['window'])) for (const k of Object.keys(tol['window'])) if (!['size', 'off'].includes(k)) problems.push(`${name}: checks[${i}] tolerance.window key ${k}`);
      }
    }
    for (const o of strs(sidecar['oracles'] ?? [], `${name}: oracles`)) if (!oracles.has(o)) problems.push(`${name}: oracle ${o} is off the closed list`);
    if (sidecar['expected_from'] !== undefined && !EXPECTED_FROM.includes(String(sidecar['expected_from']))) problems.push(`${name}: expected_from ${String(sidecar['expected_from'])}`);
    const keys: [string, string][] = [];
    const texts: [string, string][] = [];
    walk(sidecar, '', keys, texts);
    for (const [path, k] of keys) if (MAY_FAIL_KEY.test(k)) problems.push(`${name}: sidecar${path} marks it may-fail`);
    for (const [path, text] of texts) {
      if (MAY_FAIL_TEXT.test(text)) problems.push(`${name}: sidecar${path} marks it may-fail: ${JSON.stringify(text)}`);
      if (FORMULA_TEXT.test(text)) problems.push(`${name}: sidecar${path} holds a formula or code: ${JSON.stringify(text)}`);
    }
  }
  return { problems, ownKeys, modules };
}

describe('#138.230a6b92 every fixture is a document with a sidecar of existing check kinds and named oracles, and no sidecar holds a formula or code', () => {
  it('#138.230a6b92 each fixture holds a document and a sidecar of sidecar keys, existing check kinds with their common and own fields, listed oracles, no formula or code, and no may-fail mark', () => {
    const s = scan(manifestOf(FULL));
    expect(s.problems, show(s.problems, 4000)).toEqual([]);
    if (s.ownKeys.size === 0) return;
    // A kind's own field belongs only if the kit, running the check as that kind's input, takes it.
    const r = kit(builds.bin(FULL), evidence(), { modules: [...s.modules], parts: ['fixtures'] });
    const cases = r.modules.flatMap((m) => m.parts.filter((p) => p.part === 'fixtures').flatMap((p) => p.cases));
    for (const [name, keys] of s.ownKeys) {
      const mine = cases.filter((c) => c.fixture === name);
      expect(mine.length, `${name}: the kit ran the checks that carry ${keys.join(', ')}`).toBeGreaterThan(0);
      const bad = mine.filter((c) => c.verdict === 'FAIL' || c.verdict === 'INVALID');
      expect(bad.map((c) => [c.case, c.verdict, c.failure]), `${name}: its checks with ${keys.join(', ')} ran as their kinds' input without failing`).toEqual([]);
    }
  }, 1_800_000);

  it('#138.230a6b92 the same scan catches test.kit.formula\'s formula, made-up check kind and unlisted oracle, naming each fixture, and nothing else', () => {
    const { problems } = scan(manifestOf(FORMULA));
    const at = (fixture: string): string[] => problems.filter((p) => p.startsWith(`${fixture}: `));
    const caught = (fixture: string, re: RegExp, what: string): void =>
      expect(at(fixture).some((p) => re.test(p)), `${fixture}: ${what} is caught; problems: ${show(problems, 2000)}`).toBe(true);
    caught('parity/kernel/formula-expect.board', /sidecar\/checks\/\d+\/expect(\/\S*)? holds a formula or code: "box\.w \* 2 \+ 1"/, 'its check\'s expect "box.w * 2 + 1", a formula,');
    caught('parity/kernel/formula-kind.board', /checks\[\d+\] kind test\.kit\.formula\.made_up is no existing check kind/, 'check kind test.kit.formula.made_up');
    caught('parity/kernel/formula-oracle.board', /oracle eyeball is off the closed list/, 'oracle eyeball');
    const others = problems.filter((p) => !/^parity\/kernel\/formula-(expect|kind|oracle)\.board: /.test(p));
    expect(others, `no fixture but the three planted ones has a problem: ${show(others, 2000)}`).toEqual([]);
  }, 600_000);
});
