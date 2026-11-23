// Test-side tools for the #2697 acceptance tests (README: The surfaces under test): the skill as the checkout holds it
// and as `scripts/skill.mjs` generates it, its tokens by the pinned tokenizer, the merge base's craft checks read from
// the merge base's skill (fixtures/base-SKILL.md), `deep-show` built once per file and its `deep_kinds` calls through
// `deep-show run`, the guide's name read from the skill's craft line, the guide read in pages, the check that the guide
// holds each craft check's description, threshold and fix after its name, a copy of the checkout for adding a check
// to craft.json, and the agent eval's recorded film sessions. Nothing here stands in for the skill, the generator,
// deep_kinds or a session: every text judged is the checkout's own or a recording's. Each `...Failures` function is a
// criterion's check: it returns sentences naming what failed, so a test runs it on the program and, where the
// criterion names one, on a planted input (a failure naming what the criterion says).

import { spawnSync } from 'node:child_process';
import { constants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2697 is three levels down). */
export const REPO = realpathSync(join(HERE, '..', '..', '..'));
export const SKILL = join(REPO, 'skills/deepbuild/SKILL.md');
export const CRAFT_JSON = join(REPO, 'crates/deep-canvas/src/craft.json');
/** The merge base's skill, `skills/deepbuild/SKILL.md` at 4aa543da7, copied byte for byte. */
export const BASE_SKILL = join(HERE, 'fixtures/base-SKILL.md');

/** The criteria's tags, as the trace lane computes them from the issue's checkboxes. */
export const AC = {
  ceiling: 'AC1 #2697.588cc8a0',
  guide: 'AC2 #2697.5bf72d0a',
  source: 'AC3 #2697.09d255e9',
  sessions: 'AC4 #2697.1f9af6f6',
  bytes: 'AC5 #2697.2d464f5e',
} as const;

/** "The skill is at most 1,900 tokens by the pinned tokenizer". */
export const CEILING = 1_900;
/** The issue's long timeouts: a cold build of deep-show takes many minutes on a loaded Mac. */
export const TIMEOUT = 3_600_000;

export const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1200): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** At least one failure, one naming every one of `names`, and (with `only`) none that names none of them. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string, only = false): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  expect(failures.some((f) => names.every((n) => f.includes(n))), `${what}: a failure names ${names.join(' and ')}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
  if (only) expect(failures.filter((f) => !names.some((n) => f.includes(n))), `${what}: no failure names anything else`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// The pinned tokenizer: gpt-tokenizer 4.0.0's o200k_base, as packages/hub/src/reply-fit.ts and #2897's suite count.

export const tokens = (text: string): number => countTokens(text);

/** AC1's check: the skill's tokens against the ceiling; its failure names the count. */
export function ceilingFailures(text: string, what: string): string[] {
  const n = tokens(text);
  return n <= CEILING ? [] : [`${what} is ${n} tokens by o200k_base (gpt-tokenizer 4.0.0), over the ceiling of ${CEILING}`];
}

// ---------------------------------------------------------------------------------------------------
// The merge base's craft checks, as the merge base's skill holds them: one line each,
// `- <name>. <description> Threshold — <threshold>. Fix — <fix>` under "## Craft checks a film brief names".

export interface Check { name: string; description: string; threshold: string; fix: string }

export function baseChecks(): Check[] {
  const skill = readFileSync(BASE_SKILL, 'utf8');
  const at = skill.indexOf('\n## Craft checks a film brief names');
  expect(at, 'the merge base\'s skill holds its craft section').toBeGreaterThan(0);
  const out: Check[] = [];
  for (const line of skill.slice(at).split('\n')) {
    const m = /^- ([a-z][a-z0-9_.]*)\. (.+) Threshold — (.+)\. Fix — (.+)$/.exec(line);
    if (m) out.push({ name: m[1]!, description: m[2]!, threshold: m[3]!, fix: m[4]! });
  }
  // The merge base's craft.json lists these sixteen; the section is read, never assumed.
  expect(out.map((c) => c.name), 'the merge base\'s skill states sixteen craft checks').toHaveLength(16);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-show` as #407's and #409's suites build it (the same arguments and environment, so one build serves
// them all), at the path cargo reports. A CARGO_TARGET_DIR in the environment is honoured.

const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full', '--message-format=json-render-diagnostics'];

/** Builds deep-show in `root`: the executable cargo names, or cargo's error. */
export function buildShow(root: string, env: Record<string, string> = {}): { bin: string; error: string } {
  const r = spawnSync('cargo', CARGO_ARGS, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (r.error) return { bin: '', error: `cargo could not run: ${r.error.message}` };
  if (r.status !== 0) {
    const kept = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Locking|Updating/.test(l));
    return { bin: '', error: `cargo ${CARGO_ARGS.join(' ')} failed in ${root}:\n${kept.join('\n').slice(-4000)}` };
  }
  let bin = '';
  for (const line of (r.stdout ?? '').split('\n')) {
    let m: unknown;
    try { m = JSON.parse(line); } catch { continue; }
    if (isObject(m) && m['reason'] === 'compiler-artifact' && isObject(m['target']) && m['target']['name'] === 'deep-show' && typeof m['executable'] === 'string') bin = m['executable'];
  }
  return bin ? { bin, error: '' } : { bin: '', error: 'cargo built deep-show but named no executable for it' };
}

/** Builds the checkout's deep-show once for the file; the getter fails a test, naming the build, when it didn't build. */
export function useShow(): () => string {
  let built = { bin: '', error: 'not built' };
  beforeAll(() => { built = buildShow(REPO); }, 7_200_000);
  return () => {
    expect(built.error, 'deep-show builds').toBe('');
    return built.bin;
  };
}

// ---------------------------------------------------------------------------------------------------
// Folders: each removed after the file.

const made: string[] = [];
export function tempDir(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `deep-2697-${tag}-`)));
  made.push(d);
  return d;
}
export function useCleanup(): void {
  afterAll(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); }, 600_000);
}

