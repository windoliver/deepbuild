// AC2: a planted pack folder named after a listed word fails the lane, naming the folder. The word is invented and
// listed only in the copy, by its salted hash, so the test holds whichever words the checkout's list keeps; the folder
// and the hash are planted in the copy's main, so no line of the change can name the folder, only the pack check.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHECKOUT, INVENTED, baseList, cleanChange, commit, laneEnv, makeCopy, namesFolder, plantFile, plantHash, readList, readsAsListed, runLane, withhold } from './helpers.mjs';

const ID = '#3533.d97bed63';
const LISTS = [baseList(), readList(CHECKOUT)];
const show = (text) => withhold(text, LISTS);

test(`${ID} AC2: a pack folder planted in main, named after a word the list holds, fails the lane, naming the folder`, (t) => {
  const { sandbox, repo } = makeCopy(t);
  assert.ok(!readsAsListed(readList(repo), INVENTED), `the invented word ${INVENTED} is already listed, so it can't stand for a planted one`);
  plantHash(repo, INVENTED);
  assert.ok(readsAsListed(readList(repo), INVENTED), 'the planted hash does not list the invented word');
  // The plant is a pack like the smallest one the checkout ships, renamed after the word.
  const manifests = readdirSync(join(repo, 'packs'))
    .map((folder) => join(repo, 'packs', folder, 'pack.json'))
    .filter((file) => { try { return statSync(file).isFile(); } catch { return false; } })
    .sort((a, b) => statSync(a).size - statSync(b).size);
  assert.ok(manifests.length, 'the checkout ships no packs/*/pack.json to model the plant on');
  const pack = JSON.parse(readFileSync(manifests[0], 'utf8'));
  pack.name = INVENTED;
  const folder = `${INVENTED}-${pack.version ?? '1.0.0'}`;
  plantFile(repo, `packs/${folder}/pack.json`, `${JSON.stringify(pack, null, 2)}\n`);
  commit(repo, 'Main with one more pack', { base: true });
  cleanChange(repo);

  const run = runLane(repo, laneEnv(sandbox));
  // A lane that reads no pack folder, or only the ones it was fixed for, passes here.
  assert.ok(run.status !== 0 && run.states.includes('FAIL'), `the lane doesn't fail on the planted pack folder packs/${folder} (exit ${run.status}, ${run.states.join(' ') || 'no verdict'}):\n${show(run.output)}`);
  assert.ok(run.lines.some((line) => namesFolder(line, folder)), `no line of the lane's output names the planted folder ${folder}:\n${show(run.output)}`);
});
