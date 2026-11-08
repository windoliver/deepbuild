// #1121 AC4: a symlinked spool path is refused by deep-hook on aarch64. The real deep-hook, built from this checkout,
// spools a hook with no hub there: first into a plain spool (so the hook spools at all), then with spool.jsonl a link
// to a file elsewhere, which must stay as it was. The check runs on any machine; only the Spark proves the criterion,
// so elsewhere the test then skips with a platform note (never PASS).
import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { cargoBuild, dump, LONG, NOT_SPARK, run, sandbox, SPARK } from './helpers.mjs';

const START = '{"session_id":"s1121","hook_event_name":"SessionStart","source":"startup"}';
const BEFORE = 'a file the spool link points at; deep-hook must not append to it\n';
const TRIES = 40;

test('#1121.23cb368c deep-hook refuses a spool.jsonl that is a symlink: nothing is written through it, and it says so', LONG, async (t) => {
  const box = sandbox(t);
  const built = await cargoBuild(box, ['-p', 'deep-hook', '--bin', 'deep-hook']);
  const hook = built.artifacts.find(({ target, executable }) => target?.name === 'deep-hook' && executable)?.executable;
  assert.ok(built.status === 0 && hook, `deep-hook didn't build\n${dump(built)}`);
  const spool = join(box.home, '.deepbuild', 'spool');
  mkdirSync(spool, { recursive: true });
  chmodSync(join(box.home, '.deepbuild'), 0o700);
  chmodSync(spool, 0o700);
  const live = join(spool, 'spool.jsonl');
  const call = () => run(box, [hook, 'claude-code', 'SessionStart'], { input: START, env: { HOME: box.home } });

  // deep-hook gives its spool write 45 ms from its start; on a loaded machine a call can run out of that before it
  // opens the spool, which decides nothing. So each step tries up to TRIES calls, until one decides.
  const timedOut = (r) => /50 ms/.test(r.stderr);
  // The control: with a plain spool, the hook's line lands in spool.jsonl.
  let spooled = '', plain;
  for (let i = 0; i < TRIES && !spooled.includes('s1121'); i++) {
    plain = await call();
    try { spooled = readFileSync(live, 'utf8'); } catch {}
  }
  assert.ok(spooled.includes('s1121'), `INCONCLUSIVE: with no link, deep-hook spooled nothing to ${live} in ${TRIES} calls, so this machine can't show a refusal\n${dump(plain)}`);

  // spool.jsonl is now a link to a file elsewhere: every call must leave that file as it was, and one must say so.
  rmSync(live);
  const elsewhere = join(box.home, 'elsewhere.jsonl');
  writeFileSync(elsewhere, BEFORE);
  symlinkSync(elsewhere, live);
  let linked, refused = null;
  for (let i = 0; i < TRIES && !refused; i++) {
    linked = await call();
    const after = readFileSync(elsewhere, 'utf8');
    assert.equal(after, BEFORE, `deep-hook on ${process.platform}-${process.arch} followed the symlinked spool path ${live} -> ${elsewhere} and appended to it: ${JSON.stringify(after.slice(BEFORE.length))}\n${dump(linked)}`);
    assert.ok(lstatSync(live).isSymbolicLink(), `the symlinked spool path ${live} was replaced, not refused\n${dump(linked)}`);
    if (/spool/i.test(linked.stderr) && !timedOut(linked)) refused = linked;
  }
  assert.ok(refused, `INCONCLUSIVE: deep-hook neither wrote through nor refused the symlinked spool path ${live} in ${TRIES} calls: each ran out of its 50 ms or said nothing\n${dump(linked)}`);
  if (!SPARK) t.skip(NOT_SPARK);
});
