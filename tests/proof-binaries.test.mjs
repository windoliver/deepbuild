// Regression protection: a focused proof must not build a binary none of its selected consumers needs.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { cargoRepo, commit, consumer, dump, git, observations, run, sandbox, write } from './acceptance/1123/helpers.mjs';

for (const needsBinary of [false, true]) {
  test(`runLanes builds ${needsBinary ? 'only the binary selected consumers and helpers read' : 'no Rust for a JS-only consumer'}`, (t) => {
    const box = sandbox(t);
    cargoRepo(box);
    write(box.repo, 'Cargo.toml', '[workspace]\nmembers = ["crates/deep-hook", "crates/unrelated"]\nresolver = "2"\n');
    write(box.repo, 'crates/unrelated/Cargo.toml', '[package]\nname = "unrelated"\nversion = "0.0.0"\nedition = "2021"\n');
    write(box.repo, 'crates/unrelated/src/main.rs', 'fn main() { compile_error!("unselected binary must not build"); }\n');
    assert.equal(run(box, 'cargo', ['generate-lockfile', '--offline']).status, 0);
    const file = 'tests/selected.test.mjs';
    if (needsBinary) {
      write(box.repo, 'tests/helpers/consumer.mjs', consumer('node', 'selected binary'));
      write(box.repo, file, "import './helpers/consumer.mjs';\n");
    } else write(box.repo, file, "import test from 'node:test'; import assert from 'node:assert/strict'; test('js value', () => assert.equal(1 + 1, 2));\n");
    write(box.repo, 'driver.mjs', `import { runLanes } from './scripts/lanes.mjs'; process.exitCode = runLanes([{ name: 'selected', fix: 'none', commands: [[process.execPath, '--test', '${file}']] }]);\n`);
    commit(box, 'fixture');
    git(box, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    const result = run(box, process.execPath, ['driver.mjs']);
    assert.equal(result.status, 0, `unneeded Rust must not block a selected consumer\n${dump(result)}`);
    assert.match(result.stdout, /PASS selected/);
    if (needsBinary) {
      assert.equal(observations(box).length, 1);
      assert.equal(observations(box)[0].word, 'change-right');
    } else assert.equal(existsSync(join(box.repo, 'target/debug/deep-hook')), false, 'JS-only selection builds no binary');
  });
}
