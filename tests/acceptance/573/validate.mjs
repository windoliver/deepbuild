// Shared by the #573 acceptance tests: reads the spike's public record and its private evidence,
// and recomputes from them everything a test can recompute, instead of taking the spike's word.
// Each check returns a list of problems; an empty list means it holds.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const RECORD = 'docs/spikes/573/record.json';
export const EVIDENCE_ENV = 'DEEP_SPIKE_573_EVIDENCE';
export const PUBLIC_REPO = 'windoliver/deepbuild';
export const ISSUES = 20;
export const UI_ISSUES = 5;
export const VARIANTS = ['plain', 'goal-steps'];
export const BASE_OUTCOMES = ['assertion', 'elsewhere', 'passed', 'ran-nothing'];
export const FIX_OUTCOMES = ['passed', 'failed', 'skipped', 'ran-nothing'];
const SHARE_TOLERANCE = 0.0005;

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
// The same ID rule as the acceptance tests' criteria, with checked boxes too, since closed issues often tick them.
export const criterionId = (text) => sha256(text.trim().replace(/\s+/g, ' ').replace(/^- \[[ xX]\] /, '')).slice(0, 8);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const list = (value) => (Array.isArray(value) ? value : []);
const label = (issue, index) => `issue ${issue?.ref ?? issue?.key ?? `#${index}`}`;
const countedRun = (issue, variant) => list(issue?.runs).find((run) => run?.counted === true && run.variant === variant);

