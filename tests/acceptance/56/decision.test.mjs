// #56: review time, the decision rule, the budgets on the reference Mac, the startup timing and the
// written decision. Numbers a person or the reference Mac produced are read from the spike's
// record, spikes/hub-core/results.json; the commands that produce the machine's numbers are run
// here too, so the record can't name a command that doesn't measure.
// Run: node --test --test-concurrency=1 tests/acceptance/56/decision.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { checks } from '../../../scripts/lanes.mjs';
import { validateBudgets } from '../../../scripts/benchmark.mjs';
import { BASE, FIX_ROUNDS, results, REVIEW_RATIO, root, scratch, SESSIONS, show, SPIKE, spike, VARIANTS, WITHIN } from './helpers.mjs';

const REVIEW = '#56.6fcf7fe2';
const BUDGETS = '#56.31f12028';
const SCOPE = '#56 scope';
const CRITERIA = ['#56.d29f38cc', '#56.80ab2a58', '#56.57268f7d', '#56.6526364c', '#56.6fcf7fe2', '#56.31f12028'];
const TASKS = { plain: 'hub-core-plain', effect: 'hub-core-effect' };
const EFFECT_PACKAGES = /^(?:effect|@effect\/.+)$/;

const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const json = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const exact = (spec) => typeof spec === 'string' && /^\d+\.\d+\.\d+$/.test(spec);
const spikePin = (name) => { const manifest = json(`${SPIKE}/package.json`); return manifest.dependencies?.[name] ?? manifest.devDependencies?.[name]; };

// Every manifest outside the spike: the root's and each workspace package's.
function manifests() {
  const packages = existsSync(join(root, 'packages')) ? readdirSync(join(root, 'packages')).filter((name) => existsSync(join(root, 'packages', name, 'package.json'))).map((name) => `packages/${name}/package.json`) : [];
  return ['package.json', ...packages].map((path) => ({ path, manifest: json(path) }));
}
const effectDeps = (manifest) => Object.entries({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }).filter(([name]) => EFFECT_PACKAGES.test(name));

// What failed on the Effect side, by the record's own numbers. Anything missing counts as failed.
function effectFailures(record) {
  const failures = [];
  const plain = record.variants?.plain ?? {}, effect = record.variants?.effect ?? {};
  if (!Array.isArray(effect.failed)) failures.push('variants.effect.failed is missing');
  else for (const id of effect.failed) failures.push(`the Effect build failed ${id}`);
  if (!(Number.isSafeInteger(effect.fixRounds) && effect.fixRounds <= FIX_ROUNDS)) failures.push(`Effect fix rounds ${effect.fixRounds}`);
  if (!(positive(plain.reviewMinutes) && positive(effect.reviewMinutes))) failures.push('a review time is missing');
  else if (effect.reviewMinutes > REVIEW_RATIO * plain.reviewMinutes) failures.push(`review took ${effect.reviewMinutes} min against plain's ${plain.reviewMinutes}`);
  const bench = record.budgets?.bench ?? {};
  for (const [metric, what] of [['holdP50Ms', 'hold latency'], ['hubPeakBytes', 'memory']]) {
    const [p, e] = [bench.plain?.[metric], bench.effect?.[metric]];
    if (!(positive(p) && positive(e))) failures.push(`${what} is missing`);
    else if (e > (1 + WITHIN) * p) failures.push(`${what} ${e} is more than 10% over plain's ${p}`);
  }
  return failures;
}

test(`${REVIEW} the record holds a decision, each build's review time and what each build failed`, () => {
  const record = results();
  assert.ok(['plain', 'effect'].includes(record.decision), `decision is "plain" or "effect": ${JSON.stringify(record.decision)}`);
  for (const variant of VARIANTS) {
    const entry = record.variants?.[variant];
    assert.ok(entry, `the record has an entry for ${variant}`);
    assert.ok(Array.isArray(entry.failed) && entry.failed.every((id) => CRITERIA.includes(id)), `variants.${variant}.failed lists criterion IDs it failed, or nothing: ${JSON.stringify(entry.failed)}`);
    assert.ok(entry.reviewMinutes === null || positive(entry.reviewMinutes), `variants.${variant}.reviewMinutes is the maintainer's review time, or null when not reviewed: ${JSON.stringify(entry.reviewMinutes)}`);
  }
  assert.deepEqual(record.variants.plain.failed, [], 'the plain build is what the hub falls back to, so it must meet every criterion');
  if (record.decision === 'effect') {
    const { plain, effect } = record.variants;
    assert.ok(positive(plain.reviewMinutes) && positive(effect.reviewMinutes), `choosing Effect needs both review times: ${JSON.stringify({ plain: plain.reviewMinutes, effect: effect.reviewMinutes })}`);
    assert.ok(effect.reviewMinutes <= REVIEW_RATIO * plain.reviewMinutes, `Effect's review took at most 1.5 times plain's: ${effect.reviewMinutes} min against ${plain.reviewMinutes} min`);
  }
});

