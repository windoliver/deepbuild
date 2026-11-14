// A shard released before the exclusive block may be claimed by another run during that block.
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { alone, exclusive, listed, timed } from '../scripts/lanes.mjs';
import { commit, dump, git, run, sandbox, write } from './acceptance/1123/helpers.mjs';

test('affected never removes another run’s replacement shard lock during final cleanup', (t) => {
  const box = sandbox(t);
  const [a, b] = alone.filter(p => p.endsWith('/') && !listed(timed, `${p}probe.test.mjs`) && !listed(exclusive, `${p}probe.test.mjs`));
  const x = exclusive[0];
  const plain = "import test from 'node:test';import assert from 'node:assert/strict';test('runs',()=>assert.equal(1+1,2));\n";
  write(box.repo, `${a}probe.test.mjs`, plain);
  write(box.repo, `${b}probe.test.mjs`, plain);
  write(box.repo, `${x}probe.test.mjs`, `import test from 'node:test';import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';test('replacement owner',()=>{for(const k of [1,2]){const p=join(process.env.HOME,'deepbuild-shards',k+'.lock');mkdirSync(p);writeFileSync(join(p,'next-owner'),'another run');}});\n`);
  write(box.repo, 'Cargo.toml', '[workspace]\nmembers=["probe"]\nresolver="2"\n');
  write(box.repo, 'probe/Cargo.toml', '[package]\nname="probe"\nversion="0.0.0"\nedition="2021"\n');
  write(box.repo, 'probe/src/lib.rs', 'pub fn value()->u8{2}\n');
  write(box.repo, '.gitignore', 'node_modules\ntarget\n');
  git(box, 'init', '-q', '--template=', '-b', 'main');
  commit(box, 'fixture'); git(box, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const result = run(box, process.execPath, ['scripts/affected.mjs', `${a}probe.test.mjs`, `${b}probe.test.mjs`, `${x}probe.test.mjs`], box.repo, {DEEP_SHARDS:'2',DEEP_TEST_SHARD_FLOOR:'0'});
  assert.match(result.stdout, /SHARD [12] .*: made/, dump(result));
  const folder = join(box.env.HOME, 'deepbuild-shards');
  for (const k of [1,2]) assert.equal(existsSync(join(folder, `${k}.lock/next-owner`)), true, `released shard ${k} lock belongs to the next run and must survive final cleanup`);
});
