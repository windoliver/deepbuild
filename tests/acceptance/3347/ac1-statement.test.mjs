// #3347 AC1: `node scripts/repo-rules.mjs` passes a hands@1 fixture that states `drawn` with its script, and one that
// states `agreed` with an agreement that matches its hash and is signed by a key on `.deepbuild/approvers` at the merge
// base. A clip with no statement, an agreement that is missing or differs from its hash, and one signed by a key that
// isn't on the list each fail. Every plant runs beside a drawn and an agreed fixture that must pass in the same run, so a
// check that fails everything fails here, and so does one that passes everything (README: Criteria and tests).
import assert from 'node:assert/strict';
import test from 'node:test';
import { APPROVERS, FOLDER, agreed, agreement, assertFails, assertPasses, clip, commit, consent, drawn, failing, git, json, maintainer, put, rules, scratch, show, signer, skipped, statementOf, stranger } from './helpers.mjs';

const WAVE = `${FOLDER}/wave.mov`, FIST = `${FOLDER}/fist.mov`;
/** The drawn and the agreed fixture that must pass beside every plant. */
const good = (key) => ({ ...drawn(WAVE), ...agreed(FIST, { key }) });
function assertGood(result) {
  assertPasses(result, WAVE, 'drawn', 'a drawn fixture with its script');
  assertPasses(result, FIST, 'agreed', 'an agreed fixture whose agreement matches its hash and is signed by a listed key');
}

test('#3347.fc5ea222 AC1: a fixture that states drawn with its script passes, and so does one that states agreed with an agreement that matches its hash and is signed by a key on the list at the merge base', (t) => {
  const first = maintainer('ecdsa'), second = signer('second@example.invalid', 'ed25519');
  const PINCH = `${FOLDER}/pinch.mov`;
  const result = rules(scratch(t, first.line + second.line, { ...good(first), ...agreed(PINCH, { key: second }) }));
  assertGood(result);
  assertPasses(result, PINCH, 'agreed', 'signed by the other listed key, of the other security-key type');
});

test('#3347.fc5ea222 AC1: a planted clip with no statement fails, naming the clip', (t) => {
  const key = maintainer(), BARE = `${FOLDER}/bare.mov`;
  const cwd = scratch(t, key.line, { ...good(key), [BARE]: clip('bare') });
  const result = rules(cwd);
  assertFails(result, BARE, 'a clip with no statement beside it');
  assertGood(result);

  // Its statement beside it is what the check missed.
  commit(cwd, drawn(BARE, { bytes: clip('bare') }));
  assertPasses(rules(cwd), BARE, 'drawn', 'the same clip once its statement and script are beside it');
});

test('#3347.fc5ea222 AC1: a planted agreed statement whose agreement is missing, or differs from its hash, fails, naming the file', (t) => {
  const key = maintainer(), GONE = `${FOLDER}/gone.mov`, OTHER = `${FOLDER}/other.mov`;
  const text = agreement(clip(OTHER));
  const result = rules(scratch(t, key.line, {
    ...good(key),
    ...agreed(GONE, { key, kept: false }),
    ...agreed(OTHER, { key, text, hash: `${'0'.repeat(63)}1` }), // the agreement as signed; only the statement's hash is another file's
  }));
  assertFails(result, GONE, 'its agreement is missing', { file: consent(GONE) });
  assertFails(result, OTHER, "its agreement differs from the hash the statement gives", { file: consent(OTHER) });
  assertGood(result);
});

test('#3347.fc5ea222 AC1: an agreement signed by a key that is not on the list fails, naming the key; so does one with no signature, and one edited after it was signed', (t) => {
  const key = maintainer(), outsider = stranger();
  const THEIRS = `${FOLDER}/theirs.mov`, UNSIGNED = `${FOLDER}/unsigned.mov`, EDITED = `${FOLDER}/edited.mov`;
  const before = agreement(clip(EDITED), { use: 'one look by the maintainer' });
  const result = rules(scratch(t, key.line, {
    ...good(key),
    ...agreed(THEIRS, { key: outsider }),
    ...agreed(UNSIGNED, { key: null }),
    ...agreed(EDITED, { key, signed: before }), // the statement's hash is the edited file's, so only the signature tells
  }));
  assertFails(result, THEIRS, "its agreement is signed by a key that isn't on the list", { key: outsider });
  assertFails(result, UNSIGNED, 'its agreement has no signature');
  assertFails(result, EDITED, 'its agreement was edited after it was signed');
  assertGood(result);
});

