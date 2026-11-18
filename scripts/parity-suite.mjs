// The parity suite's lanes, release report and bar (issue #458; technical design: How we know version 0 works, the
// parity suite and Kit hygiene). A suite file lists the fixtures, each with the lanes that run it, the backends it
// names, its owner and its planted-fault twins, and each lane's runner; scripts/parity-suite.json is the shipped one.
//
//   node scripts/parity-suite.mjs run <lane>        one run of quick, full, cross or oracle: the lane's record
//   node scripts/parity-suite.mjs report            the release report of a commit; exits 0 only when the bar holds
//   node scripts/parity-suite.mjs promote <fixture> must-pass, once every backend the fixture names ran clean
//   node scripts/parity-suite.mjs list              the shipped suite
//   [--suite <file>] [--store <dir>] [--commit <id>] [--now <time>] [--planted <name>]
//
// A lane's runner is started once, asked for each fixture and then each of its twins, one JSON line each, and never
// asked twice. A fixture passes only when its own run passed and every twin failed: a twin that passes, or no twin,
// is INVALID, and so is a comparison whose planted-mismatch twin leaves it passing. What can't run is BLOCKED with its
// reason, its owner and its age, two different results of one commit on this machine are INCONCLUSIVE with both
// attached, and a waiver or expected failure whose fixture passes ends itself. The store keeps what the suite must
// remember between runs. Each subcommand prints one JSON object as its last line. Never on push or pull request.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const LANES = ['quick', 'full', 'cross', 'oracle'];
/** The wrong suites criterion 8 names, each reachable only through `--planted`. */
const PLANTED = ['expected_failure_kept', 'expected_failure_by_backend', 'promoted_on_one_backend'];
/** Worst first: what a fixture reads when its lanes disagree. */
const RANK = ['FAIL', 'INVALID', 'INCONCLUSIVE', 'BLOCKED', 'PASS'];

function usage() {
  console.error('usage: node scripts/parity-suite.mjs run <quick|full|cross|oracle> | report | promote <fixture> | list  [--suite <file>] [--store <dir>] [--commit <id>] [--now <time>] [--planted <name>]');
  process.exit(2);
}
const words = [], options = {};
for (let args = process.argv.slice(2); args.length;) {
  const arg = args.shift();
  if (!arg.startsWith('--')) words.push(arg);
  else if (['--suite', '--store', '--commit', '--now', '--planted'].includes(arg) && args.length) options[arg.slice(2)] = args.shift();
  else usage();
}
const [command, subject] = words;
if (options.planted !== undefined && !PLANTED.includes(options.planted)) usage();
if (!({ run: LANES.includes(subject), report: subject === undefined, promote: subject !== undefined, list: subject === undefined })[command] || words.length > 2) usage();

const suite = JSON.parse(readFileSync(options.suite ?? join(root, 'scripts', 'parity-suite.json'), 'utf8'));
const now = Date.parse(options.now ?? new Date().toISOString());
if (Number.isNaN(now)) usage();
const commit = options.commit ?? spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
if (!commit) {
  console.error('parity-suite: no --commit, and git names no HEAD here');
  process.exit(2);
}

