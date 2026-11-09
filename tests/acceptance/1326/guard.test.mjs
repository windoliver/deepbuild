import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { world, repository, clone, weaken, commit, git, guard, put, passes, fails, namesKey, LIST, TEST } from './fixtures.mjs';
import { hardware, plain, approve } from './authenticator.mjs';

function seen(t, label, r) { t.diagnostic(`${label}: exit ${r.status}\n${r.out}`); return r; }

test('#1326.f66fc8bc AC1 two checkouts ignore contradictory home lists and name the unapproved test', (t) => {
  const w = world(t), listed = hardware('listed'), session = hardware('session');
  repository(w, listed.line); weaken(w); commit(w); approve(w, session, [TEST]);
  const a = clone(w, 'checkout-a', session.line), b = clone(w, 'checkout-b', listed.line);
  const ra = seen(t, 'home trusts session', guard(a)), rb = seen(t, 'home trusts listed person', guard(b));
  fails(ra, 'home list must not approve a test edit', TEST);
  fails(rb, 'unlisted signer in either checkout', TEST);
  assert.deepEqual([ra.status, ra.stdout.match(/^(?:PASS|FAIL) guard:/gm)], [rb.status, rb.stdout.match(/^(?:PASS|FAIL) guard:/gm)], 'same verdict on the same commit');
});

test('#1326.f66fc8bc AC1 either listed person really approves, independent of home, and history is not re-judged', (t) => {
  const w = world(t), first = hardware('person-one'), second = hardware('person-two', 'ecdsa');
  repository(w, first.line + second.line); weaken(w); commit(w);
  // Run both hardware wire types and history before asserting: a red base must not hide later probes.
  const observations = [];
  for (const key of [first, second]) {
    const ref = approve(w, key, [TEST]);
    const a = clone(w, `approved-${key.name}-a`, ''), b = clone(w, `approved-${key.name}-b`, hardware('unrelated').line);
    observations.push(seen(t, `${key.type} empty home`, guard(a)), seen(t, `${key.type} unrelated home`, guard(b)));
    git(w, 'tag', '-d', ref);
  }
  // Once on main, an obsolete/untrusted approval tag is history, not a reason to fail a new change.
  approve(w, hardware('historical-outsider'), [TEST]);
  git(w, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  put(join(w.repo, 'note.txt'), 'Unprotected work.\n'); commit(w);
  passes(seen(t, 'historical tag', guard(w)), 'tags on default-branch commits are not re-judged');
  for (const r of observations) passes(r, 'either listed person approves regardless of home or author', TEST);
});

test('#1326.be497e63 AC2 unsigned and self-signed key additions fail naming the added key', (t) => {
  const w = world(t), listed = hardware('listed'), newcomer = hardware('newcomer');
  repository(w, listed.line);
  put(join(w.repo, LIST), listed.line + newcomer.line); commit(w);
  const unsigned = seen(t, 'unsigned key addition', guard(w));
  // Include a tagged edit in the self-signed proposal, so accepting it really exercises verification.
  weaken(w); git(w, 'add', TEST); git(w, 'commit', '-q', '--amend', '--no-edit');
  approve(w, newcomer, [LIST, TEST]);
  put(join(w.home, LIST), newcomer.line);
  const selfSigned = seen(t, 'new key approves itself and a tagged edit', guard(w));
  for (const [label, r] of [['unsigned', unsigned], ['self-signed', selfSigned]]) {
    fails(r, label, LIST); namesKey(r, newcomer, label);
  }
});

test('#1326.be497e63 AC2 an uncommitted signer list cannot authorize a committed test edit', (t) => {
  const w = world(t), listed = hardware('listed'), newcomer = hardware('dirty-tree-key');
  repository(w, listed.line); weaken(w); commit(w); approve(w, newcomer, [TEST]);
  put(join(w.repo, LIST), listed.line + newcomer.line);
  put(join(w.home, LIST), newcomer.line);
  const r = seen(t, 'dirty working-tree list', guard(w));
  fails(r, 'read the merge base, not disk', TEST, LIST); namesKey(r, newcomer, 'dirty list addition');
});

test('#1326.be497e63 AC2 a listed presence key can approve a list addition', (t) => {
  const w = world(t), listed = hardware('listed'), newcomer = hardware('newcomer', 'ecdsa');
  repository(w, listed.line);
  put(join(w.repo, LIST), listed.line + newcomer.line); commit(w); approve(w, listed, [LIST]);
  // Include a subsequent test edit approved by the old key: the base must still read the repo list.
  weaken(w); commit(w); approve(w, listed, [TEST], { name: 'test-edit' });
  passes(seen(t, 'existing signer approves both proposals', guard(w)), 'a valid list change is possible', LIST, TEST);
});

test('#1326.fdbc77ab AC3 plain ed25519, ecdsa and rsa keys are refused on the list, naming each key', (t) => {
  const observations = [];
  for (const type of ['ed25519', 'ecdsa', 'rsa']) {
    const w = world(t), key = plain(w, `file-${type}`, type);
    repository(w, key.line);
    // No test edit can supply an unrelated failure: admission itself must be refused.
    put(join(w.repo, 'note.txt'), 'ordinary edit\n'); commit(w);
    observations.push([key, seen(t, `plain ${type} on merge-base list`, guard(w))]);
  }
  for (const [key, r] of observations) {
    fails(r, `${key.type} signs without presence`, LIST); namesKey(r, key, 'inadmissible key');
  }
});

test('#1326.fdbc77ab AC3 a listed person cannot admit a newly added plain-file key by approval', (t) => {
  const w = world(t), listed = hardware('listed'), key = plain(w, 'new-file-key', 'ed25519');
  repository(w, listed.line); put(join(w.repo, LIST), listed.line + key.line); commit(w);
  approve(w, listed, [LIST]);
  const r = seen(t, 'plain key added by an otherwise valid approval', guard(w));
  fails(r, 'approval cannot admit a presence-free key', LIST); namesKey(r, key, 'new inadmissible key');
});

test('#1326.fdbc77ab AC3 security-key signatures without user presence cannot approve, naming the signer', (t) => {
  const observations = [];
  for (const type of ['ed25519', 'ecdsa']) {
    const w = world(t), key = hardware(`no-presence-${type}`, type);
    repository(w, key.line); weaken(w); commit(w);
    approve(w, key, [TEST], { presence: false });
    put(join(w.home, LIST), key.line);
    observations.push([key, seen(t, `${key.type} without presence`, guard(w))]);
  }
  for (const [key, r] of observations) {
    fails(r, 'an SK key type alone does not prove presence on this signature', TEST);
    namesKey(r, key, 'signature lacking presence');
  }
});

test('#1326.ec731667 AC4 DEEP_APPROVERS holding a session key cannot approve a tagged-test edit', (t) => {
  const w = world(t), listed = hardware('listed'), session = hardware('session-owned');
  repository(w, listed.line); weaken(w); commit(w); approve(w, session, [TEST]);
  const override = join(w.dir, 'session-approvers'); put(override, session.line);
  fails(seen(t, 'DEEP_APPROVERS session list', guard(w, { DEEP_APPROVERS: override })), 'environment list must not grant authority', TEST);
});
