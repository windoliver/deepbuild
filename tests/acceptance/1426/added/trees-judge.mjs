// #1426.ed3ed529's judges: `check` covers vendor/quickjs-jit-runtime, and with the Scope every tree under vendor/:
// unicode-17.0.0, which has no Cargo.toml, and a crate vendored later, as a wgpu patch would be. Each answers its
// failures, one line each; an empty list means the script met the criterion. No judge reaches the network.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanEnv, clip, linesOf, mark, passes, planted, plantTree, README, readTable, RELEASES, repoRoot, SCRIPT, SWITCH } from './common.mjs';

const QUICKJS = 'vendor/quickjs-jit-runtime';
const LINE_BREAK = 'vendor/unicode-17.0.0/LineBreakTest.txt';
const WGPU = 'vendor/wgpu-hal';
const WGPU_RELEASE = 'wgpu-hal-27.0.4';

const failsNaming = (run, path) => linesOf(run.output, 'FAIL').some((line) => line.includes(path));
const marked = (issue, tag) => [mark(issue, tag), `pub const PLANTED_${tag.toUpperCase()}: u8 = 1;`];

/** Each place under vendor/quickjs-jit-runtime a changed file with no row can sit. */
const QUICKJS_PLANTS = [
  ['a changed file of quickjs-jit-runtime', `${QUICKJS}/src/engine.rs`, (box, path) => box.insert(path, 5, marked(9003, 'engine'))],
  ['a changed nested file of quickjs-jit-runtime', `${QUICKJS}/src/runtime/osr.rs`, (box, path) => box.insert(path, 5, marked(9003, 'osr'))],
  ['a changed build.rs of quickjs-jit-runtime', `${QUICKJS}/build.rs`, (box, path) => box.insert(path, 5, marked(9003, 'build'))],
  ['a new file under quickjs-jit-runtime', `${QUICKJS}/src/planted_new.rs`, (box, path) => box.write(path, `${marked(9003, 'fresh').join('\n')}\n`)],
];

/** The criterion: a changed file under vendor/quickjs-jit-runtime with no row fails `check`, naming it; with a row, it passes. */
export function judgeQuickjs(script) {
  const failures = planted(script, () => null, (run) => (passes(run) ? [] : [`the plant as it stands fails check (exit ${run.status}): ${clip(run.output)}`]));
  if (failures.length) return failures;
  for (const [what, path, plant] of QUICKJS_PLANTS) {
    failures.push(...planted(script, (box) => plant(box, path), (run) => {
      if (run.status === 0) return [`${what} (${path}) with no row passes check`];
      return failsNaming(run, path) ? [] : [`${what} with no row fails check without a FAIL line naming ${path}: ${clip(run.output)}`];
    }));
  }
  // The control: the same change, listed in the switch's row, passes.
  const [, engine, plant] = QUICKJS_PLANTS[0];
  failures.push(...planted(script, (box) => {
    plant(box, engine);
    box.rows((rows) => { rows[2].files.push(engine); });
  }, (run) => (passes(run) ? [] : [`${engine}'s change, listed in the switch's row with its mark, fails check: ${clip(run.output)}`])));
  return failures;
}