test(`${REVIEW} if any criterion fails for Effect, the decision is plain TypeScript`, () => {
  const record = results();
  const failures = effectFailures(record);
  if (failures.length) assert.equal(record.decision, 'plain', `Effect failed: ${failures.join('; ')}`);
  else assert.ok(['plain', 'effect'].includes(record.decision));
});

test(`${BUDGETS} both variants have a budget in benchmarks/budgets.json that perf measures against the merge base`, () => {
  const current = json('benchmarks/budgets.json');
  const baseText = spawnSync('git', ['show', `${BASE}:benchmarks/budgets.json`], { cwd: root, encoding: 'utf8' });
  assert.equal(baseText.status, 0, `BLOCKED: can't read the base commit's budgets: ${baseText.stderr}`);
  validateBudgets(current, JSON.parse(baseText.stdout));
  for (const variant of VARIANTS) {
    const task = current.tasks.find(({ id }) => id === TASKS[variant]);
    assert.ok(task, `budgets.json has a task ${TASKS[variant]}`);
    assert.match(task.command[0], /(?:^|\/)node$/, `the task runs node: ${JSON.stringify(task.command)}`);
    assert.deepEqual(task.command.slice(1), [`${SPIKE}/bench.mjs`, '--variant', variant], `the task runs the hold bench for ${variant}`);
    assert.match(task.initialReason, /#56/, `a first measurement says why, naming issue #56: ${task.initialReason}`);
    assert.ok(positive(task.limits.peakBytes), `the task caps memory: ${JSON.stringify(task.limits)}`);
  }
});

for (const variant of VARIANTS) {
  test(`${BUDGETS} [${variant}] the bench holds 50 sessions' hooks and prints the variant's hold latency, memory and leaked handles`, { timeout: 180_000 }, () => {
    const result = spike('bench.mjs', ['--variant', variant], { timeout: 170_000 });
    assert.equal(result.status, 0, show(result));
    const line = result.objects.find((object) => object.bench === 'hold');
    assert.ok(line, `the bench prints one { "bench": "hold" } line\n${show(result)}`);
    assert.equal(line.variant, variant);
    assert.equal(line.holds, SESSIONS, 'the bench holds one hook in each of 50 sessions');
    assert.ok(positive(line.holdP50Ms) && positive(line.holdP95Ms) && line.holdP95Ms >= line.holdP50Ms, `hold latency at p50 and p95: ${JSON.stringify(line)}`);
    assert.ok(Number.isSafeInteger(line.hubPeakBytes) && line.hubPeakBytes > 10_000_000, `the hub's own peak memory, a Node process's worth: ${JSON.stringify(line)}`);
    assert.ok(Number.isSafeInteger(line.leakedHandles) && line.leakedHandles >= 0, `leaked handles are counted: ${JSON.stringify(line)}`);
  });
}

test(`${BUDGETS} the record holds each variant's numbers from the local preflight on the reference Mac, and Effect is chosen only within 10% of plain`, () => {
  const record = results();
  const { budgets } = record;
  assert.ok(budgets, 'the record has a budgets section');
  assert.equal(budgets.machine?.model, 'Mac15,7', `the numbers come from the reference Mac: ${JSON.stringify(budgets.machine)}`);
  assert.equal(budgets.machine?.reference, true, `on mains power, Low Power Mode off, thermal state nominal: ${JSON.stringify(budgets.machine)}`);
  assert.match(String(budgets.commit), /^[0-9a-f]{40}$/, 'the record names the commit the preflight ran on');
  for (const variant of VARIANTS) {
    const line = (budgets.perf ?? []).find(({ task }) => task === TASKS[variant]);
    assert.ok(line, `the record keeps perf's line for ${TASKS[variant]} from that preflight: ${JSON.stringify(budgets.perf)}`);
    assert.ok(['INITIAL', 'PASS'].includes(line.status), `perf compared ${TASKS[variant]} with the merge base: ${JSON.stringify(line)}`);
    assert.match(String(line.baseCommit), /^[0-9a-f]{40}$/, JSON.stringify(line));
    if (line.status === 'INITIAL') assert.equal(line.base, null, 'a first measurement has no base reading');
    assert.ok(positive(line.current?.p50Ms) && positive(line.current?.peakBytes), JSON.stringify(line));
    const bench = budgets.bench?.[variant];
    assert.ok(bench && bench.variant === variant && bench.holds === SESSIONS, `the record keeps the bench line for ${variant}: ${JSON.stringify(bench)}`);
    assert.ok(positive(bench.holdP50Ms) && positive(bench.hubPeakBytes) && Number.isSafeInteger(bench.leakedHandles) && bench.leakedHandles >= 0, `hold latency, memory and leaked handles are recorded for ${variant}: ${JSON.stringify(bench)}`);
  }
  if (record.decision === 'effect') {
    const { plain, effect } = budgets.bench;
    assert.ok(effect.holdP50Ms <= (1 + WITHIN) * plain.holdP50Ms, `Effect's hold latency is within 10% of plain's: ${effect.holdP50Ms} ms against ${plain.holdP50Ms} ms`);
    assert.ok(effect.hubPeakBytes <= (1 + WITHIN) * plain.hubPeakBytes, `Effect's memory is within 10% of plain's: ${effect.hubPeakBytes} B against ${plain.hubPeakBytes} B`);
  }
});

test(`${SCOPE} import("effect/Effect") is timed on Node 22, and the command that times it measures this Node`, { timeout: 120_000 }, () => {
  const record = results();
  const { startup } = record;
  const pinned = spikePin('effect');
  assert.ok(startup, 'the record has a startup section');
  assert.match(String(startup.node), /^v22\.\d+\.\d+$/, `the timing ran on Node 22: ${startup.node}`);
  assert.equal(startup.module, 'effect/Effect');
  assert.equal(startup.effect, pinned, 'the timing names the Effect version the spike pins');
  assert.ok(Number.isSafeInteger(startup.samples) && startup.samples >= 20, `20 or more fresh processes: ${startup.samples}`);
  assert.ok(positive(startup.p50Ms) && positive(startup.p95Ms) && startup.p95Ms >= startup.p50Ms, JSON.stringify(startup));

  const result = spike('startup.mjs', [], { timeout: 110_000 });
  assert.equal(result.status, 0, show(result));
  const line = result.objects.find((object) => object.module === 'effect/Effect');
  assert.ok(line, `startup.mjs prints its timing line\n${show(result)}`);
  assert.equal(line.node, process.version, 'it reports the Node it ran on');
  assert.equal(line.effect, pinned);
  assert.ok(line.samples >= 20 && positive(line.p50Ms) && line.p95Ms >= line.p50Ms, JSON.stringify(line));
});

test(`${SCOPE} the spike pins the issue's packages exactly`, () => {
  const manifest = json(`${SPIKE}/package.json`);
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const name of ['effect', '@effect/language-service']) assert.ok(exact(deps[name]), `${name} is pinned to an exact version: ${deps[name]}`);
  assert.match(deps.effect, /^4\./, 'the Effect build uses Effect 4');
  for (const [name, spec] of Object.entries(deps).filter(([name]) => EFFECT_PACKAGES.test(name))) assert.ok(exact(spec), `${name} is pinned to an exact version: ${spec}`);
});