// The store: one JSON file per kind of thing remembered, each rewritten whole through a rename.
const store = options.store ?? join(homedir(), '.deepbuild', 'parity-suite');
const file = (name) => join(store, `${name}.json`);
function load(name, empty) {
  try { return JSON.parse(readFileSync(file(name), 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return empty;
    throw error;
  }
}
function save(name, value) {
  mkdirSync(store, { recursive: true });
  writeFileSync(`${file(name)}.${process.pid}`, `${JSON.stringify(value)}\n`);
  renameSync(`${file(name)}.${process.pid}`, file(name));
}

/** `promote <fixture>`: must-pass, once the store holds a clean run on every backend the fixture names. */
function promote() {
  const fixture = suite.fixtures.find((f) => f.name === subject);
  if (!fixture) return [{ outcome: 'refused', code: 'unknown_fixture', fixture: subject }, 1];
  const clean = load('clean', {})[subject] ?? {};
  const missing = fixture.backends.filter((backend) => !clean[backend]);
  // The planted suite promotes after a clean run on any one of the backends the fixture names.
  const refused = options.planted === 'promoted_on_one_backend' ? missing.length === fixture.backends.length : missing.length > 0;
  if (refused) return [{ outcome: 'refused', code: 'clean_runs_missing', fixture: subject, missing }, 1];
  save('must-pass', [...new Set([...load('must-pass', []), subject])]);
  return [{ outcome: 'promoted', fixture: subject }, 0];
}

/** `report`: every fixture's verdict on the commit, and the bar over them. */
function report() {
  const rows = load(`rows-${commit}`, {});
  const mustPass = load('must-pass', []);
  const fixtures = [], failures = [], readings = [];
  for (const f of suite.fixtures) {
    // A lane that has no row for this commit didn't run on it, and nothing unrun passes.
    const read = f.lanes.map((lane) => ({ lane, ...rows[lane]?.[f.name] ?? { verdict: 'BLOCKED', reason: 'not_run' } }));
    for (const row of read.filter((r) => r.reading)) readings.push({ fixture: f.name, lane: row.lane });
    const judged = read.filter((r) => !r.reading).sort((a, b) => RANK.indexOf(a.verdict) - RANK.indexOf(b.verdict))[0];
    // A fixture with nothing but readings counts neither way, and is no PASS.
    const entry = { fixture: f.name, category: f.name.split('/')[1], must_pass: mustPass.includes(f.name), verdict: judged?.verdict ?? 'INCONCLUSIVE', reason: judged ? judged.reason ?? null : 'reading', owner: f.owner ?? null };
    fixtures.push(entry);
    const holds = entry.verdict === 'PASS' || (!entry.must_pass && (!judged || (entry.verdict === 'BLOCKED' && entry.owner && entry.reason)));
    if (!holds) failures.push({ fixture: f.name, verdict: entry.verdict });
  }
  for (const f of failures) console.log(`FAIL parity bar: ${f.fixture} reads ${f.verdict} on ${commit}`);
  return [{ commit, bar: failures.length ? 'FAIL' : 'PASS', fixtures, failures, readings }, failures.length ? 1 : 0];
}

/** `run <lane>`: the lane's runner asked once for each fixture and twin, and the lane's record. */
function run(lane) {
  const fixtures = suite.fixtures.filter((f) => f.lanes.includes(lane));
  const requests = fixtures.flatMap((f) => [{ lane, fixture: f.name, twin: null }, ...f.twins.map((twin) => ({ lane, fixture: f.name, twin }))]);
  const runner = suite.lanes?.[lane]?.runner ?? [];
  const started = runner.length ? spawnSync(runner[0], runner.slice(1), { cwd: root, input: requests.map((r) => `${JSON.stringify(r)}\n`).join(''), encoding: 'utf8', maxBuffer: 2 ** 30, stdio: ['pipe', 'pipe', 'inherit'] }) : { error: Error('no runner') };
  // A runner that can't be started answers nothing; one that stops early leaves the rest unanswered.
  const lines = started.error ? [] : started.stdout.split('\n').filter((line) => line.trim());
  const replies = requests.map((_, i) => {
    if (started.error) return { verdict: 'BLOCKED', reason: 'no_runner' };
    try { return JSON.parse(lines[i]); } catch { return { verdict: 'BLOCKED', reason: 'no_reply' }; }
  });

  const machine = hostname();
  const results = load(`results-${commit}`, {});
  const mine = ((results[machine] ??= {})[lane] ??= {});
  const rowsOfCommit = load(`rows-${commit}`, {});
  const blocked = load('blocked', {});
  const since = (blocked[lane] ??= {});
  const ended = load('ended', []);
  const clean = load('clean', {});
  const endedNow = [];
  const rows = [];
  let at = 0;
  for (const f of fixtures) {
    const own = { ...replies[at++] };
    const twinReplies = f.twins.map(() => replies[at++]);
    // What a lane recorded for this commit stands when a later run of it there can't run.
    const before = rowsOfCommit[lane]?.[f.name];
    if (own.verdict === 'BLOCKED' && before && before.verdict !== 'BLOCKED') {
      rows.push(before);
      continue;
    }
    // A pixel comparison past the fixture's loose ceiling or under its IoU floor fails in any lane; within both it is
    // a reading in the cross lane, where pixel numbers come from another machine.
    let reading = false;
    if (f.pixels && own.pixels) {
      if (own.pixels.flip > f.pixels.loose_ceiling) Object.assign(own, { verdict: 'FAIL', reason: 'past_loose_ceiling' });
      else if (own.pixels.iou < f.pixels.iou_floor) Object.assign(own, { verdict: 'FAIL', reason: 'under_iou_floor' });
      else if (lane === 'cross') [own.verdict, reading] = ['INCONCLUSIVE', true];
    }
    const kept = (mine[f.name] ??= []);
    const ran = own.verdict === 'PASS' || own.verdict === 'FAIL';
    if (ran && !kept.some((r) => r.verdict === own.verdict && r.digest === (own.digest ?? null))) kept.push({ verdict: own.verdict, digest: own.digest ?? null });

    // A twin passes when its run passed, or, where it names a comparison, when that comparison still passes in its run.
    const passed = (twin, reply) => {
      const compared = twin.comparison && reply.comparisons?.find((c) => c.name === twin.comparison);
      return compared ? compared.verdict === 'PASS' : reply.verdict === 'PASS';
    };
    const twins = f.twins.map((twin, i) => ({ name: twin.name, verdict: passed(twin, twinReplies[i]) ? 'PASS' : ['BLOCKED', 'INCONCLUSIVE'].includes(twinReplies[i].verdict) ? twinReplies[i].verdict : 'FAIL' }));
    const comparisons = (own.comparisons ?? []).map((c) => {
      const twin = twins[f.twins.findIndex((t) => t.comparison === c.name)];
      if (!twin) return { name: c.name, verdict: 'INVALID', reason: 'no_twin', twin: null };
      if (twin.verdict === 'PASS') return { name: c.name, verdict: 'INVALID', reason: 'twin_passed', twin };
      return { name: c.name, verdict: c.verdict, reason: null, twin };
    });

    let verdict = own.verdict, reason = own.reason ?? null;
    // Nothing is retried, and no later run replaces an earlier one: two different results of one commit are no result.
    if (ran && kept.length > 1) [verdict, reason] = ['INCONCLUSIVE', 'two_results'];
    else if (verdict === 'PASS') {
      if (!f.twins.length) [verdict, reason] = ['INVALID', 'no_twin'];
      else if (twins.some((t) => t.verdict === 'PASS')) [verdict, reason] = ['INVALID', 'twin_passed'];
      else if (comparisons.some((c) => c.verdict === 'INVALID')) [verdict, reason] = ['INVALID', 'no_twin'];
      else if (twins.some((t) => t.verdict !== 'FAIL')) [verdict, reason] = ['BLOCKED', 'twin_not_run'];
    }

    // Waivers and expected failures: BLOCKED with the entry's reason while the fixture fails, ended when it passes.
    const byBackend = options.planted === 'expected_failure_by_backend';
    const entries = [
      ...(suite.waivers ?? []).filter((w) => w.fixture === f.name).map((entry) => ({ kind: 'waiver', entry })),
      ...(suite.expected_failures ?? [])
        .filter((e) => e.fixture === f.name && e.backend === own.backend && (byBackend || (e.adapter === own.adapter?.name && e.driver === own.adapter?.driver)))
        .map((entry) => ({ kind: 'expected_failure', entry })),
    ].filter(({ kind, entry }) => !ended.includes(JSON.stringify([kind, entry])));
    if (verdict === 'FAIL' && entries.length) [verdict, reason] = ['BLOCKED', entries[0].entry.reason];
    else if (verdict === 'PASS') {
      for (const { kind, entry } of entries) {
        // The planted suite keeps an expected failure after its fixture passes.
        if (kind === 'expected_failure' && options.planted === 'expected_failure_kept') continue;
        ended.push(JSON.stringify([kind, entry]));
        endedNow.push({ kind, fixture: f.name });
      }
      if (own.backend) (clean[f.name] ??= {})[own.backend] = commit;
    }

    if (verdict === 'BLOCKED') since[f.name] ??= new Date(now).toISOString();
    else delete since[f.name];
    const began = verdict === 'BLOCKED' ? since[f.name] : null;
    rows.push({
      fixture: f.name, verdict, reason, owner: f.owner ?? null,
      since: began, age_days: began === null ? null : Math.floor((now - Date.parse(began)) / 86_400_000),
      twins, comparisons, results: kept, reading,
      ...(own.backend ? { backend: own.backend } : {}), ...(own.adapter ? { adapter: own.adapter } : {}),
    });
  }
  rowsOfCommit[lane] = Object.fromEntries(rows.map((row) => [row.fixture, row]));
  save(`results-${commit}`, results);
  save(`rows-${commit}`, rowsOfCommit);
  save('blocked', blocked);
  save('ended', ended);
  save('clean', clean);

  for (const row of rows.filter((r) => r.verdict !== 'PASS')) {
    const block = row.verdict === 'BLOCKED' ? ` (owner ${row.owner ?? 'none'}, ${row.age_days} days)` : '';
    console.log(`${row.verdict} parity ${lane}: ${row.fixture}${row.reason ? `: ${row.reason}` : ''}${row.reading ? ' (a reading)' : ''}${block}`);
  }
  for (const e of endedNow) console.log(`ENDED parity ${lane}: the ${e.kind.replace('_', ' ')} of ${e.fixture}, which passes again`);
  // What couldn't run is BLOCKED for the release bar to weigh; the lane itself fails on what ran and didn't hold.
  const held = rows.every((r) => r.verdict === 'PASS' || r.verdict === 'BLOCKED' || r.reading);
  return [{ lane, commit, rows, ended: endedNow }, held ? 0 : 1];
}

// Stdout drains before the process ends, so a long record is never cut short.
const [answer, status] = command === 'list' ? [suite, 0] : command === 'promote' ? promote() : command === 'report' ? report() : run(subject);
console.log(JSON.stringify(answer));
process.exitCode = status;