export function loadRecord(path = join(root, RECORD)) {
  if (!existsSync(path)) assert.fail(`no spike record at ${RECORD}: the spike hasn't been recorded`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function git(args, input) {
  return spawnSync('git', args, { encoding: 'utf8', input, maxBuffer: 512 * 1024 * 1024 });
}
const gitOk = (args) => git(args).status === 0;

// ------------------------------------------------------------------ the public record

// Criterion 1: 20 issues, from this repo and the pilot repos, each with one counted draft (two for
// a UI issue) and every other run discarded and named with why.
export function structureProblems(record) {
  const problems = [];
  const issues = list(record?.issues);
  if (issues.length !== ISSUES) problems.push(`${issues.length} issues recorded, not ${ISSUES}`);
  const keys = new Set();
  let fromThisRepo = 0, fromPilots = 0;
  issues.forEach((issue, index) => {
    const at = label(issue, index);
    if (!/^[0-9a-f]{64}$/.test(issue?.key ?? '')) { problems.push(`${at}: key is not a SHA-256 hex digest`); return; }
    if (keys.has(issue.key)) problems.push(`${at}: recorded twice`);
    keys.add(issue.key);
    if (issue.ref !== undefined) {
      fromThisRepo++;
      if (!new RegExp(`^${PUBLIC_REPO}#\\d+$`).test(issue.ref)) problems.push(`${at}: ref isn't an issue of ${PUBLIC_REPO}; a pilot repo's issue carries no ref`);
      else if (sha256(issue.ref) !== issue.key) problems.push(`${at}: key isn't the SHA-256 of its ref`);
      for (const field of ['base', 'fix']) if (!/^[0-9a-f]{40}$/.test(issue[field] ?? '')) problems.push(`${at}: ${field} is not a full commit hash`);
    } else {
      fromPilots++;
      for (const field of ['base', 'fix', 'title']) if (issue[field] !== undefined) problems.push(`${at}: a pilot issue's ${field} belongs in the private evidence`);
    }
    if (typeof issue.ui !== 'boolean') problems.push(`${at}: ui is not true or false`);
    const criteria = list(issue.criteria);
    if (!criteria.length || !criteria.every((id) => /^[0-9a-f]{8}$/.test(id)) || new Set(criteria).size !== criteria.length) problems.push(`${at}: criteria must be one or more distinct 8-hex criterion IDs`);
    const runIds = new Set();
    for (const run of list(issue.runs)) {
      if (!nonEmpty(run?.id) || runIds.has(run.id)) problems.push(`${at}: run ID ${run?.id} is missing or repeated`);
      runIds.add(run?.id);
      if (!VARIANTS.includes(run?.variant)) problems.push(`${at}: run ${run?.id} has variant ${run?.variant}, not one of ${VARIANTS.join(', ')}`);
      if (typeof run?.counted !== 'boolean') problems.push(`${at}: run ${run?.id} doesn't say whether it's counted`);
      if (run?.counted === true && run.discarded !== undefined) problems.push(`${at}: run ${run.id} is both counted and discarded`);
      if (run?.counted === false && !nonEmpty(run.discarded)) problems.push(`${at}: run ${run.id} isn't counted, so it must be named as discarded with why`);
    }
    for (const variant of VARIANTS) {
      const want = variant === 'plain' || issue.ui === true ? 1 : 0;
      const have = list(issue.runs).filter((run) => run?.counted === true && run.variant === variant).length;
      if (have !== want) problems.push(`${at}: ${have} counted ${variant} drafts, not ${want}`);
    }
    const checkIds = new Set();
    for (const requirement of list(issue.requirements)) {
      if (!nonEmpty(requirement?.id) || !runIds.has(requirement.run)) problems.push(`${at}: requirement ${requirement?.id} names no recorded run`);
      for (const id of list(requirement?.covers)) if (!criteria.includes(id)) problems.push(`${at}: requirement ${requirement?.id} covers ${id}, which isn't one of the issue's criteria`);
    }
    for (const check of list(issue.checks)) {
      const key = `${check?.run}/${check?.id}`;
      if (!nonEmpty(check?.id) || checkIds.has(key)) problems.push(`${at}: check ${check?.id} is missing an ID or repeated in its run`);
      checkIds.add(key);
      if (!runIds.has(check?.run)) problems.push(`${at}: check ${check?.id} names no recorded run`);
      if (typeof check?.journey !== 'boolean') problems.push(`${at}: check ${check?.id} doesn't say whether it's a journey`);
      if (!Number.isInteger(check?.goalSteps) || check.goalSteps < 0) problems.push(`${at}: check ${check?.id} has no goal step count`);
      if (!BASE_OUTCOMES.includes(check?.base)) problems.push(`${at}: check ${check?.id} has base outcome ${check?.base}, not one of ${BASE_OUTCOMES.join(', ')}`);
      if (!FIX_OUTCOMES.includes(check?.fix)) problems.push(`${at}: check ${check?.id} has fix outcome ${check?.fix}, not one of ${FIX_OUTCOMES.join(', ')}`);
    }
  });
  if (!fromThisRepo) problems.push(`no issue from ${PUBLIC_REPO}`);
  if (!fromPilots) problems.push('no issue from the pilot repos');
  return problems;
}

// Criterion 1: this repo's issues name commits that are here, the fix after its base and merged.
export function publicCommitProblems(record, repo = root) {
  const problems = [];
  for (const issue of list(record?.issues).filter((each) => each?.ref !== undefined)) {
    const at = `issue ${issue.ref}`;
    const present = ['base', 'fix'].filter((field) => {
      const ok = gitOk(['-C', repo, 'cat-file', '-e', `${issue[field]}^{commit}`]);
      if (!ok) problems.push(`${at}: ${field} ${issue[field]} isn't a commit in this repo`);
      return ok;
    });
    if (present.length < 2) continue;
    if (!gitOk(['-C', repo, 'merge-base', '--is-ancestor', issue.base, issue.fix])) problems.push(`${at}: base ${issue.base} isn't an ancestor of the fix ${issue.fix}`);
    if (!gitOk(['-C', repo, 'merge-base', '--is-ancestor', issue.fix, 'HEAD'])) problems.push(`${at}: the fix ${issue.fix} isn't merged into HEAD`);
  }
  return problems;
}

const ratio = (part, whole) => (whole === 0 ? 0 : part / whole);
function tally(checks) {
  const drafted = checks.length;
  const proven = checks.filter((check) => check.base === 'assertion' && check.fix === 'passed').length;
  return {
    drafted, proven, share: ratio(proven, drafted),
    droppedPassesOnBase: checks.filter((check) => check.base === 'passed').length,
    droppedFailsElsewhere: checks.filter((check) => check.base === 'elsewhere').length,
  };
}
const journeyTally = (checks) => { const { drafted, proven, share } = tally(checks); return { drafted, proven, share }; };

// The readings, recomputed from the per-check outcomes: only counted runs count, every drafted
// check is in the denominator, and the two kinds of drop are counted apart.
export function expectedReadings(record) {
  const readings = new Map();
  let covered = 0, criteria = 0;
  const allChecks = [];
  const allJourneys = { 'goal-steps': [], plain: [] };
  for (const issue of list(record?.issues)) {
    const plain = countedRun(issue, 'plain');
    if (!plain || !nonEmpty(issue?.key)) continue;
    const issueCriteria = [...new Set(list(issue.criteria))];
    const requirements = list(issue.requirements).filter((requirement) => requirement?.run === plain.id);
    const issueCovered = issueCriteria.filter((id) => requirements.some((requirement) => list(requirement.covers).includes(id))).length;
    readings.set(`coverage:${issue.key}`, { covered: issueCovered, criteria: issueCriteria.length, share: ratio(issueCovered, issueCriteria.length) });
    covered += issueCovered;
    criteria += issueCriteria.length;
    const checks = list(issue.checks).filter((check) => check?.run === plain.id);
    readings.set(`checks:${issue.key}`, tally(checks));
    allChecks.push(...checks);
    if (issue.ui !== true) continue;
    for (const variant of VARIANTS) {
      const run = countedRun(issue, variant);
      if (!run) continue;
      const journeys = list(issue.checks).filter((check) => check?.run === run.id && check.journey === true);
      readings.set(`journeys:${issue.key}:${variant}`, journeyTally(journeys));
      allJourneys[variant].push(...journeys);
    }
  }
  readings.set('coverage:all', { covered, criteria, share: ratio(covered, criteria) });
  readings.set('checks:all', tally(allChecks));
  for (const variant of VARIANTS) readings.set(`journeys:all:${variant}`, journeyTally(allJourneys[variant]));
  return readings;
}

// Criteria 2 and 4: every expected reading whose ID starts with one of the prefixes is recorded,
// once, with the recomputed counts and share.
export function readingProblems(record, prefixes) {
  const problems = [];
  const recorded = new Map();
  for (const reading of list(record?.readings)) {
    if (!nonEmpty(reading?.id)) { problems.push('a reading has no ID'); continue; }
    if (recorded.has(reading.id)) problems.push(`reading ${reading.id} is recorded twice`);
    recorded.set(reading.id, reading);
  }
  const expected = [...expectedReadings(record)].filter(([id]) => prefixes.some((prefix) => id.startsWith(prefix)));
  if (!expected.some(([id]) => !id.includes(':all'))) problems.push(`the record holds no issue with ${prefixes.join(' or ')} readings to recompute`);
  for (const [id, want] of expected) {
    const have = recorded.get(id);
    if (!have) { problems.push(`reading ${id} is missing; recomputed it is ${JSON.stringify(want)}`); continue; }
    for (const [field, value] of Object.entries(want)) {
      const ok = field === 'share' ? typeof have.share === 'number' && Math.abs(have.share - value) <= SHARE_TOLERANCE : have[field] === value;
      if (!ok) problems.push(`reading ${id}: ${field} is recorded as ${have[field]}, recomputed from the checks it is ${field === 'share' ? value.toFixed(3) : value}`);
    }
  }
  return problems;
}

function citationProblems(what, cites, record, required) {
  const problems = [];
  const expected = expectedReadings(record);
  const recorded = new Set(list(record?.readings).map((reading) => reading?.id));
  if (!list(cites).length) return [`${what} cites no readings`];
  for (const id of list(cites)) {
    if (!recorded.has(id) || !expected.has(id)) problems.push(`${what} cites ${id}, which isn't a reading the record holds and the tests recompute`);
  }
  for (const [pattern, why] of required) if (!list(cites).some((id) => pattern.test(id))) problems.push(`${what} cites no ${why}`);
  return problems;
}

// Criterion 3: the decision names what week 5's drafting job changes, or says it stands, citing readings.
export function draftingDecisionProblems(record) {
  const decision = record?.decision?.draftingJob;
  if (!decision) return ['the record has no decision about week 5\'s drafting job'];
  const problems = [];
  if (!['changes', 'stands'].includes(decision.outcome)) problems.push(`the drafting job's outcome is ${decision.outcome}, not changes or stands`);
  const changes = list(decision.changes);
  if (decision.outcome === 'changes' && !(changes.length && changes.every(nonEmpty))) problems.push('the decision says the drafting job changes but names no change');
  if (decision.outcome === 'stands' && changes.length) problems.push('the decision says the drafting job stands but lists changes');
  if (!nonEmpty(decision.text) || !/week 5/i.test(decision.text)) problems.push('the decision\'s text doesn\'t say what it decides for week 5\'s drafting job');
  problems.push(...citationProblems('the drafting job\'s decision', decision.cites, record, [[/^(coverage|checks):/, 'coverage or checks reading']]));
  return problems;
}

// Criterion 4: five UI issues, each drafted with goal steps offered and without. The job may write a
// goal step only where it can't know a journey's controls (design: Goal steps), so a draft offered
// them that uses none is a reading, not a fault. One without them never has one.
export function uiProblems(record) {
  const problems = [];
  const ui = list(record?.issues).filter((issue) => issue?.ui === true);
  if (ui.length !== UI_ISSUES) problems.push(`${ui.length} UI issues, not ${UI_ISSUES}`);
  ui.forEach((issue, index) => {
    const at = label(issue, index);
    const plain = countedRun(issue, 'plain');
    const goal = countedRun(issue, 'goal-steps');
    if (!plain || !goal) { problems.push(`${at}: a UI issue needs a counted draft with goal steps and one without`); return; }
    const checks = (run) => list(issue.checks).filter((check) => check?.run === run.id);
    if (checks(plain).some((check) => check.goalSteps !== 0)) problems.push(`${at}: the draft without goal steps has a check with goal steps`);
  });
  return problems;
}

// Criterion 4: the decision says whether week 5 builds goal steps (#581), citing the journeys
// readings with and without them; it may build them only if they raise the share (design: Goal steps).
export function goalStepsDecisionProblems(record) {
  const decision = record?.decision?.goalSteps;
  if (!decision) return ['the decision doesn\'t name goal steps (#581) either way'];
  const problems = [];
  if (typeof decision.build !== 'boolean') problems.push('the decision doesn\'t say whether week 5 builds goal steps');
  if (!nonEmpty(decision.text) || !/goal steps?/i.test(decision.text) || !/#581\b/.test(decision.text)) problems.push('the decision\'s text doesn\'t name goal steps (#581)');
  problems.push(...citationProblems('the goal steps decision', decision.cites, record, [
    [/^journeys:.*:goal-steps$/, 'journeys reading with goal steps'],
    [/^journeys:.*:plain$/, 'journeys reading without goal steps'],
  ]));
  if (decision.build === true) {
    const readings = expectedReadings(record);
    const withGoals = readings.get('journeys:all:goal-steps').share;
    const without = readings.get('journeys:all:plain').share;
    if (!(withGoals > without)) problems.push(`the decision builds goal steps though they don't raise the share of journeys that fail on the base on a named assertion and pass on the fix (${withGoals.toFixed(3)} with, ${without.toFixed(3)} without)`);
    const used = list(record?.issues).filter((issue) => issue?.ui === true).some((issue) => {
      const run = countedRun(issue, 'goal-steps');
      return run && list(issue.checks).some((check) => check?.run === run.id && check.journey === true && check.goalSteps >= 1);
    });
    if (!used) problems.push('the decision builds goal steps though no draft offered them wrote one, so no share reflects them');
  }
  return problems;
}

// ------------------------------------------------------------------ run reports (JUnit XML)

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
function content(s = '') {
  let out = '', last = 0;
  for (const match of s.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    out += decode(s.slice(last, match.index)) + match[1];
    last = match.index + match[0].length;
  }
  return out + decode(s.slice(last));
}
const attributes = (s) => Object.fromEntries([...s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)].map(([, name, value]) => [name, decode(value)]));

export function parseJUnit(xml) {
  const cases = [];
  for (const match of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attrs = attributes(match[1]);
    const inner = match[2] ?? '';
    const failures = [...inner.matchAll(/<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g)].map(([, tag, at, body]) => {
      const fa = attributes(at);
      return { tag, type: fa.type ?? '', message: fa.message ?? '', body: content(body ?? '') };
    });
    const skipped = /<skipped\b/.test(inner);
    cases.push({ id: `${attrs.classname ?? ''}::${attrs.name ?? ''}`, status: failures.length ? 'failed' : skipped ? 'skipped' : 'passed', failures });
  }
  return cases;
}

// An error header, `Name [CODE]: message`. Node's test runner wraps the real error, so its JUnit
// body starts `[Error [ERR_TEST_FAILURE]: ...` and carries the test's own error on a `cause:` line.
const NAME = String.raw`((?:[A-Za-z_$][\w$]*\.)*(?:[A-Za-z_$][\w$]*(?:Error|Exception)|Error))(?:\s*\[([A-Za-z_]+)\])?:\s?(.*)$`;
const HEADER = new RegExp(String.raw`^\s*(?:E\s+|\[)?` + NAME);
const CAUSE = new RegExp(String.raw`^\s*cause:\s+` + NAME);
const PYTEST_TRAILER = /^\S+?\.py:\d+: ((?:\w+\.)*\w+)\s*$/;
const LOCATION = /(?:^|[\s(\[@'"])((?:file:\/\/)?[^\s()'"\[\]]+?\.(?:[cm]?[jt]sx?|py|rs|go|rb)):(\d+)(?::\d+)?/g;

// The failure's error: the first error header in the report's text for it, a Rust assertion
// panic, or pytest's trailer. Null when the report can't name one.
function failureError(failure) {
  const lines = `${failure.body}\n${failure.message}`.split('\n');
  // Node's wrapper is never the test's own error: read its cause. A cause that's only a string,
  // as when a file fails to load, has no header, so the wrapper stands and the failure is elsewhere.
  if (lines.some((line) => line.includes('ERR_TEST_FAILURE'))) {
    for (const [index, line] of lines.entries()) {
      const cause = line.match(CAUSE);
      if (cause) return { name: cause[1], code: cause[2], rest: cause[3], index, lines };
    }
  }
  for (const [index, line] of lines.entries()) {
    const header = line.match(HEADER);
    if (header) return { name: header[1], code: header[2], rest: header[3], index, lines, pytest: /^\s*E\s/.test(line) };
    if (/panicked at /.test(line)) {
      const assertion = lines.slice(index, index + 4).some((next) => /assertion (?:`[^`]*` )?failed|assertion failed:/.test(next));
      return { name: assertion ? 'AssertionError' : 'panic', rest: line, index, lines };
    }
  }
  for (const [index, line] of lines.entries()) {
    const trailer = line.match(PYTEST_TRAILER);
    if (trailer) return { name: trailer[1], rest: '', index: 0, lines, pytest: true };
  }
  return null;
}

// A frame names one of the check's own files when either path ends the other at a path boundary:
// absolute frames end with the repo path, and vitest's frames are relative to its root, which for
// a check run from a package is a suffix of the repo path.
const ownFile = (path, files) => {
  const clean = path.replace(/^file:\/\//, '').replace(/^\.\//, '');
  return files.find((file) => clean === file || clean.endsWith(`/${file}`) || file.endsWith(`/${clean}`));
};

// An assertion that caught a thrown error or a rejection, in Jest's, Playwright's or Vitest's words.
// One that failed because nothing was thrown or rejected caught nothing, so it's an ordinary assertion.
const THROW_MATCHER = /\.(?:not\.)?toThrow\w*\b|\.rejects\b|\.resolves\b|\bto (?:not )?throw\b|\bpromise (?:rejected|resolved)\b.* instead of (?:resolving|rejecting)/;
const NOTHING_CAUGHT = /did not throw|promise resolved instead of rejected|\bpromise resolved\b.* instead of rejecting|\bto throw (?:an )?error\s*$/m;
const caughtError = (rest, text) => THROW_MATCHER.test(rest) && !NOTHING_CAUGHT.test(text)
  && !(/\.resolves\b/.test(rest) && !/rejected instead of resolved/.test(text));

// Failing on an assertion (design, How runs become one of five verdicts): the framework's own
// assertion failure, at an assertion the check names, read from the report. Anything else is elsewhere.
export function failureOnAssertion(failure, check) {
  const files = list(check?.files);
  const asserts = list(check?.asserts);
  const error = failureError(failure);
  if (!error) return { onAssertion: false, why: 'the report can\'t place the failure' };
  const matcher = error.name === 'Error' && (/^expect(?:\.poll)?\(/.test(error.rest) || /^Timed out \d+ms waiting for expect\(/.test(error.rest));
  const assertion = /^(?:\w+\.)*(?:AssertionError|JestAssertionError|AssertionFailedError)$/.test(error.name) || error.code === 'ERR_ASSERTION' || matcher;
  if (!assertion) return { onAssertion: false, why: `${error.name} outside an assertion` };
  const after = error.lines.slice(error.index).join('\n');
  const locations = [...after.matchAll(LOCATION)].map(([, path, line]) => ({ path, line: Number(line) }));
  const own = locations.map((location) => ({ file: ownFile(location.path, files), line: location.line })).filter((location) => location.file);
  const frame = error.pytest ? own.at(-1) : own[0];
  if (!frame) return { onAssertion: false, why: 'no frame of the failure is in the check\'s own files' };
  if (asserts.length && !asserts.includes(`${frame.file}:${frame.line}`)) return { onAssertion: false, why: `the assertion at ${frame.file}:${frame.line} isn't one the check names` };
  if (caughtError(error.rest, after)) {
    const underTest = locations.some((location) => !ownFile(location.path, files) && !/node_modules|^node:|internal\//.test(location.path));
    if (!underTest) return { onAssertion: false, why: 'the caught error\'s stack never runs through the code under test' };
  }
  return { onAssertion: true };
}

// The base outcome of a drafted check, from its base run's report.
export function baseOutcome(xml, check) {
  const ran = parseJUnit(xml).filter((test) => test.status !== 'skipped');
  if (!ran.length) return { outcome: 'ran-nothing' };
  const failed = ran.filter((test) => test.status === 'failed');
  if (!failed.length) return { outcome: 'passed' };
  for (const test of failed) {
    for (const failure of test.failures) {
      const placed = failureOnAssertion(failure, check);
      if (!placed.onAssertion) return { outcome: 'elsewhere', why: `${test.id}: ${placed.why}` };
    }
  }
  return { outcome: 'assertion' };
}

// The fix outcome: passed only when at least one test ran, none failed and none of the check's
// own tests was skipped. Checks that share a file select their tests with a name filter (`-t`,
// `--test-name-pattern`, `-g`), and the reporter lists the tests it filtered out as skipped, on the
// base and the fix alike. So a test skipped on the fix is outside the check only when the base
// report lists it as skipped too; one the base ran, or doesn't list, counts against the fix.
export function fixOutcome(xml, baseXml = '') {
  const tests = parseJUnit(xml);
  const excluded = new Set(parseJUnit(baseXml).filter((test) => test.status === 'skipped').map((test) => test.id));
  if (!tests.some((test) => test.status !== 'skipped')) return 'ran-nothing';
  if (tests.some((test) => test.status === 'failed')) return 'failed';
  if (tests.some((test) => test.status === 'skipped' && !excluded.has(test.id))) return 'skipped';
  return 'passed';
}

// ------------------------------------------------------------------ the private evidence

export function evidenceDir() {
  const dir = process.env[EVIDENCE_ENV];
  if (!dir) assert.fail(`BLOCKED: the spike's private evidence isn't available; set ${EVIDENCE_ENV} to its folder`);
  if (!existsSync(join(dir, 'manifest.json'))) assert.fail(`BLOCKED: ${EVIDENCE_ENV}=${dir} holds no manifest.json`);
  const real = realpathSync(dir);
  if (real === root || real.startsWith(root + sep)) assert.fail(`the private evidence must live outside this public repo, not at ${real}`);
  return real;
}

const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
const REPO_GIT = /^issues\/[^/]+\/repo\.git(\/|$)/;

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = relative(base, path).split(sep).join('/');
    if (REPO_GIT.test(rel)) continue;
    if (statSync(path).isDirectory()) walk(path, base, out); else out.push(rel);
  }
  return out;
}

// Criterion 1: the evidence is the bundle the public record hashes, every file listed with its hash.
export function manifestProblems(dir, record) {
  const problems = [];
  const bytes = readFileSync(join(dir, 'manifest.json'));
  if (sha256(bytes) !== record?.evidence?.manifestSha256) problems.push(`manifest.json hashes to ${sha256(bytes)}, but the public record holds ${record?.evidence?.manifestSha256}`);
  const files = JSON.parse(bytes.toString('utf8'))?.files ?? {};
  for (const [rel, hash] of Object.entries(files)) {
    const path = join(dir, rel);
    if (!existsSync(path)) problems.push(`manifest lists ${rel}, which isn't there`);
    else if (sha256(readFileSync(path)) !== hash) problems.push(`${rel} doesn't match its hash in the manifest`);
  }
  for (const rel of walk(dir)) if (rel !== 'manifest.json' && !(rel in files)) problems.push(`${rel} isn't in the manifest`);
  return problems;
}

function issueMeta(dir, issue, problems) {
  const issueDir = join(dir, 'issues', issue.key);
  const meta = readJson(join(issueDir, 'issue.json'));
  if (!meta) { problems.push(`issue ${issue.ref ?? issue.key}: no issues/${issue.key}/issue.json in the evidence`); return null; }
  return { issueDir, meta, gitDir: join(issueDir, 'repo.git'), text: existsSync(join(issueDir, 'issue.md')) ? readFileSync(join(issueDir, 'issue.md'), 'utf8') : null };
}

// Lines the fix adds that the base has nowhere and the issue doesn't quote: only the fix has them.
function fixOnlyLines(gitDir, base, fix, issueText) {
  const diff = git(['--git-dir', gitDir, 'diff', '--no-color', '--unified=0', base, fix]).stdout ?? '';
  const added = [...new Set(diff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1).trim()).filter((line) => line.length >= 30 && !issueText.includes(line)))];
  if (!added.length) return [];
  const scratch = mkdtempSync(join(tmpdir(), 'deep-573-'));
  try {
    writeFileSync(join(scratch, 'patterns'), added.join('\n'));
    const found = git(['--git-dir', gitDir, 'grep', '-h', '-o', '-F', '-f', join(scratch, 'patterns'), base]).stdout ?? '';
    // `git grep -o` prints only the leftmost-longest match at each place, so a pattern inside a
    // longer one is never printed. Count it at the base when it's inside a printed match, and ask
    // git for each one still unconfirmed.
    const printed = found.split('\n').filter(Boolean);
    return added.filter((line) => !printed.some((match) => match.includes(line))
      && git(['--git-dir', gitDir, 'grep', '-q', '-F', '-e', line, base]).status !== 0);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

function fixIds(gitDir, base, fix) {
  const raw = git(['--git-dir', gitDir, 'diff', '--raw', '--no-abbrev', base, fix]).stdout ?? '';
  const blobs = raw.split('\n').map((line) => line.split(/\s+/)[3]).filter((id) => /^[0-9a-f]{40}$/.test(id ?? '') && !/^0+$/.test(id));
  return [fix, ...blobs];
}
const mentionsId = (text, ids) => (text.match(/\b[0-9a-f]{7,40}\b/g) ?? []).find((token) => ids.some((id) => id.startsWith(token)));

// Criterion 1: each run's recorded inputs, recomputed against the issue, the base and the fix. A
// run whose inputs hold anything but the issue, the prompt and the base's own files, or anything
// only the fix has, or whose transcript names the fix, is never counted.
export function issueEvidenceProblems(dir, issue) {
  const problems = [];
  const at = `issue ${issue.ref ?? issue.key}`;
  const found = issueMeta(dir, issue, problems);
  if (!found) return problems;
  const { issueDir, meta, gitDir, text } = found;
  if (text === null) problems.push(`${at}: no issue.md, the issue's text as the job got it`);
  if (sha256(meta.ref ?? '') !== issue.key) problems.push(`${at}: the key isn't the SHA-256 of the evidence's ref`);
  if (issue.ref !== undefined && (meta.ref !== issue.ref || meta.base !== issue.base || meta.fix !== issue.fix)) problems.push(`${at}: the evidence's ref, base or fix differs from the public record's`);
  if (issue.ref === undefined && String(meta.ref).startsWith(`${PUBLIC_REPO}#`)) problems.push(`${at}: an issue of ${PUBLIC_REPO} must carry its ref in the public record`);
  if (!existsSync(gitDir)) return [...problems, `${at}: no repo.git holding the base and the fix`];
  for (const field of ['base', 'fix']) if (!gitOk(['--git-dir', gitDir, 'cat-file', '-e', `${meta[field]}^{commit}`])) return [...problems, `${at}: ${field} ${meta[field]} isn't in repo.git`];
  if (!gitOk(['--git-dir', gitDir, 'merge-base', '--is-ancestor', meta.base, meta.fix])) problems.push(`${at}: the base isn't an ancestor of the fix`);
  if (!gitOk(['--git-dir', gitDir, 'merge-base', '--is-ancestor', meta.fix, 'HEAD'])) problems.push(`${at}: the fix isn't merged into repo.git's default branch`);
  const ids = fixIds(gitDir, meta.base, meta.fix);
  const lines = fixOnlyLines(gitDir, meta.base, meta.fix, text ?? '');
  for (const run of list(issue.runs)) {
    const runDir = join(issueDir, 'runs', run.id);
    const recorded = readJson(join(runDir, 'run.json'));
    if (!recorded) { problems.push(`${at}: run ${run.id} has no run.json`); continue; }
    if (recorded.variant !== run.variant || recorded.counted !== run.counted) problems.push(`${at}: run ${run.id}'s variant or counted state differs from the public record's`);
    const tainted = [];
    if (recorded.base !== meta.base) tainted.push(`its checkout was at ${recorded.base}, not the base`);
    const inputs = list(recorded.inputs);
    if (!inputs.some((input) => input?.kind === 'issue')) tainted.push('its inputs don\'t include the issue');
    for (const input of inputs) {
      const name = input?.path ?? input?.file;
      const path = join(runDir, String(input?.file));
      if (!existsSync(path)) { tainted.push(`input ${name} isn't kept`); continue; }
      const bytes = readFileSync(path);
      if (sha256(bytes) !== input.sha256) tainted.push(`input ${name} doesn't match its recorded hash`);
      const body = bytes.toString('utf8');
      if (input.kind === 'issue') { if (body !== text) tainted.push(`input ${name} isn't the issue's text`); continue; }
      if (input.kind === 'base') {
        const blob = spawnSync('git', ['--git-dir', gitDir, 'show', `${meta.base}:${input.path}`], { maxBuffer: 512 * 1024 * 1024 });
        if (blob.status !== 0) tainted.push(`input ${name} isn't a file of the base commit`);
        else if (!blob.stdout.equals(bytes)) tainted.push(`input ${name} differs from the base commit's file`);
      } else if (input.kind !== 'prompt') tainted.push(`input ${name} (${input.kind}) is neither the issue, the prompt nor a file of the base commit`);
      const id = mentionsId(body, ids);
      if (id) tainted.push(`input ${name} names ${id}, which only the fix has`);
      const line = lines.find((each) => body.includes(each));
      if (line) tainted.push(`input ${name} holds a line only the fix has`);
    }
    const transcript = existsSync(join(runDir, String(recorded.transcript))) ? readFileSync(join(runDir, String(recorded.transcript)), 'utf8') : null;
    if (transcript === null) tainted.push('its transcript isn\'t kept');
    else { const id = mentionsId(transcript, ids); if (id) tainted.push(`its transcript names ${id}, which only the fix has`); }
    if (tainted.length && run.counted === true) problems.push(`${at}: run ${run.id} is counted, but ${tainted.join('; ')}`);
  }
  return problems;
}

// Criterion 2: the issue's criteria are its own text's, every checkbox included.
export function criteriaProblems(dir, issue) {
  const problems = [];
  const found = issueMeta(dir, issue, problems);
  if (!found) return problems;
  const at = `issue ${issue.ref ?? issue.key}`;
  const texts = list(found.meta.criteria);
  const collapse = (s) => s.replace(/\s+/g, ' ');
  const issueText = collapse(found.text ?? '');
  for (const criterion of texts) if (!issueText.includes(collapse(criterion.trim()).replace(/^- \[[ xX]\] /, ''))) problems.push(`${at}: criterion ${criterionId(criterion)} isn't in the issue's text`);
  const ids = texts.map(criterionId);
  const boxes = (found.text ?? '').split('\n').filter((line) => /^\s*- \[[ xX]\] /.test(line)).map(criterionId);
  const want = new Set(boxes.length ? boxes : ids);
  const have = new Set(list(issue.criteria));
  if (ids.length !== have.size || ids.some((id) => !have.has(id))) problems.push(`${at}: the public criteria IDs aren't those of the evidence's criteria`);
  for (const id of want) if (!have.has(id)) problems.push(`${at}: the issue's criterion ${id} is left out`);
  for (const id of have) if (!want.has(id)) problems.push(`${at}: criterion ${id} isn't a checkbox of the issue`);
  return problems;
}

// Criteria 2 and 4: each drafted check of the issue's counted run of this variant, recomputed from
// its base and fix reports, and no drafted check missing from the record.
export function checkEvidenceProblems(dir, issue, variant) {
  const problems = [];
  const run = countedRun(issue, variant);
  if (!run) return problems;
  const at = `issue ${issue.ref ?? issue.key}, run ${run.id}`;
  const runDir = join(dir, 'issues', issue.key, 'runs', run.id);
  const definition = readJson(join(runDir, 'definition.json'));
  if (!definition) problems.push(`${at}: no definition.json, the drafted definition`);
  const drafted = list(definition?.requirements).map((requirement) => `${requirement?.id}:${[...list(requirement?.covers)].sort().join(',')}`).sort();
  const recorded = list(issue.requirements).filter((requirement) => requirement?.run === run.id).map((requirement) => `${requirement.id}:${[...list(requirement.covers)].sort().join(',')}`).sort();
  if (definition && JSON.stringify(drafted) !== JSON.stringify(recorded)) problems.push(`${at}: the record's requirements and what they cover differ from the drafted definition's`);
  const checksDir = join(runDir, 'checks');
  const kept = existsSync(checksDir) ? readdirSync(checksDir).filter((name) => statSync(join(checksDir, name)).isDirectory()) : [];
  const checks = list(issue.checks).filter((check) => check?.run === run.id);
  for (const name of kept) if (!checks.some((check) => check.id === name)) problems.push(`${at}: drafted check ${name} is missing from the record`);
  for (const check of checks) {
    const checkDir = join(checksDir, check.id);
    const spec = readJson(join(checkDir, 'check.json'));
    if (!spec || !existsSync(join(checkDir, 'base.xml')) || !existsSync(join(checkDir, 'fix.xml'))) { problems.push(`${at}: check ${check.id} has no check.json, base.xml and fix.xml`); continue; }
    if (!list(spec.files).length || !list(spec.asserts).every((each) => /^.+:\d+$/.test(each))) problems.push(`${at}: check ${check.id}'s check.json needs its own files and asserts as path:line`);
    if (spec.journey !== check.journey || spec.goalSteps !== check.goalSteps) problems.push(`${at}: check ${check.id}'s journey or goal steps differ from the record's`);
    const baseXml = readFileSync(join(checkDir, 'base.xml'), 'utf8');
    const base = baseOutcome(baseXml, spec);
    if (base.outcome !== check.base) problems.push(`${at}: check ${check.id} is recorded as '${check.base}' on the base, but its base report shows '${base.outcome}'${base.why ? ` (${base.why})` : ''}`);
    const fix = fixOutcome(readFileSync(join(checkDir, 'fix.xml'), 'utf8'), baseXml);
    if (fix !== check.fix) problems.push(`${at}: check ${check.id} is recorded as '${check.fix}' on the fix, but its fix report shows '${fix}'`);
  }
  return problems;
}

// Criterion 4: a UI issue's goal-steps draft was offered goal steps: among its prompt inputs (the
// prompt, and the acting harness its checkout held) is one its plain draft wasn't given.
export function goalOfferProblems(dir, issue) {
  if (issue?.ui !== true) return [];
  const at = `issue ${issue.ref ?? issue.key}`;
  const plain = countedRun(issue, 'plain');
  const goal = countedRun(issue, 'goal-steps');
  if (!plain || !goal) return [`${at}: a UI issue needs a counted draft with goal steps and one without`];
  const prompts = (run) => {
    const recorded = readJson(join(dir, 'issues', issue.key, 'runs', run.id, 'run.json'));
    return recorded ? list(recorded.inputs).filter((input) => input?.kind === 'prompt').map((input) => input.sha256) : null;
  };
  const withGoals = prompts(goal), without = prompts(plain);
  if (!withGoals || !without) return [`${at}: run ${withGoals ? plain.id : goal.id} has no run.json`];
  if (!withGoals.some((hash) => !without.includes(hash))) return [`${at}: run ${goal.id} wasn't offered goal steps: its prompt inputs are all its plain run's`];
  return [];
}

// Criterion 1: nothing that identifies a pilot issue is in this public repo.
export function privacyProblems(dir, record, repo = root) {
  const problems = [];
  for (const issue of list(record?.issues).filter((each) => each?.ref === undefined)) {
    const found = issueMeta(dir, issue, problems);
    if (!found) continue;
    const { meta } = found;
    const secrets = [['its repo', String(meta.ref ?? '').split('#')[0], 6], ['its title', meta.title, 20], ...list(meta.criteria).map((text) => [`criterion ${criterionId(String(text))}`, text, 20])]
      .filter(([, value, least]) => typeof value === 'string' && value.trim().length >= least);
    // Messages name what leaked, never the private text itself.
    for (const [what, secret] of secrets) {
      const hits = git(['-C', repo, 'grep', '--untracked', '-I', '-l', '-F', '-e', secret.trim()]).stdout?.trim();
      if (hits) problems.push(`issue ${issue.key}: ${what} is in this repo: ${hits.split('\n').join(', ')}`);
    }
  }
  return problems;
}
