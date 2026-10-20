// Shared by the #47 acceptance tests. The corpus is read as files under adapters/corpus/; the replay,
// check and lifecycle run are reached only as `node scripts/corpus.mjs <command>`, the preflight only
// through scripts/lanes.mjs's `checks`, and `deep explain` only as the CLI entry
// (packages/cli/src/main.ts, run with node as packages/cli/test/cli.test.ts does). See README.md.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const CORPUS = join(root, 'adapters/corpus');
export const FACTS = join(root, 'adapters');
export const SCRIPT = 'scripts/corpus.mjs';
export const AGENTS = ['claude-code', 'codex'];
export const SIZE_LIMIT = 200_000_000; // "under 200 MB", as apparent bytes
export const REPLAY_LIMIT_MS = 120_000; // "replays fully in under 2 minutes"

// The hook events the design's agent table says each adapter handles in R1 ("What each agent gives
// us"). The facts files may list more; they may not list fewer.
export const DESIGN_HOOKS = {
  'claude-code': ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'SessionEnd'],
  codex: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop'],
};

// Criterion IDs: the first 8 hex digits of SHA-256 of each criterion's normalized text (README).
export const ID = {
  coverage: '#47.fc36112e',
  secrets: '#47.8f0e2354',
  shape: '#47.1597fbec',
  newVersion: '#47.13b96768',
  prompts: '#47.827e6ab1',
  explain: '#47.9e03b1e8',
  budgets: '#47.3f704ae4',
  expected: '#47.fc65f49c',
  drift: '#47.59eef887',
  range: '#47.e19749bc',
  lifecycle: '#47.d948ef8c',
  continuation: '#47.8ebea6b5',
  update: '#47.2ac9ccf2',
};

export function scratch(t, prefix = 'deep-corpus-47-') {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

export const show = (result) => `exit ${result.status ?? result.signal}\n--- stdout\n${(result.stdout ?? '').slice(-4000)}\n--- stderr\n${(result.stderr ?? '').slice(-2000)}`;

const readJson = (path, what) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    assert.fail(`${what}: ${relative(root, path)} does not read as JSON: ${error.message}`);
  }
};

// ---- Facts files (adapter.facts@1) ---------------------------------------------------------------

export function readFacts(agent, directory = FACTS) {
  const path = join(directory, `${agent}.facts.json`);
  if (!existsSync(path)) assert.fail(`${relative(root, path)} does not exist`);
  const facts = readJson(path, 'facts');
  assert.equal(facts.schema, 'adapter.facts@1', `${agent}'s facts follow adapter.facts@1`);
  assert.ok(Array.isArray(facts.versions) && facts.versions.length > 0, `${agent}'s facts name the versions they cover: ${JSON.stringify(facts.versions)}`);
  return { path, facts, text: readFileSync(path, 'utf8') };
}

/** The hook events the facts say this version carries, with their fields: facts.events.versions[v]. */
export function factsEvents(agent, version, facts = readFacts(agent).facts) {
  const events = facts.events?.versions?.[version];
  if (!events || typeof events !== 'object' || Object.keys(events).length === 0) {
    assert.fail(`adapters/${agent}.facts.json lists no events for ${version} (events.versions["${version}"]: the hook events the adapter handles, each with the fields it carries in the corpus)`);
  }
  return events;
}

/** A version past every covered one: the last numeric part plus 1000, such as 2.1.304 -> 2.1.1304. */
export function plantedVersion(versions) {
  const last = versions.at(-1);
  return last.replace(/(\d+)(\D*)$/, (_, digits, rest) => `${Number(digits) + 1000}${rest}`);
}

// ---- The corpus: adapters/corpus/<agent>/<version>/<session>/{session.json,events.jsonl,transcript.jsonl}

export function requireCorpus(directory = CORPUS) {
  if (!existsSync(directory)) assert.fail(`${relative(root, directory) || directory} does not exist: no recorded corpus (adapters/corpus/<agent>/<version>/<session>/)`);
}

const subdirectories = (directory) => (existsSync(directory) ? readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort() : []);

