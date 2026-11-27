// Records main's persistent test failures into scripts/known-failures.json (#2818), keeping #1872's rule that
// scripts/affected.mjs --record leaves known-failures.json untouched and every key remains guarded by proof-guard.mjs.
//
//   node scripts/known-failures-record.mjs <path ...>
//   node scripts/known-failures-record.mjs --from-kept <preflight.jsonl | lane-unit.json>
//
// Runs affected.mjs on the given paths (or reads finished test rows from a resumable scripts/preflight kept log or unit
// lane record), re-runs every FAIL test alone up to 3 times to separate flaky failures from persistent ones, files flaky
// failures as `Flaky: <id>` the way scripts/main-watch.mjs files them (never listing them, exiting INCONCLUSIVE), files
// or reuses an open cause issue for each persistent failure, drops entries whose tests pass or whose files/crates are
// gone, and prints the exact `Approves:` lines needed for the owner's SSH touch-key tag.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargoResults, crates, listed, named, reportResults, timed } from './lanes.mjs';
import { childEnv } from './proof-runs.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BASELINE = 'scripts/known-failures.json';
const REPEATS = 3;
const CAUSE = /^(?:Known failure|Main is red): /;
const ISSUE_SUFFIX = /\(#(\d+), added \d{4}-\d{2}-\d{2}\)$/;

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const short = (sha) => sha.slice(0, 10);
const titled = (title) => (title.length <= 256 ? title : `${title.slice(0, 255)}…`);
const singleLine = (text) => (text || 'it fails there').replace(/\s+/g, ' ').trim().slice(0, 300);

/** gh in the checkout, retried twice; a failure stops the record BLOCKED. */
function gh(args) {
  let why = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const run = spawnSync('gh', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (run.status === 0) return run.stdout;
    why = (run.error?.message ?? run.stderr).trim().split('\n')[0];
  }
  throw Error(`BLOCKED record: gh ${args.slice(0, 2).join(' ')} failed: ${why}`);
}

/** Resolves the cwd a JSONL test report was produced from (handles ~/deepbuild-shards/<k> paths). */
function reportCwd(text) {
  const match = text.match(/"file":"(?:file:\/\/)?([^"]+)"/);
  if (!match) return ROOT;
  const shardsDir = `${join(homedir(), 'deepbuild-shards')}/`;
  if (match[1].startsWith(shardsDir)) {
    const k = match[1].slice(shardsDir.length).split('/')[0];
    if (/^\d+$/.test(k)) return join(homedir(), 'deepbuild-shards', k);
  }
  return ROOT;
}

const PASS_THROUGH = new Set(['--wide', '--settled', '--timed', '--slow']);

/** Reads passed, FAIL, and cleanly-completed target rows from a resumable preflight .jsonl or unit lane .json record. */
function readKeptInput(filePath) {
  if (!existsSync(filePath)) throw Error(`BLOCKED record: kept record not found: ${filePath}`);
  const raw = readFileSync(filePath, 'utf8');
  const rows = new Map();
  const ranTargets = new Set();
  const merge = (row) => {
    if (!row?.id || row.skipped) return;
    const prev = rows.get(row.id);
    if (!prev || (prev.state !== 'FAIL' && prev.state !== 'INVALID')) rows.set(row.id, row);
  };
  if (filePath.endsWith('.json')) {
    const parsed = JSON.parse(raw);
    for (const row of parsed.tests ?? []) {
      merge(row);
      if (row?.id && (row.state === 'PASS' || row.state === 'FAIL')) ranTargets.add(row.id.split(' › ')[0]);
    }
  } else {
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let kept;
      try { kept = JSON.parse(line); } catch { continue; }
      for (const file of kept?.files ?? []) ranTargets.add(file);
      for (const row of kept?.tests ?? []) {
        merge(row);
        if (row?.id && (row.state === 'PASS' || row.state === 'FAIL')) ranTargets.add(row.id.split(' › ')[0]);
      }
    }
  }
  const passed = new Set(), failed = new Map();
  for (const row of rows.values()) {
    if (row.state === 'PASS') passed.add(row.id);
    else if (row.state === 'FAIL') failed.set(row.id, row.note ?? '');
  }
  return { passed, failed, ranTargets, incomplete: false };
}