// ---------------------------------------------------------------------------------------------------
// `deep_kinds` on `deep-show run`: one scenario line in, one reply per call.

/** The replies to `calls`, in one scenario; `gallery` is a folder of guides and examples read in place of the installed. */
export function kindsReplies(bin: string, calls: JsonObject[], gallery?: string): JsonObject[] {
  const scenario: JsonObject = { evidence: tempDir('ev'), ...(gallery ? { gallery } : {}), calls };
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  expect(r.error, `deep-show run finishes within its timeout: ${r.error?.message ?? ''}`).toBeUndefined();
  expect(r.status, `deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-show run: one output line per scenario').toBe(1);
  const out = JSON.parse(lines[0]!) as JsonValue;
  const replies = isObject(out) ? out['replies'] : undefined;
  expect(isObject(out) && out['ok'] === true && Array.isArray(replies) && replies.length === calls.length, `deep-show run took the scenario: ${show(out, 1500)}`).toBe(true);
  return (replies as JsonValue[]).map((x) => (isObject(x) ? x : { reply: x }));
}

const readGuide = (name: string, offset = 0): JsonObject => ({ call: 'deep_kinds', op: 'read', guide: name, ...(offset ? { offset } : {}) });
const served = (reply: JsonObject | undefined): boolean => !!reply && reply['error'] === undefined && typeof reply['text'] === 'string' && reply['text'] !== '';

/** The skill's lines for craft checks: every line that says "craft". */
export const craftLines = (skill: string): string[] => skill.split('\n').filter((l) => /craft/i.test(l));

/**
 * The names the skill's craft lines could give a guide: every `code` span first, then every word (letters, digits and
 * `_ . @ / -`, trailing punctuation dropped), each once, in the skill's order.
 */
export function candidateNames(skill: string): string[] {
  const lines = craftLines(skill);
  const code = lines.flatMap((l) => [...l.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]!));
  const words = lines.flatMap((l) => [...l.replace(/[`*]/g, ' ').matchAll(/[A-Za-z0-9][A-Za-z0-9_.@/-]*/g)].map((m) => m[0].replace(/[.\-/]+$/, '')));
  return [...new Set([...code, ...words].filter((w) => w !== ''))];
}

/**
 * The guide the skill names (README: The guide's name): of the names its craft lines give, the first that `deep_kinds
 * {op: read, guide: <name>}` serves text for; `failure` when none does.
 */
export function guideName(bin: string, skill: string, gallery?: string): { name?: string; failure?: string } {
  const lines = craftLines(skill);
  if (!lines.length) return { failure: 'the skill has no line for craft checks: no line says "craft"' };
  const names = candidateNames(skill);
  const replies = kindsReplies(bin, names.map((n) => readGuide(n)), gallery);
  const at = replies.findIndex(served);
  if (at < 0) return { failure: `the skill's craft line names no guide deep_kinds serves: deep_kinds op: read answers no text for any of ${names.length} names its ${lines.length} craft line(s) give (${names.slice(0, 40).join(', ')}); the lines: ${show(lines.map((l) => l.slice(0, 200)), 1500)}` };
  return { name: names[at]! };
}