export function setDir(agent, version, corpus = CORPUS) {
  return join(corpus, agent, version);
}

/** Every recorded set in a corpus: [{ agent, version, dir }]. */
export function sets(corpus = CORPUS) {
  requireCorpus(corpus);
  return AGENTS.flatMap((agent) => subdirectories(join(corpus, agent)).map((version) => ({ agent, version, dir: setDir(agent, version, corpus) })));
}

/** Reads one session folder. Each events.jsonl line is one recorded hook call: { payload, expect, source, reviewed, tag? }. */
export function readSession(dir) {
  const meta = readJson(join(dir, 'session.json'), 'session');
  const eventsPath = join(dir, 'events.jsonl');
  if (!existsSync(eventsPath)) assert.fail(`${relative(root, eventsPath)} does not exist`);
  const cases = readFileSync(eventsPath, 'utf8').split('\n').map((text, index) => ({ text, line: index + 1 })).filter(({ text }) => text.trim()).map(({ text, line }) => {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      assert.fail(`${relative(root, eventsPath)}:${line} does not read as JSON: ${error.message}`);
    }
    return { ...parsed, line };
  });
  const transcriptPath = join(dir, 'transcript.jsonl');
  return { dir, name: dir.split('/').at(-1), meta, cases, transcriptPath };
}

export function sessions(set) {
  return subdirectories(set.dir).map((name) => readSession(join(set.dir, name)));
}

/** Every recorded hook call in a corpus, with where it is: [{ agent, version, session, case, ref }]. */
export function allCases(corpus = CORPUS) {
  return sets(corpus).flatMap((set) => sessions(set).flatMap((session) => session.cases.map((recorded) => ({
    ...set, session, case: recorded, ref: caseRef(set.agent, set.version, session.name, recorded.line),
  }))));
}

/** How the replay names a recorded hook call: <agent>/<version>/<session>/events.jsonl:<line>. */
export const caseRef = (agent, version, session, line) => `${agent}/${version}/${session}/events.jsonl:${line}`;
export const sessionRef = (agent, version, session) => `${agent}/${version}/${session}`;

export function writeCases(sessionDirectory, cases) {
  writeFileSync(join(sessionDirectory, 'events.jsonl'), `${cases.map(({ line, ...recorded }) => JSON.stringify(recorded)).join('\n')}\n`);
}

/** Copies one session of the real corpus into a scratch corpus, at the same agent and version. */
export function plantSession(t, { agent, version, session }, corpus = join(scratch(t), 'corpus')) {
  const target = join(corpus, agent, version, session.name);
  mkdirSync(join(corpus, agent, version), { recursive: true });
  cpSync(session.dir, target, { recursive: true });
  return { corpus, dir: target, session: readSession(target) };
}

/** Copies a whole agent's corpus, or one set of it renamed to another version (every mention of the version rewritten). */
export function copyAgent(agent, corpus) {
  cpSync(join(CORPUS, agent), join(corpus, agent), { recursive: true });
}
export function copySetAs(agent, from, to, corpus) {
  const target = setDir(agent, to, corpus);
  cpSync(setDir(agent, from), target, { recursive: true });
  const rewrite = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) rewrite(path);
      else writeFileSync(path, readFileSync(path, 'utf8').split(from).join(to));
    }
  };
  rewrite(target);
  return target;
}

export function plantFacts(t, agent, edit) {
  const directory = join(scratch(t, 'deep-facts-47-'), 'adapters');
  mkdirSync(directory, { recursive: true });
  const { facts } = readFacts(agent);
  const planted = structuredClone(facts);
  edit?.(planted);
  writeFileSync(join(directory, `${agent}.facts.json`), `${JSON.stringify(planted, null, 2)}\n`);
  return directory;
}

/** Apparent size of every file under a folder, in bytes, as git would store them. */
export function apparentBytes(directory) {
  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    total += entry.isDirectory() ? apparentBytes(path) : statSync(path).size;
  }
  return total;
}

// ---- scripts/corpus.mjs --------------------------------------------------------------------------