test('#3347.fc5ea222 AC1: the list is the one at the merge base: a key the working tree adds, or the change itself commits, signs nothing, and one they drop still signs', (t) => {
  const key = maintainer(), outsider = stranger('ed25519');
  const THEIRS = `${FOLDER}/theirs.mov`;
  const cwd = scratch(t, key.line, { ...good(key), ...agreed(THEIRS, { key: outsider }) });
  const held = (what) => {
    const result = rules(cwd);
    assertFails(result, THEIRS, what, { key: outsider });
    assertGood(result);
  };
  put(cwd, APPROVERS, key.line + outsider.line);
  held('the working tree adds the key that signed to the list, which the merge base does not hold');
  commit(cwd);
  held('the change itself commits the key that signed to the list');
  commit(cwd, { [APPROVERS]: outsider.line });
  held("the change's list holds only the key that signed, and the merge base's only the maintainer's");

  // With no merge base there is no list to read, whatever HEAD and the working tree hold, so nothing says the
  // maintainer's key is on it.
  commit(cwd, { [APPROVERS]: key.line });
  git(cwd, 'update-ref', '-d', 'refs/remotes/origin/main');
  const result = rules(cwd);
  assert.ok(skipped(result, [{ path: FIST, statement: 'agreed' }]).length, `a PASS line lists ${FIST} as agreed with no merge base to read ${APPROVERS} at\n${show(result)}`);
  assert.ok([...failing(result, FIST), ...result.lines.filter((line) => /^(?:FAIL|INVALID|BLOCKED) /.test(line) && line.includes(APPROVERS))].length, `no line in a failing state names ${FIST} or ${APPROVERS} with no merge base to read the list at\n${show(result)}`);
});

test('#3347.fc5ea222 AC1: a listed key signs only as the edit guard counts it, by a touch: an agreement signed with a security key and no touch, and one signed with a key in a plain file, each fail', (t) => {
  const key = maintainer(), untouched = signer('untouched@example.invalid', 'ecdsa', { touch: false }), file = signer('file@example.invalid', 'plain');
  const NO_TOUCH = `${FOLDER}/no-touch.mov`, PLAIN = `${FOLDER}/plain-key.mov`;
  const result = rules(scratch(t, key.line + untouched.line + file.line, { ...good(key), ...agreed(NO_TOUCH, { key: untouched }), ...agreed(PLAIN, { key: file }) }));
  assertFails(result, NO_TOUCH, 'its agreement is signed by a listed security key with no touch, which an agent can make');
  assertFails(result, PLAIN, 'its agreement is signed by a listed key in a plain file, which an agent can use');
  assertGood(result);
});

test('#3347.fc5ea222 AC1: a statement that says neither or both, or leaves out what drawn or agreed must carry, is no statement: each planted clip fails, named', (t) => {
  const key = maintainer();
  const at = (name) => `${FOLDER}/${name}.mov`;
  const bare = (name, statement) => ({ [at(name)]: clip(at(name)), [statementOf(at(name))]: typeof statement === 'string' ? statement : json(statement) });
  const stated = JSON.parse(agreed(at('both'), { key })[statementOf(at('both'))]);
  const without = (name, field) => {
    const files = agreed(at(name), { key });
    return { ...files, [statementOf(at(name))]: json({ ...JSON.parse(files[statementOf(at(name))]), [field]: undefined }) };
  };
  const cases = {
    neither: ['its statement is neither drawn nor agreed', drawn(at('neither'), { statement: { statement: 'recorded' } })],
    empty: ['its statement is an empty object', bare('empty', {})],
    unread: ["its statement isn't JSON", bare('unread', 'drawn\n')],
    both: ['its statement says both', { ...agreed(at('both'), { key }), ...drawn(at('both'), { statement: { ...stated, statement: ['drawn', 'agreed'] } }) }],
    'no-script': ['it states drawn and names no script', bare('no-script', { statement: 'drawn' })],
    'lost-script': ["it states drawn and the script it names isn't there", bare('lost-script', { statement: 'drawn', script: 'never-written.mjs' })],
    'no-agreement': ['it states agreed and names no agreement', bare('no-agreement', { statement: 'agreed', who: stated.who, use: stated.use })],
    'no-who': ["it states agreed and doesn't say who was recorded", without('no-who', 'who')],
    'no-use': ["it states agreed and doesn't say what use they agreed to", without('no-use', 'use')],
  };
  const result = rules(scratch(t, key.line, Object.assign({}, good(key), ...Object.values(cases).map(([, files]) => files))));
  for (const [name, [why]] of Object.entries(cases)) assertFails(result, at(name), why);
  assertGood(result);
});