/** Runs affected.mjs on `paths` and collects per-test PASS and FAIL rows from its report logs. */
function runAffected(paths, flags, workspace) {
  const run = spawnSync(process.execPath, [join(ROOT, 'scripts/affected.mjs'), ...flags, ...paths], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const logsDir = output.match(/; logs in ([^\s]+)\s*$/m)?.[1];
  if (!logsDir || !existsSync(logsDir)) {
    const why = output.split('\n').find((line) => /^(?:BLOCKED|INCONCLUSIVE)\b/.test(line)) ?? `affected.mjs exited ${run.status} without logs`;
    throw Error(/^(?:BLOCKED|INCONCLUSIVE)\b/.test(why) ? why : `BLOCKED record: ${why}`);
  }
  const passed = new Set(), failed = new Map(), ranTargets = new Set();
  let incomplete = /^INCONCLUSIVE .*(?:not started:|not finished:|no grant|stood still|were not run|was not run)/m.test(output);
  for (const entry of readdirSync(logsDir).sort()) {
    const full = join(logsDir, entry);
    if (entry.endsWith('.jsonl')) {
      const text = readFileSync(full, 'utf8');
      const label = entry.slice(0, -6);
      const res = reportResults(reportCwd(text), text, label);
      const jobIncomplete = Boolean(res.noGrant || res.cut || res.failures.some((f) => f.id === `${label} report` || f.id === 'vitest › unhandled error'));
      if (jobIncomplete) incomplete = true;
      for (const id of res.passed) {
        passed.add(id);
        if (!jobIncomplete) ranTargets.add(id.split(' › ')[0]);
      }
      for (const f of res.failures) {
        if (f.state === 'FAIL' && !f.id.endsWith(' report') && f.id !== 'vitest › unhandled error') {
          failed.set(f.id, f.message ?? '');
          if (!jobIncomplete) ranTargets.add(f.id.split(' › ')[0]);
        } else if (f.state === 'INCONCLUSIVE' || f.state === 'BLOCKED') incomplete = true;
      }
    } else if (entry === 'cargo.log') {
      const text = readFileSync(full, 'utf8');
      const cargoFailed = /test result: FAILED|^error(?:\[|\s*:)/m.test(text);
      const res = cargoResults(text, cargoFailed ? 101 : 0, workspace);
      if (res.noGrant) incomplete = true;
      for (const id of res.passed) {
        passed.add(id);
        if (!res.noGrant) ranTargets.add(id.split(' › ')[0]);
      }
      for (const f of res.failures) {
        if (f.state === 'FAIL') {
          failed.set(f.id, f.message ?? '');
          if (!res.noGrant) ranTargets.add(f.id.split(' › ')[0]);
        } else if (f.state === 'INCONCLUSIVE' || f.state === 'BLOCKED') incomplete = true;
      }
    }
  }
  return { passed, failed, ranTargets, incomplete };
}

/** Runs one failing target's tests alone under throttle + lease, returning the IDs that passed/failed or `noGrant`. */
function runOnce(target, ids, workspace, scratch, index) {
  const lease = [join(ROOT, 'scripts/lease')];
  const throttle = (cls, argv, env = {}) => spawnSync(
    process.execPath,
    [join(ROOT, 'scripts/throttle.mjs'), cls, '--wait', '30', '--', ...lease, ...argv],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, env: childEnv(env) },
  );
  if (target.startsWith('cargo ')) {
    const names = ids.map((id) => id.split(' › ')[1]).filter(Boolean);
    const args = ['test', '--locked', ...target.slice(6).split(' '), ...(names.length === ids.length ? ['--', '--exact', ...names] : [])];
    const run = throttle('build', ['cargo', ...args]);
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const res = cargoResults(output, run.status ?? 1, workspace);
    if (res.noGrant) return { passed: new Set(), failed: new Set(), noGrant: res.noGrant };
    const whole = ids.filter((id) => !id.includes(' › '));
    return {
      passed: new Set([...res.passed, ...(run.status === 0 ? whole : [])]),
      failed: new Set([...res.failures.filter((f) => f.state === 'FAIL').map((f) => f.id), ...(run.status === 0 ? [] : whole)]),
    };
  }
  if (!existsSync(join(ROOT, target))) return { passed: new Set(), failed: new Set() };
  const source = readFileSync(join(ROOT, target), 'utf8');
  const isVitest = target.endsWith('.ts') || /\bfrom\s+['"]vitest['"]/.test(source);
  const isTimed = listed(timed, target);
  const cls = isTimed ? 'timed' : 'test';
  const reportFile = join(scratch, `rerun-${index}.jsonl`);
  const titles = ids.map((id) => id.split(' › ').at(-1));
  const whole = titles.includes('(file)');
  let run;
  if (isVitest) {
    const argv = [
      process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism',
      ...(isTimed ? ['--testTimeout=600000'] : []),
      '--reporter=dot', '--reporter=./scripts/proof-vitest-reporter.mjs',
      ...(whole ? [] : ['-t', titles.map(escapeRegex).join('|')]),
      target,
    ];
    run = throttle(cls, argv, { DEEP_PROOF_VITEST_REPORT: reportFile });
  } else {
    const segments = [...new Set(ids.flatMap((id) => id.split(' › ').slice(1)))];
    const argv = [
      process.execPath, '--test', '--test-concurrency=1',
      '--test-reporter=./scripts/proof-reporter.mjs', `--test-reporter-destination=${reportFile}`,
      '--test-reporter=dot', '--test-reporter-destination=stdout',
      ...(whole ? [] : [`--test-name-pattern=${segments.map(escapeRegex).join('|')}`]),
      target,
    ];
    run = throttle(cls, argv);
  }
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const grantErr = output.match(/^(?:INCONCLUSIVE|BLOCKED) (?:no grant|throttle): (.+)/m)?.[1];
  const report = existsSync(reportFile) ? readFileSync(reportFile, 'utf8') : '';
  const res = reportResults(ROOT, report, isVitest ? `vitest-rerun-${index}` : `node-rerun-${index}`);
  if (res.noGrant || grantErr) return { passed: new Set(), failed: new Set(), noGrant: res.noGrant ?? grantErr };
  const passed = new Set(res.passed);
  const failed = new Set(res.failures.filter((f) => f.state === 'FAIL').map((f) => f.id));
  if (whole) (passed.size && !res.failures.length ? passed : failed).add(named(target, '(file)'));
  return { passed, failed };
}

function main(args) {
  const keptIdx = args.indexOf('--from-kept');
  const keptPath = keptIdx >= 0 ? args[keptIdx + 1] : null;
  const rest = args.filter((_, i) => i !== keptIdx && (keptIdx < 0 || i !== keptIdx + 1));
  const flags = rest.filter((arg) => PASS_THROUGH.has(arg));
  const paths = rest.filter((arg) => !arg.startsWith('--'));
  const unknown = rest.filter((arg) => arg.startsWith('--') && !PASS_THROUGH.has(arg));
  if (unknown.length || (keptIdx >= 0 && !keptPath) || (!keptPath && !paths.length)) {
    console.log('usage: node scripts/known-failures-record.mjs [--wide] [--settled] [--timed] [--slow] <path ...>\n       node scripts/known-failures-record.mjs --from-kept <preflight.jsonl | lane-unit.json>');
    return 2;
  }

  const headRun = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  const head = headRun.status === 0 ? headRun.stdout.trim() : '';
  if (!head) {
    console.log('BLOCKED record: git names no HEAD here, so no entry can name the head it fails at');
    return 3;
  }
  const day = new Date().toISOString().slice(0, 10);
  const workspace = crates(ROOT);
  const crateNames = new Set(workspace.map((pkg) => pkg.name));

  let collected;
  try {
    collected = keptPath ? readKeptInput(keptPath) : runAffected(paths, flags, workspace);
  } catch (error) {
    console.log(error.message);
    return error.message.startsWith('INCONCLUSIVE') ? 2 : 3;
  }

  const baselinePath = join(ROOT, BASELINE);
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const beforeFailures = { ...(baseline.failures ?? {}) };
  baseline.failures = { ...beforeFailures };

  const scratch = mkdtempSync(join(tmpdir(), 'deep-record-'));
  let flakyCount = 0, unrunCount = 0;
  try {
    const byTarget = new Map();
    for (const [id, message] of collected.failed) {
      const target = id.split(' › ')[0];
      if (!byTarget.has(target)) byTarget.set(target, []);
      byTarget.get(target).push({ id, message });
    }
    const runs = new Map([...collected.failed.keys()].map((id) => [id, []]));
    let idx = 0;
    for (const [target, list] of byTarget) {
      let pending = list.map((item) => item.id);
      for (let repeat = 1; repeat <= REPEATS && pending.length; repeat++) {
        const res = runOnce(target, pending, workspace, scratch, idx++);
        for (const id of pending) runs.get(id).push(res.passed.has(id) ? 'PASS' : res.failed.has(id) ? 'FAIL' : 'UNRUN');
        pending = pending.filter((id) => !res.passed.has(id));
        if (res.noGrant) break;
      }
    }

    let issues = null;
    const openIssues = () => (issues ??= JSON.parse(gh(['issue', 'list', '--state', 'open', '--limit', '5000', '--json', 'number,title,body'])));
    const fileIssue = (title, body) => {
      const num = Number(gh(['issue', 'create', '--title', title, '--body', body]).trim().match(/(\d+)\/?$/)?.[1]);
      if (!num) throw Error(`BLOCKED record: gh issue create named no issue for ${title}`);
      openIssues().push({ number: num, title, body });
      return num;
    };

    const persistentByTarget = new Map();
    for (const [id, message] of collected.failed) {
      const history = runs.get(id);
      if (history.includes('PASS')) {
        flakyCount++;
        const title = titled(`Flaky: ${id}`);
        const lines = [`FAIL on ${short(head)} in the record's run`, ...history.map((state, i) => `${state} on ${short(head)} run alone, repeat ${i + 1} of ${REPEATS}`)];
        const num = openIssues().find((it) => it.title === title)?.number ?? fileIssue(
          title,
          `INCONCLUSIVE: ${id} failed on main at ${short(head)} and passed when run alone again (\`node scripts/known-failures-record.mjs\`, #2818, filed as the main watch files one, #1333).\n\n${message}\n\nRuns:\n${lines.map((line) => `- ${line}`).join('\n')}`,
        );
        delete baseline.failures[id];
        console.log(`INCONCLUSIVE record: ${id} failed on main at ${short(head)} and passed run alone, so it reads flaky and is not listed (#${num})`);
      } else if (history.length < REPEATS || history.some((state) => state !== 'FAIL')) {
        unrunCount++;
        console.log(`INCONCLUSIVE record: ${id} could not complete all ${REPEATS} alone repeats, so it is not listed`);
      } else {
        const target = id.split(' › ')[0];
        if (!persistentByTarget.has(target)) persistentByTarget.set(target, []);
        persistentByTarget.get(target).push({ id, message });
      }
    }

    for (const id of collected.passed) delete baseline.failures[id];
    for (const id of Object.keys(baseline.failures)) {
      const target = id.split(' › ')[0];
      const crate = target.match(/^cargo -p (\S+)/)?.[1];
      const gone = crate ? !crateNames.has(crate) : !target.startsWith('cargo ') && !existsSync(join(ROOT, target));
      const droppedInRun = collected.ranTargets.has(target) && !collected.failed.has(id);
      if (gone || droppedInRun) delete baseline.failures[id];
    }

    for (const [target, list] of persistentByTarget) {
      const resolved = list.map((item) => {
        const prevNum = Number(beforeFailures[item.id]?.match(ISSUE_SUFFIX)?.[1]);
        return { ...item, prevOpen: prevNum && openIssues().some((it) => it.number === prevNum) ? prevNum : null };
      });
      const needIssue = resolved.filter((item) => !item.prevOpen);
      const targetIssue = needIssue.length
        ? openIssues().find((it) => CAUSE.test(it.title) && `${it.title}\n${it.body}`.includes(target))?.number ?? fileIssue(
          titled(`Known failure: ${target} fails on main`),
          `\`node scripts/known-failures-record.mjs\` (#2818) found ${needIssue.length === 1 ? 'this test' : 'these tests'} failing on main at ${short(head)}, and none passed when run alone again, so it lists ${needIssue.length === 1 ? 'it' : 'them'} in \`scripts/known-failures.json\`, added ${day}:\n\n${needIssue.map(({ id: tid, message: msg }) => `- \`${tid}\`${msg ? `: ${singleLine(msg)}` : ''}`).join('\n')}\n\nA listed failure lapses 14 days after it was added (#1333): fix each and take its entry out, or the lint lane fails it then.`,
        )
        : null;
      for (const { id, message, prevOpen } of resolved) {
        baseline.failures[id] = `fails on main ${short(head)}: ${singleLine(message)} (#${prevOpen ?? targetIssue}, added ${day})`;
      }
    }

    const tmp = `${baselinePath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(baseline, null, 2)}\n`);
    renameSync(tmp, baselinePath);

    const approvals = Object.entries(baseline.failures)
      .filter(([id, note]) => beforeFailures[id] !== note)
      .map(([id]) => `${BASELINE} › ${id}`);
    const removed = Object.keys(beforeFailures).filter((id) => !Object.hasOwn(baseline.failures, id));
    for (const item of approvals) console.log(`Approves: ${item}`);
    const state = flakyCount || unrunCount || collected.incomplete ? 'INCONCLUSIVE' : 'PASS';
    console.log(`${state} record: ${approvals.length} added or updated, ${removed.length} removed, ${flakyCount} flaky, ${unrunCount} unrun at main ${short(head)}`);
    return state === 'PASS' ? 0 : 2;
  } catch (error) {
    console.log(error.message);
    return error.message.startsWith('INCONCLUSIVE') ? 2 : 3;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
