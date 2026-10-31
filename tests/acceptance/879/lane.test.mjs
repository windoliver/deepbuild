// #879 acceptance, AC2 through the lint lane itself: `scripts/lanes.mjs`'s lint lane, run by
// `runLanes` in a scratch repository, fails naming the card check and the package.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { checks } from '../../../scripts/lanes.mjs';
import { CRATE, lanesUrl, repo, show } from '../246/helpers.mjs';
import { card, names, npmPackage } from './helpers.mjs';

// The lint lane up to and including its repo-rules command (README: "Readings", 8). The lane's
// summary comes from its first failing command, so the commands after it can't change it; they
// are left out because clippy's build in a scratch folder can wait minutes on a shared machine.
function lintThroughRules(cwd) {
  const code = `
    import { checks, runLanes } from ${JSON.stringify(lanesUrl)};
    const lint = checks.find(({ name }) => name === 'lint');
    const at = lint.commands.findIndex((command) => command.at(-1) === 'scripts/repo-rules.mjs');
    process.exitCode = runLanes([{ ...lint, commands: lint.commands.slice(0, at + 1) }], { cwd: process.cwd() });
  `;
  const env = { ...process.env };
  delete env.CARGO_TARGET_DIR;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd, env, encoding: 'utf8', timeout: 120_000 });
  return { ...result, out: result.stdout + result.stderr };
}

test('AC2: a planted package without a card makes the lint lane FAIL, its summary naming the card check and the package', (t) => {
  const lint = checks.find(({ name }) => name === 'lint');
  assert.ok(lint?.commands.some((command) => command.at(-1) === 'scripts/repo-rules.mjs'), 'the lint lane no longer runs scripts/repo-rules.mjs');
  // A root crate so cargo fmt, the lane's first command, passes and the rules decide the summary;
  // a carded package beside the planted one.
  const cwd = repo(t, { tracked: { ...CRATE, ...npmPackage('packages/tally'), ...npmPackage('packages/count'), 'packages/count/README.md': card('count') } });
  const result = lintThroughRules(cwd);
  assert.equal(result.status, 1, show(result));
  const summary = result.stdout.split('\n').find((line) => /^(?:FAIL|INVALID|BLOCKED) lint: /.test(line));
  assert.ok(summary, `no failing lint summary\n${show(result)}`);
  assert.ok(summary.startsWith('FAIL lint: cards: ') && names(summary, 'packages/tally'), `the lint summary is ${JSON.stringify(summary)}, not a cards line naming packages/tally\n${show(result)}`);
});