/** A crate vendored after today, as #1552 or #475 would vendor a wgpu patch: the plant and its release. */
function plantWgpu(box) {
  const files = { 'Cargo.toml': '[package]\nname = "wgpu-hal"\nversion = "27.0.4"\nedition = "2021"\n', 'src/lib.rs': `${Array.from({ length: 20 }, (_, index) => `// upstream wgpu line ${index + 1}`).join('\n')}\n` };
  box.release(WGPU_RELEASE, files);
  for (const [path, content] of Object.entries(files)) box.write(`${WGPU}/${path}`, content);
}

/** Scope: every tree under vendor/, unicode-17.0.0 and a crate vendored later among them. */
export function judgeEveryTree(script) {
  const failures = [];
  const refused = (what, path, plant) => failures.push(...planted(script, plant, (run) => {
    if (run.status === 0) return [`${what} (${path}) with no row passes check`];
    return failsNaming(run, path) ? [] : [`${what} with no row fails check without a FAIL line naming ${path}: ${clip(run.output)}`];
  }));
  refused('a changed Unicode test file', LINE_BREAK, (box) => box.write(LINE_BREAK, `${box.read(LINE_BREAK)}× 0041 × 0042 ÷\t#  planted\n`));
  refused('a new file under unicode-17.0.0', 'vendor/unicode-17.0.0/PlantedTest.txt', (box) => box.write('vendor/unicode-17.0.0/PlantedTest.txt', '# planted\n'));
  failures.push(...planted(script, plantWgpu, (run) => (passes(run) ? [] : [`a newly vendored crate (${WGPU}) as its release has it fails check: ${clip(run.output)}`])));
  refused('a changed file of a newly vendored crate', `${WGPU}/src/lib.rs`, (box) => {
    plantWgpu(box);
    box.insert(`${WGPU}/src/lib.rs`, 5, marked(9004, 'wgpu'));
  });
  return failures;
}

/**
 * The lint lane: the lane named `lint` in `checks` of the table at `lanes` runs `check`, and through runLanes a
 * planted changed file under quickjs-jit-runtime with no row fails it, naming the file, while the plant passes.
 * `script` is the file the lane's `scripts/vendor-rebase.mjs` stands for.
 */
export async function judgeLane(lanes, { script = join(repoRoot, SCRIPT) } = {}) {
  const { checks } = await import(pathToFileURL(lanes).href);
  const lint = (checks ?? []).find((lane) => lane.name === 'lint');
  if (!lint) return [`${lanes} has no lint lane in checks`];
  const command = (lint.commands ?? []).find((argv) => argv.some((arg) => String(arg).endsWith(SCRIPT)));
  if (!command) return [`the lint lane doesn't run ${SCRIPT}`];
  if (command.at(-1) !== 'check') return [`the lint lane runs ${command.slice(1).join(' ')}, not ${SCRIPT} check`];
  if (lint.paths && !lint.paths.some((path) => `${QUICKJS}/src/engine.rs`.startsWith(path.replace(/\*\*$/, '')))) return [`the lint lane's paths skip a change to ${QUICKJS}: ${JSON.stringify(lint.paths)}`];
  if (!existsSync(script)) return [`no script at ${script}`];
  const absolute = command.map((arg) => (String(arg).endsWith(SCRIPT) ? script : arg));
  const lane = (box) => {
    const code = `const { runLanes } = await import(${JSON.stringify(pathToFileURL(join(repoRoot, 'scripts/lanes.mjs')).href)});
      process.exitCode = runLanes([JSON.parse(process.env.DA1426_LANE)], { cwd: ${JSON.stringify(box.root)} });`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: box.root, encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024,
      env: cleanEnv({ HOME: box.dir, [RELEASES]: box.releases, DA1426_LANE: JSON.stringify({ name: 'lint', commands: [absolute], fix: 'Give it a row.' }) }),
    });
    return { status: run.status, output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
  };
  const failures = [];
  const scene = (plant, judge) => {
    const box = plantTree();
    try {
      plant(box);
      failures.push(...judge(lane(box)));
    } finally {
      box.remove();
    }
  };
  scene(() => null, (run) => (run.status === 0 ? [] : [`the lint lane fails the plant as it stands (exit ${run.status}): ${clip(run.output)}`]));
  const [, engine, plant] = QUICKJS_PLANTS[0];
  scene((box) => plant(box, engine), (run) => (run.status !== 0 && linesOf(run.output, 'FAIL').some((line) => line.startsWith('FAIL lint:')) && failsNaming(run, engine)
    ? [] : [`the lint lane with ${engine} changed and no row doesn't fail as 'FAIL lint: ...' with a line naming the file (exit ${run.status}): ${clip(run.output)}`]));
  return failures;
}

/** The real tree's table has a row for the change the base marks in quickjs-jit-runtime's src/lib.rs. */
export function judgeRealQuickjs(root = repoRoot) {
  const path = join(root, README);
  const table = existsSync(path) ? readTable(readFileSync(path, 'utf8')) : null;
  if (!table) return [`${README} has no table under ## Carried patches`];
  return table.rows.some((row) => row.files.includes(SWITCH)) ? [] : [`no row of the table lists ${SWITCH}, whose "DeepBuild patch" the base carries`];
}
