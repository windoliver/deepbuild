import assert from 'node:assert/strict';
import test from 'node:test';
import { cargoRepo, commit, consumer, dump, git, observations, run, sandbox, write } from './acceptance/1123/helpers.mjs';

test('a lane respects a root-relative explicit Node test path', (t) => {
  const box = sandbox(t);
  cargoRepo(box);
  write(box.repo, 'consumer.test.mjs', consumer('node', 'root consumer'));
  write(box.repo, 'driver.mjs', "import {runLanes} from './scripts/lanes.mjs'; process.exitCode=runLanes([{name:'root',commands:[[process.execPath,'--test','./consumer.test.mjs']],fix:'none'}]);");
  commit(box, 'fixture'); git(box, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const result = run(box, process.execPath, ['driver.mjs']);
  assert.equal(result.status, 0, dump(result));
  assert.equal(observations(box)[0]?.word, 'change-right');
});