export function corpusScript(args, { timeout = 300_000 } = {}) {
  if (!existsSync(join(root, SCRIPT))) assert.fail(`${SCRIPT} does not exist: no corpus replay, check or lifecycle entry`);
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024 });
  if (result.error) assert.fail(`${SCRIPT} ${args.join(' ')} did not finish: ${result.error.message}`);
  const lines = result.stdout.split('\n').map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter((value) => value && typeof value === 'object' && !Array.isArray(value));
  return {
    result,
    lines,
    payload: (ref) => lines.find((line) => line.type === 'payload' && line.case === ref),
    session: (ref) => lines.find((line) => line.type === 'session' && line.session === ref),
    summary: lines.find((line) => line.type === 'summary'),
  };
}

export const replay = (corpus, facts) => corpusScript(['replay', ...(corpus ? ['--corpus', corpus] : []), ...(facts ? ['--facts', facts] : [])]);
export const check = (corpus, facts) => corpusScript(['check', ...(corpus ? ['--corpus', corpus] : []), ...(facts ? ['--facts', facts] : [])]);

/** A replay that failed: non-zero exit, summary not PASS, and the named case reported. */
export function assertReplayFails(run, ref, what) {
  assert.notEqual(run.result.status, 0, `${what}: the replay must fail\n${show(run.result)}`);
  assert.ok(run.summary && run.summary.verdict !== 'PASS', `${what}: the summary must not be PASS: ${JSON.stringify(run.summary)}`);
  const line = run.payload(ref);
  assert.ok(line, `${what}: the replay names the payload ${ref}\n${show(run.result)}`);
  assert.notEqual(line.result, 'match', `${what}: ${ref} must not read as a match: ${JSON.stringify(line)}`);
  return line;
}

export function assertReplayPasses(run, what) {
  assert.equal(run.result.status, 0, `${what}\n${show(run.result)}`);
  assert.equal(run.summary?.verdict, 'PASS', `${what}: ${JSON.stringify(run.summary)}`);
}

// ---- Expected events and patches ------------------------------------------------------------------

export const userAsks = (recorded) => (recorded.expect ?? []).filter((event) => event?.kind === 'user.ask');

/** The first case in the corpus whose tag is this one, in a covered version's set. */
export function taggedCases(tag, agent) {
  return allCases().filter((found) => found.case.tag === tag && (!agent || found.agent === agent));
}

/** Path lines of every apply_patch text in a payload's tool_input, resolved against the session's
 * folder, or the folder a leading `cd <dir> &&` names: the rule in the design's "Every adapter maps". */
export function patchPaths(payload) {
  const strings = [];
  const walk = (value) => {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) strings.push(value.filter((part) => typeof part === 'string').join(' ')), value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(payload.tool_input);
  const paths = new Set();
  const indented = new Set();
  for (const text of strings) {
    if (!/\*\*\*[ \t]*Begin Patch/.test(text)) continue;
    const cd = text.match(/(?:^|\s)cd\s+(?:'([^']+)'|"([^"]+)"|(\S+))\s*&&/);
    const base = cd ? resolvePosix(payload.cwd, cd[1] ?? cd[2] ?? cd[3]) : payload.cwd;
    for (const match of text.matchAll(/^([ \t]*)\*\*\*[ \t]*(?:Add File|Update File|Delete File|Move to)[ \t]*:[ \t]*(.+?)[ \t]*$/gm)) {
      const path = resolvePosix(base, match[2]);
      paths.add(path);
      if (match[1].length > 0) indented.add(path);
    }
  }
  return { paths: [...paths].sort(), indented: [...indented].sort() };
}

function resolvePosix(base, path) {
  const parts = (path.startsWith('/') ? path : `${base}/${path}`).split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}

/** The first string (or number) leaf in a value, with its JSON path keys. */
export function firstLeaf(value, path = []) {
  if (typeof value === 'string' || typeof value === 'number') return { path, value };
  if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      const found = firstLeaf(inner, [...path, key]);
      if (found) return found;
    }
  }
  return null;
}

export function setPath(target, path, value) {
  let cursor = target;
  for (const key of path.slice(0, -1)) cursor = cursor[key];
  cursor[path.at(-1)] = value;
}
