// #3347 AC2, what needs no detector: the clip #1186's test camera plays states `drawn` or `agreed`. Drawn, its script
// run again, in a tree that doesn't hold the clip, makes the clip's own hash. Agreed, its agreement names the maintainer,
// the use and the clip's hash. The detector's half is ac2-reading.test.mjs's.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import test from 'node:test';
import { FOLDER, USE, WHO, agreed, agreement, assertFails, assertPasses, clip, clipOf1186, draws, drawn, madeAgain, maintainer, plant, root, rules, scratch, sha256, temporary } from './helpers.mjs';

test("#3347.e7d2e863 AC2: the clip #1186's test camera plays states drawn or agreed", () => {
  const { path, stated } = clipOf1186();
  assert.ok(['drawn', 'agreed'].includes(stated.statement), `${path} states ${JSON.stringify(stated.statement)}, neither drawn nor agreed`);
});

/** What an agreement's text doesn't name of the maintainer, the use and the clip's hash. */
const unnamed = (text, { who, use }, bytes) => [['the maintainer', who], ['the use', use], ["the clip's hash", sha256(bytes)]]
  .filter(([, value]) => typeof value !== 'string' || !value.trim() || !text.replace(/\s+/g, ' ').includes(value.trim().replace(/\s+/g, ' '))).map(([what]) => what);

test("#3347.e7d2e863 AC2: drawn, the script of #1186's clip run again without the clip makes the clip's own hash; agreed, its agreement names the maintainer, the use and the clip's hash", (t) => {
  // The judges first, on a planted tree, so a script that copies the clip or makes another is told from one that draws it.
  const base = temporary(t), WAVE = `${FOLDER}/wave.mov`, bytes = clip('wave');
  plant(base, { ...drawn(WAVE, { bytes }), [`${FOLDER}/other.mjs`]: draws(clip('another')), [`${FOLDER}/copies.mjs`]: "#!/usr/bin/env node\nimport { copyFileSync } from 'node:fs';\ncopyFileSync(new URL('./wave.mov', import.meta.url), process.argv[2]);\n" });
  assert.equal(madeAgain(t, base, WAVE, 'draw-wave.mjs'), sha256(bytes), 'the script that draws the planted clip makes its hash');
  assert.notEqual(madeAgain(t, base, WAVE, 'other.mjs'), sha256(bytes), 'a script that draws another clip makes another hash');
  assert.throws(() => madeAgain(t, base, WAVE, 'copies.mjs'), /copies\.mjs.*exits/, 'a script that copies the clip makes nothing without it');
  assert.deepEqual(unnamed(agreement(bytes), { who: WHO, use: USE }, bytes), [], 'the planted agreement names all three');
  assert.deepEqual(unnamed(agreement(bytes, { who: 'someone', use: 'anything', hash: sha256('another') }), { who: WHO, use: USE }, bytes), ['the maintainer', 'the use', "the clip's hash"], 'an agreement to something else names none');

  const { path, stated } = clipOf1186();
  const own = readFileSync(join(root, path)), dir = posix.dirname(path);
  if (stated.statement === 'drawn') {
    assert.equal(typeof stated.script, 'string', `the statement of ${path} names no script`);
    assert.equal(madeAgain(t, root, path, stated.script), sha256(own), `${stated.script} run again doesn't make the hash of ${path}`);
  } else {
    assert.equal(stated.statement, 'agreed', `${path} states ${JSON.stringify(stated.statement)}, neither drawn nor agreed`);
    const file = posix.join(dir, String(stated.agreement?.file));
    assert.ok(existsSync(join(root, file)), `${path} states agreed and its agreement ${file} isn't there`);
    assert.deepEqual(unnamed(readFileSync(join(root, file), 'utf8'), stated, own), [], `the agreement ${file} doesn't name these of ${path}`);
  }
});

test("#3347.e7d2e863 AC2: an agreement names the clip it was made for: a planted agreed clip whose agreement, signed and matching its hash, names another recording's hash fails", (t) => {
  const key = maintainer(), SWAPPED = `${FOLDER}/swapped.mov`, FIST = `${FOLDER}/fist.mov`;
  const result = rules(scratch(t, key.line, {
    ...agreed(FIST, { key }),
    ...agreed(SWAPPED, { key, bytes: clip('someone else'), text: agreement(clip('the maintainer')) }),
  }));
  assertFails(result, SWAPPED, "its agreement names another recording's hash, so nobody agreed to this one");
  assertPasses(result, FIST, 'agreed', 'an agreed fixture whose agreement names it');
});