/** `deep_kinds read guide: <name>`, every page joined; `failure` when a page is refused or holds no text. */
export function guideText(bin: string, name: string, gallery?: string): { text: string; failure?: string } {
  let text = '';
  let offset = 0;
  for (let page = 0; page < 64; page++) {
    const [reply] = kindsReplies(bin, [readGuide(name, offset)], gallery);
    if (!reply || reply['error'] !== undefined || typeof reply['text'] !== 'string') return { text, failure: `deep_kinds read guide: ${name} at offset ${offset} answers no text: ${show(reply ?? null, 800)}` };
    text += reply['text'];
    if (reply['truncated'] !== true) return { text };
    const next = reply['next'];
    if (typeof next !== 'number' || next <= offset) return { text, failure: `the guide's page at ${offset} is cut but names no later offset: ${show(next ?? null)}` };
    offset = next;
  }
  return { text, failure: 'the guide runs past 64 pages' };
}

// ---------------------------------------------------------------------------------------------------
// AC2's check: the guide holds every craft check with its description, its threshold and its fix, each the text the
// merge base's skill holds, after the check's name (README: Readings).

/** Text as written, markdown's code and bold marks aside and white space collapsed; case kept. */
export const normalize = (t: string): string => t.replace(/`|\*\*/g, '').replace(/\s+/g, ' ').trim();
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Where `name` stands as a word in `text`: not inside a longer name (`shot_length` in `shot_lengths`). */
const mentions = (text: string, name: string): number[] => [...text.matchAll(new RegExp(`(?<![A-Za-z0-9_])${escape(name)}(?![A-Za-z0-9_])`, 'g'))].map((m) => m.index!);
const PARTS = ['description', 'threshold', 'fix'] as const;

/**
 * Where the (normalized) guide states `c`: the last mention of its name from which its description, threshold and fix
 * each follow within their own length and 600 characters more; `end` is past the last of them. Else the parts the best
 * mention lacks.
 */
export function located(guide: string, c: Check): { start: number; end: number } | { missing: (typeof PARTS)[number][]; named: boolean } {
  const texts = PARTS.map((p) => normalize(c[p]));
  const reach = texts.reduce((n, t) => n + t.length, 0) + 600;
  let found: { start: number; end: number } | undefined;
  let fewest: (typeof PARTS)[number][] = [...PARTS];
  const at = mentions(guide, c.name);
  for (const p of at) {
    const window = guide.slice(p, p + reach);
    const where = texts.map((t) => window.indexOf(t));
    const missing = PARTS.filter((_, i) => where[i]! < 0);
    if (!missing.length) found = { start: p, end: p + Math.max(...where.map((w, i) => w + texts[i]!.length)) };
    else if (missing.length < fewest.length) fewest = missing;
  }
  return found ?? { missing: fewest, named: at.length > 0 };
}

/** Each check the guide doesn't state as the merge base's skill does, one sentence each, starting with its name. */
export function guideFailures(guideRaw: string, checks: readonly Check[]): string[] {
  const guide = normalize(guideRaw);
  const out: string[] = [];
  for (const c of checks) {
    const l = located(guide, c);
    if ('start' in l) continue;
    if (!l.named) { out.push(`${c.name}: the guide doesn't name it`); continue; }
    for (const p of l.missing) out.push(`${c.name}: the guide lacks its ${p} after its name, as the merge base's skill states it: "${c[p]}"`);
  }
  return out;
}

/** A planted guide: the (normalized) guide with `name`'s own statement cut out, from its name to its last part. */
export function withoutCheck(guideRaw: string, c: Check): string {
  const guide = normalize(guideRaw);
  const l = located(guide, c);
  expect('start' in l, `the guide states ${c.name}, so a plant can drop it`).toBe(true);
  const { start, end } = l as { start: number; end: number };
  return `${guide.slice(0, start)}${guide.slice(end)}`;
}

// ---------------------------------------------------------------------------------------------------
// The generator: `scripts/skill.mjs`'s `generate()`, run in a fresh Node process, whose `skill` is the text
// `node scripts/skill.mjs` writes to skills/deepbuild/SKILL.md, the folder `deep setup` copies into a session's skills.