test(`${SCOPE} the technical design records the decision and its numbers`, () => {
  const record = results();
  const design = readFileSync(join(root, 'docs/technical-design.md'), 'utf8');
  const decided = design.slice(design.indexOf('### Decided'));
  const row = decided.split('\n').find((line) => /^\|\s*Effect in the hub core\s*\|/.test(line));
  assert.ok(row, 'the Decided table keeps its "Effect in the hub core" row');
  assert.ok(!/unless a one-day spike shows/.test(row), `the row states the spike's outcome, not the pending rule: ${row}`);
  const decision = row.split('|')[2].trim();
  if (record.decision === 'plain') assert.match(decision, /^Plain TypeScript/, `the decision cell says plain TypeScript: ${decision}`);
  else {
    assert.match(decision, /Effect/, decision);
    assert.ok(decision.includes(spikePin('effect') ?? '\u0000'), `the decision cell names the pinned Effect version: ${decision}`);
  }
  const numbers = [...row.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)].map(([text]) => Number(text.replaceAll(',', '')));
  const near = (value) => numbers.some((number) => Math.abs(number - value) <= Math.max(0.05 * value, 0.5));
  const named = (label, value, ...scales) => assert.ok(scales.some((scale) => near(value / scale)), `the row gives ${label} (${value}): ${row}`);
  const { bench } = record.budgets;
  named('the import("effect/Effect") time in ms', record.startup.p50Ms, 1);
  for (const variant of VARIANTS) {
    named(`${variant}'s hold latency in ms`, bench[variant].holdP50Ms, 1);
    named(`${variant}'s hub memory in MB`, bench[variant].hubPeakBytes, 1e6, 2 ** 20);
  }
});

