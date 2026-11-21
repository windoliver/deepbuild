// #2973 AC5: with an unreadable or unparseable budget file, hub.restart is refused, the refusal names the file, and the
// hub stays up (README: The scenes; the budget file is read as README's Readings say: the files under the root the
// base doesn't keep that the first restart wrote).
import { test } from 'node:test';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { LONG, STAYS_MS, assert, addedFiles, crash, refusedReply, restart, restarted, sandbox, startInstalled, staysUp, text } from './helpers.mjs';

/** A restart with the budget file made bad: the hub crashed and back (so a hub that reads it at start reads it), then hub.restart. */
async function refusedWithBad(box, files, how) {
  await crash(box);
  const r = await restart(box);
  const names = files.map((f) => basename(f.rel));
  assert.ok(refusedReply(r.reply), `with ${how} budget file (${names.join(', ')}), hub.restart must be refused: such a file reads as spent and never grants a restart. It got ${text(r.reply, box)}${r.back ? ', and the hub restarted' : ''}`);
  const words = text(r.reply.error, box);
  assert.ok(names.some((name) => words.includes(name)), `the refusal must name the ${how} budget file (${names.join(', ')}); it reads ${words}`);
  const down = await staysUp(box, r.before, r.pid);
  assert.ok(!down, `the hub that refused the restart for ${how} budget file must stay up ${STAYS_MS / 1000} s with the same start ID: ${down}`);
}

test('#2973.47e2f0df with an unreadable or unparseable budget file, hub.restart is refused, the refusal names the file, and the hub stays up', LONG, async (t) => {
  const box = await sandbox((cleanup) => t.after(cleanup));
  await startInstalled(box);
  const r = await restart(box);
  assert.ok(restarted(r), `BLOCKED: a first restart, within the budget, didn't go through: ${text(r.reply, box)}`);
  // The budget file: what the base doesn't keep under the root and the restart wrote, from its request on.
  const files = addedFiles(box).filter((f) => f.mtime >= r.asked - 1000);
  assert.ok(files.length, `the installed hub must keep its restart budget in a file under its root, written before it exits for a restart: no file under ~/.deepbuild other than the base's own was written by the restart (files the base doesn't keep: ${JSON.stringify(addedFiles(box).map((f) => f.rel))})`);
  const kept = files.map((f) => ({ ...f, bytes: readFileSync(f.path) }));
  box.restored.push(() => { for (const f of kept) { chmodSync(f.path, 0o600); writeFileSync(f.path, f.bytes); } });

  // Unparseable: the file's bytes replaced with ones no reader parses.
  for (const f of kept) writeFileSync(f.path, '{"restarts": [ this is not a budget\n');
  await refusedWithBad(box, files, 'an unparseable');

  // Unreadable: its own bytes back, which grant a restart (one spent), but no one may read it.
  for (const f of kept) { writeFileSync(f.path, f.bytes); chmodSync(f.path, 0o000); }
  await refusedWithBad(box, files, 'an unreadable');
});