/**
 * The skill `generate()` gives in a fresh process started in `root`, its clock `shiftMs` ahead of this one's (a preload
 * moves Date; README: AC5). Importing the script runs no write: it writes only when run as the main module.
 */
export function generatedSkill(root: string, shiftMs = 0): { text: string; failure?: string } {
  const dir = tempDir('gen');
  const preload = join(dir, 'clock.mjs');
  writeFileSync(preload, [
    `const Real = Date; const shift = ${shiftMs};`,
    'class Shifted extends Real { constructor(...a) { if (a.length === 0) super(Real.now() + shift); else super(...a); } static now() { return Real.now() + shift; } }',
    'globalThis.Date = Shifted;',
    '',
  ].join('\n'));
  const script = pathToFileURL(join(root, 'scripts/skill.mjs')).href;
  const code = `const m = await import(${JSON.stringify(script)}); const g = m.generate(); process.stdout.write(typeof g?.skill === 'string' ? g.skill : JSON.stringify({ noSkill: Object.keys(g ?? {}) }));`;
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, '--input-type=module', '-e', code], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600_000 });
  if (r.error || r.status !== 0) return { text: '', failure: `scripts/skill.mjs's generate() failed in a fresh process (${r.error?.message ?? `exit ${r.status}`}): ${(r.stderr ?? '').slice(-2000)}` };
  return { text: r.stdout };
}

/** AC5's comparison: two starts' skill texts, byte for byte; a failure names where they part and what each holds there. */
export function sameFailures(first: string, second: string, what: string): string[] {
  if (first === second) return [];
  let i = 0;
  while (i < first.length && i < second.length && first[i] === second[i]) i++;
  const line = first.slice(0, i).split('\n').length;
  return [`${what} differ from character ${i} (line ${line}): the first holds "${first.slice(i, i + 80)}", the second "${second.slice(i, i + 80)}"`];
}

// ---------------------------------------------------------------------------------------------------
// A copy of the checkout (AC3): every file but .git, target and node_modules, cloned where the file system can; the
// checkout's node_modules linked in.

const SKIP = new Set(['.git', 'target', 'node_modules']);
export function checkoutCopy(): string {
  const dir = join(tempDir('copy'), 'repo');
  cpSync(REPO, dir, {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
    filter: (src) => {
      const rel = relative(REPO, src);
      if (rel === '') return true;
      const parts = rel.split('/');
      return !parts.some((p) => SKIP.has(p)) && !rel.startsWith('tests/acceptance/');
    },
  });
  symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}

/** Runs `node scripts/skill.mjs` in `root`, the generator the skill's section comes from today. */
export function runGenerator(root: string): string | undefined {
  const r = spawnSync(process.execPath, ['scripts/skill.mjs'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600_000 });
  if (r.error || r.status !== 0) return `node scripts/skill.mjs failed in the copy (${r.error?.message ?? `exit ${r.status}`}): ${(r.stdout ?? '').slice(-1000)} ${(r.stderr ?? '').slice(-2000)}`;
  return undefined;
}

