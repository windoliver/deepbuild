// The suites a change's paths call for (#569): the lifecycle enumerator over the lifecycle tables, the
// hub's crash suite, and the verdict replay of the seeded false "done" cases and the cheat corpus on
// the merge base and on the change.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { git, listFiles, show, underTestPaths } from './proof-change.mjs';
import { baseCheckout, changeCopy, childEnv, place, temporary } from './proof-runs.mjs';

export const TABLES = /^packages\/contracts\/schemas\/[^/]+\.machine@\d+\.json$/;
export const STORAGE = (path) => path === 'packages/hub/src/vfs.ts' || path.startsWith('packages/record/src/');
export const ENGINE = (path) => path.startsWith('packages/verdicts/src/');
const firstLine = (text) => String(text ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? '';

/** Every reachable state of each table must have a sequence of moves to a final state. */
export function lifecycle(root, tables, say) {
  const fix = 'Give every state reachable from the initial one a sequence of moves to a final state.';
  for (const path of tables) {
    let table;
    try {
      table = JSON.parse(show(root, null, path));
    } catch (error) {
      say('FAIL', 'lifecycle', `${path}: not JSON: ${error.message}`, fix);
      continue;
    }
    const { id = path, states, initial, final, moves } = table ?? {};
    const shape = Array.isArray(states) && states.includes(initial) && Array.isArray(final) && final.every((state) => states.includes(state)) && Array.isArray(moves)
      && moves.every((move) => states.includes(move?.from) && states.includes(move?.to) && typeof move.event === 'string');
    if (!shape) {
      say('FAIL', 'lifecycle', `${id}: not a lifecycle table: it needs states, an initial and final states among them, and moves { from, event, to } between them (${path})`, fix);
      continue;
    }
    const reachable = new Set([initial]);
    for (const state of reachable) for (const move of moves) if (move.from === state) reachable.add(move.to);
    const ends = new Set(final);
    for (let grew = true; grew;) {
      grew = false;
      for (const move of moves) if (ends.has(move.to) && !ends.has(move.from)) grew = ends.add(move.from);
    }
    const stuck = [...reachable].filter((state) => !ends.has(state));
    for (const state of stuck) say('FAIL', 'lifecycle', `${id}: state ${state} has no move to a final state (${path})`, fix);
    if (!stuck.length) say('PASS', 'lifecycle', `${id}: each of its ${reachable.size} reachable states reaches a final state`);
  }
}

/**
 * The hub's crash suite, tests/acceptance/16/crash*.test.ts, with the repository's vitest, on a copy of
 * the change. The merge base's tests and vitest config run as main holds them, so a change can't skip,
 * drop or weaken a crash test, or a helper it reads, that catches it.
 */
export function crash({ root, change }, say) {
  const fix = 'Repair the durable write the crash suite names, or install the repository (npm ci) so its vitest runs.';
  const suite = (path) => /^tests\/acceptance\/16\/crash[^/]*\.test\.ts$/.test(path);
  // With main's helpers, fixtures and vitest config too, the files the suite reads.
  const harness = (path) => underTestPaths(path) || /^vitest\.(?:config|workspace)\.[cm]?[jt]s$/.test(path);
  const held = git(root, ['ls-tree', '-r', '-z', '--name-only', change.base]).split('\0').filter(harness);
  const files = [...new Set([...held, ...listFiles(root)].filter(suite))].sort();
  if (!files.length) return say('BLOCKED', 'crash', 'no crash suite at tests/acceptance/16/crash*.test.ts', fix);
  const { directory, blocked } = changeCopy(root, change);
  if (blocked) return say('BLOCKED', 'crash', `cannot prepare a copy of the change: ${blocked}`, fix);
  try {
    for (const path of held) writeFileSync(place(directory, path), show(root, change.base, path));
  } catch (error) {
    return say('BLOCKED', 'crash', `cannot lay main's crash suite over the change: ${error.message}`, fix);
  }
  const vitest = join(directory, 'node_modules/vitest/vitest.mjs');
  if (!existsSync(vitest)) return say('BLOCKED', 'crash', 'vitest is not installed in the repository checked', fix);
  const report = join(temporary('deep-proof-crash-'), 'report.json');
  const result = spawnSync(process.execPath, [vitest, 'run', '--no-file-parallelism', '--reporter=json', `--outputFile=${report}`, ...files], { cwd: directory, env: childEnv(), encoding: 'utf8', maxBuffer: 1 << 28, timeout: 20 * 60_000 });
  const tests = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : null;
  if (!tests) return say('BLOCKED', 'crash', `vitest wrote no report: ${firstLine(result.stderr)}`, fix);
  // A file fails outside its tests when a hook or its imports fail, and a run fails outside every file
  // on an error none of its tests caught, such as a rejection the storage code left unhandled.
  const failed = tests.testResults.flatMap(({ name, status, message, assertionResults }) => {
    const own = assertionResults.filter(({ status: state }) => state === 'failed').map(({ fullName, failureMessages }) => `${fullName}: ${firstLine(failureMessages?.[0])}`);
    return own.length || status !== 'failed' ? own : [`${name.split(`${directory}/`).join('')}: failed outside its tests (${firstLine(message) || 'in a hook'})`];
  });
  if (!failed.length && result.status !== 0) failed.push(`vitest exited ${result.status ?? result.signal} with no test failed, on an error no test caught${((line) => (line ? `: ${firstLine(line)}` : ''))(`${result.stdout}\n${result.stderr}`.split('\n').find((line) => /Error/.test(line)))}`);
  if (failed.length) for (const failure of failed) say('FAIL', 'crash', failure, fix);
  else if (!tests.numPassedTests) say('INVALID', 'crash', `${files.join(', ')} ran no test`, fix);
  else say('PASS', 'crash', `${files.join(', ')}: ${tests.numPassedTests} passed`);
}

/**
 * The verdict replay: each seeded false "done" case and cheat-corpus case of the change runs through
 * the verdict engine on the merge base and on the change, and every verdict that differs is listed.
 * The merge base's cases replay as main holds them, so a change can't drop or rewrite one it moves.
 * A list differs from main only with the maintainer's yes: an approval on HEAD naming its digest.
 */
export function replay({ root, change }, approvals, say) {
  const fix = 'Restore the verdicts that moved, or ask the maintainer to approve the list with an SSH-signed tag on HEAD under deep/approved/ holding Approves: replay sha256:<digest>.';
  const seeded = (path) => /^tests\/fixtures\/(?:false-done|cheat)\/[^/]+\.json$/.test(path);
  const held = git(root, ['ls-tree', '-r', '-z', '--name-only', change.base]).split('\0').filter(seeded);
  const cases = [...new Set([...held, ...listFiles(root).filter(seeded)])].sort();
  if (!cases.length) return say('BLOCKED', 'replay', 'no seeded false "done" case (tests/fixtures/false-done/*.json) or cheat-corpus case (tests/fixtures/cheat/*.json) to replay', fix);
  const read = cases.map((path) => {
    try {
      return JSON.parse(held.includes(path) ? show(root, change.base, path) : show(root, null, path))?.claim;
    } catch {
      return undefined;
    }
  });
  const broken = cases.filter((_, index) => read[index] === undefined);
  if (broken.length) return say('FAIL', 'replay', `not a case, JSON holding a claim: ${broken.join(', ')}`, 'Give each seeded case JSON of the form { "claim": ..., "expected": ... }.');
  const claims = join(temporary('deep-proof-replay-cases-'), 'claims.json');
  writeFileSync(claims, JSON.stringify(read));
  const sides = {};
  // Each side in a prepared checkout of its own, so no build of the change lands in the repository.
  for (const [side, prepared] of [['merge base', baseCheckout], ['change', changeCopy]]) {
    const { directory, blocked } = prepared(root, change);
    if (blocked) return say('BLOCKED', 'replay', `cannot run the verdict engine on the ${side}: ${blocked}`, fix);
    try {
      sides[side] = outcomes(directory, claims);
    } catch (error) {
      return say('BLOCKED', 'replay', `cannot run the verdict engine on the ${side}: ${error.message}`, fix);
    }
  }
  const moved = cases.flatMap((path, index) => {
    const [then, now] = [sides['merge base'][index], sides.change[index]];
    return then === now ? [] : [`${path}: verdict ${then} on the merge base, ${now} on the change`];
  });
  if (!moved.length) return say('PASS', 'replay', `${cases.length} cases replayed: no verdict differs from the merge base`);
  const digest = createHash('sha256').update(moved.join('\n')).digest('hex');
  const yes = (approvals.get(change.head) ?? []).includes(`replay sha256:${digest}`);
  for (const line of moved) say(yes ? 'PASS' : 'FAIL', 'replay', line, fix);
  say(yes ? 'PASS' : 'FAIL', 'replay', `${moved.length} difference${moved.length === 1 ? '' : 's'} ${yes ? 'approved by the maintainer' : "need the maintainer's yes"} (list sha256:${digest})`, fix);
}

// Each claim's verdict outcome from the side's verdict engine, loaded through packages/verdicts'
// package.json exports. The engine runs in a child process, so the change's code never runs inside
// the proof lanes.
const EVALUATE = `import { readFileSync, writeFileSync } from 'node:fs';
const [entry, claims, out] = process.argv.slice(1);
const { verdict } = await import(entry);
if (typeof verdict !== 'function') throw Error('the entry exports no verdict function');
const outcomes = [];
for (const claim of JSON.parse(readFileSync(claims, 'utf8'))) {
  try {
    outcomes.push(String(verdict(claim).outcome));
  } catch (error) {
    outcomes.push(\`an error (\${String(error?.message ?? error).split('\\n')[0]})\`);
  }
}
writeFileSync(out, JSON.stringify(outcomes));
`;
function outcomes(directory, claims) {
  const manifest = join(directory, 'packages/verdicts/package.json');
  if (!existsSync(manifest)) throw Error('no packages/verdicts/package.json');
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  // A repository without workspaces has no workspace build, so the engine's own build runs here.
  const root = join(directory, 'package.json');
  if (pkg.scripts?.build && !(existsSync(root) && JSON.parse(readFileSync(root, 'utf8')).workspaces)) {
    const built = spawnSync('npm', ['run', 'build'], { cwd: join(directory, 'packages/verdicts'), env: childEnv(), encoding: 'utf8', maxBuffer: 1 << 28, timeout: 20 * 60_000 });
    if (built.status !== 0) throw Error(`npm run build failed in packages/verdicts: ${firstLine(built.stderr)}`);
  }
  const exported = typeof pkg.exports === 'string' ? pkg.exports : pkg.exports?.['.'];
  const entry = typeof exported === 'string' ? exported : exported?.import ?? exported?.default;
  if (!entry) throw Error('packages/verdicts/package.json exports no entry');
  const out = join(temporary('deep-proof-replay-out-'), 'outcomes.json');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', EVALUATE, pathToFileURL(join(directory, 'packages/verdicts', entry)).href, claims, out], { cwd: directory, env: childEnv(), encoding: 'utf8', maxBuffer: 1 << 28, timeout: 20 * 60_000 });
  if (result.status !== 0 || !existsSync(out)) throw Error(String(result.stderr).split('\n').find((line) => /^\w*Error\b/.test(line)) ?? (firstLine(result.stderr) || `the engine exited ${result.status} without writing its verdicts`));
  return JSON.parse(readFileSync(out, 'utf8'));
}