test(`${SCOPE} if Effect is chosen, it is pinned exactly and an import rule keeps it out of the CLI, the extension API, contracts and the SQLite store; if not, nothing outside the spike depends on it`, { timeout: 120_000 }, (t) => {
  const record = results();
  const declared = manifests().flatMap(({ path, manifest }) => effectDeps(manifest).map(([name, spec]) => ({ path, name, spec })));
  if (record.decision === 'plain') {
    assert.deepEqual(declared, [], 'plain TypeScript: no package outside the spike depends on Effect');
    return;
  }
  assert.ok(declared.some(({ name }) => name === 'effect'), `a package declares effect: ${JSON.stringify(declared)}`);
  const lock = json('package-lock.json');
  for (const { path, name, spec } of declared) {
    assert.ok(exact(spec), `${path} pins ${name} to an exact version: ${spec}`);
    assert.equal(lock.packages?.[`node_modules/${name}`]?.version, spec, `package-lock.json resolves ${name} to the pinned ${spec}`);
  }
  for (const { path, manifest } of manifests()) {
    const name = path.split('/')[1];
    if (['cli', 'extension-api', 'contracts', 'store'].includes(name)) assert.deepEqual(effectDeps(manifest), [], `${path} must not depend on Effect`);
  }

  const rule = 'scripts/import-rules.mjs';
  assert.ok(checks.some(({ commands }) => commands.some((command) => command.some((part) => String(part).endsWith(rule)))), `a preflight lane runs ${rule}`);
  const clean = spawnSync(process.execPath, [rule], { cwd: root, encoding: 'utf8' });
  assert.equal(clean.status, 0, `the repo keeps its own rule\n${show(clean)}`);

  const tree = scratch(t);
  const planted = {
    'packages/cli/src/planted.ts': "import { Effect } from 'effect';\nexport const a = Effect.void;\n",
    'packages/extension-api/src/planted.ts': 'export type { Effect } from "effect/Effect";\n',
    'packages/contracts/src/planted.ts': "export const schema = await import('effect/Schema');\n",
    'packages/store/src/planted.ts': "import '@effect/platform-node';\n",
    'packages/hub/src/core.ts': "import { Effect } from 'effect';\nexport const ok = Effect.void;\n",
  };
  for (const [path, source] of Object.entries(planted)) {
    mkdirSync(join(tree, path, '..'), { recursive: true });
    writeFileSync(join(tree, path), source);
  }
  cpSync(join(root, 'package.json'), join(tree, 'package.json'));
  const caught = spawnSync(process.execPath, [join(root, rule), tree], { cwd: root, encoding: 'utf8' });
  assert.notEqual(caught.status, 0, `the rule fails on Effect outside the hub core\n${show(caught)}`);
  const output = caught.stdout + caught.stderr;
  for (const path of Object.keys(planted).slice(0, 4)) assert.ok(output.includes(path), `the rule names ${path}\n${show(caught)}`);
  assert.ok(!output.includes('packages/hub/src/core.ts'), `the hub core may use Effect\n${show(caught)}`);
});