/** The target folder for a build in a copy: the checkout's target/debug cloned (no incremental), so only our crates rebuild. */
export function clonedTarget(copy: string): string {
  const target = join(copy, 'target');
  const from = process.env['CARGO_TARGET_DIR'] ? join(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
  mkdirSync(target, { recursive: true });
  if (existsSync(join(from, 'debug'))) {
    cpSync(join(from, 'debug'), join(target, 'debug'), {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
      filter: (src) => !relative(join(from, 'debug'), src).split('/').includes('incremental'),
    });
  }
  return target;
}

// ---------------------------------------------------------------------------------------------------
// The agent eval's recorded sessions (README: AC4): every `run.json` in the checkout that the scorer reads as a run
// (scripts/agent-eval.mjs: prompt, skill, tools, calls, manifest and answer), outside node_modules, target, .git and
// any twins folder. A film session is one whose recorded `brief` holds a `craft` list: the checks its brief names.

export interface Recording { file: string; run: JsonObject }

export function recordings(): Recording[] {
  const out: Recording[] = [];
  const walk = (d: string): void => {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const name of entries) {
      if (SKIP.has(name) || name === 'twins') continue;
      const path = join(d, name);
      let st;
      try { st = lstatSync(path); } catch { continue; }
      if (st.isDirectory()) walk(path);
      else if (name === 'run.json' && st.isFile()) {
        let run: unknown;
        try { run = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
        if (isObject(run) && typeof run['prompt'] === 'string' && Array.isArray(run['calls']) && isObject(run['skill']) && isObject(run['manifest'])) out.push({ file: relative(REPO, path), run });
      }
    }
  };
  walk(REPO);
  return out;
}

/** The checks a film session's brief names: `brief.craft`, each a name or `{check: name}` (#409's brief). */
export function namedChecks(run: JsonObject): string[] | undefined {
  const brief = run['brief'];
  if (!isObject(brief) || !Array.isArray(brief['craft'])) return undefined;
  return brief['craft'].map((e) => (typeof e === 'string' ? e : isObject(e) && typeof e['check'] === 'string' ? e['check'] : '')).filter((n) => n !== '');
}
export const isFilm = (r: Recording): boolean => namedChecks(r.run) !== undefined;
export const runId = (r: Recording): string => (typeof r.run['run'] === 'string' ? r.run['run'] : r.file);
export const skillOf = (r: Recording): string => (isObject(r.run['skill']) && typeof r.run['skill']['text'] === 'string' ? r.run['skill']['text'] : '');

/** A session's deep_* calls in order: `{tool, arguments, result}`. */
const callsOf = (r: Recording): JsonObject[] => (r.run['calls'] as JsonValue[]).filter(isObject);
const argsOf = (c: JsonObject): JsonObject => (isObject(c['arguments']) ? c['arguments'] : {});

/** Every value a result holds, a string that is JSON text read as its value too (MCP results carry text content). */
function values(v: JsonValue, out: JsonValue[]): void {
  out.push(v);
  if (Array.isArray(v)) for (const x of v) values(x, out);
  else if (isObject(v)) for (const x of Object.values(v)) values(x, out);
  else if (typeof v === 'string' && /^\s*[[{]/.test(v)) {
    try { values(JSON.parse(v) as JsonValue, out); } catch { /* not JSON text */ }
  }
}
/** The craft checks a session's results report a row from: every `{from: {craft: <name>}}` its calls delivered. */
export function craftRows(r: Recording): string[] {
  const all: JsonValue[] = [];
  for (const c of callsOf(r)) values(c['result'] ?? null, all);
  return [...new Set(all.filter(isObject).map((o) => (isObject(o['from']) && typeof o['from']['craft'] === 'string' ? o['from']['craft'] : '')).filter((n) => n !== ''))].sort();
}

/**
 * AC4's first check on one session: its first `deep_kinds {op: read, guide: <guide>}` comes before its first
 * `deep_show`, the first render. Each failure names the session.
 */
export function readBeforeRenderFailures(r: Recording, guide: string): string[] {
  const calls = callsOf(r);
  const read = calls.findIndex((c) => c['tool'] === 'deep_kinds' && argsOf(c)['op'] === 'read' && argsOf(c)['guide'] === guide);
  const render = calls.findIndex((c) => c['tool'] === 'deep_show');
  if (render < 0) return [`${runId(r)}: INCONCLUSIVE, the session never rendered (no deep_show call), so it can't show the guide read before its first render`];
  if (read < 0) return [`${runId(r)}: the session never read the guide ${guide} (no deep_kinds op: read, guide: ${guide}) before its first render, call ${render + 1}`];
  if (read > render) return [`${runId(r)}: the session read the guide ${guide} at call ${read + 1}, after its first render at call ${render + 1}`];
  return [];
}

/** AC4's second check: the checks the brief names are the ones the session ran, and the ones the merge base's session of the same repo ran. */
export function checksRunFailures(r: Recording, base: Recording | undefined): string[] {
  const named = [...new Set(namedChecks(r.run) ?? [])].sort();
  const ran = craftRows(r);
  const out: string[] = [];
  const unrun = named.filter((n) => !ran.includes(n));
  const unnamed = ran.filter((n) => !named.includes(n));
  if (unrun.length) out.push(`${runId(r)}: its brief names ${unrun.join(', ')}, which no row of its verdicts reports`);
  if (unnamed.length) out.push(`${runId(r)}: its verdicts report rows from ${unnamed.join(', ')}, which its brief doesn't name`);
  if (!base) out.push(`${runId(r)}: INCONCLUSIVE, no recorded session of repo ${show(r.run['repo'] ?? null)} on the merge base's skill to compare with`);
  else {
    const was = craftRows(base);
    if (was.join(',') !== ran.join(',')) out.push(`${runId(r)}: ran craft checks [${ran.join(', ')}], where the merge base's session ${runId(base)} ran [${was.join(', ')}]`);
  }
  return out;
}
