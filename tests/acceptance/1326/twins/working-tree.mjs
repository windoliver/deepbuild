// Deliberately red proof of AC2's named wrong reader. Run separately, never in the normal suite.
// Make a private copy of the base scripts; change only where readApprovals gets its signers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, LIST, TEST, world, repository, put, weaken, commit, guard, fails, namesKey } from '../fixtures.mjs';
import { hardware, approve } from '../authenticator.mjs';
test('#1326.be497e63 AC2 named wrong program: working-tree signer list accepts its own new key', (t) => {
  const copy = mkdtempSync(join(ROOT, 'tests/acceptance/1326/twins/.copy-'));
  t.after(() => rmSync(copy, { recursive: true, force: true }));
  cpSync(join(ROOT, 'scripts'), join(copy, 'scripts'), { recursive: true });
  symlinkSync(join(ROOT, 'node_modules'), join(copy, 'node_modules'));
  const file = join(copy, 'scripts/proof-change.mjs'), text = readFileSync(file, 'utf8');
  const old = "read(resolve(process.env.DEEP_APPROVERS || join(homedir(), '.deepbuild', 'approvers')), 'refs/tags/deep/approved/'";
  assert.equal(text.split(old).length, 2, 'BLOCKED: this base-pinned plant must be redrafted if its source changed');
  put(file, text.replace(old, "read(resolve(root, '.deepbuild', 'approvers'), 'refs/tags/deep/approved/'"));
  const w = world(t), listed = hardware('listed'), newcomer = hardware('newcomer');
  repository(w, listed.line); put(join(w.repo, LIST), listed.line + newcomer.line);
  weaken(w); commit(w);
  const script = join(copy, 'scripts/proof.mjs');
  // Without a tag even this wrong reader refuses the tagged edit; its later PASS is not a no-op.
  fails(guard(w, {}, script), 'working-tree reader control without signature', TEST);
  approve(w, newcomer, [LIST, TEST]);
  const r = guard(w, {}, script);
  t.diagnostic(`working-tree reader: exit ${r.status}\n${r.out}`);
  fails(r, 'working-tree list must not authorize its own added key', LIST);
  namesKey(r, newcomer, 'self-authorized added key');
});
