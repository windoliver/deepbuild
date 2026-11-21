// #2974 AC3 (README: The scenes, Readings): while a drain holds, `deep status` and the hub's health name it: that
// session starts are paused, the holder's process (its PID and command line, from the connection's peer) and since
// when; a start refused under it names the same holder and when the drain lapses, and no promotion, which doesn't hold it.
import { test } from 'node:test';
import { LAPSE_MS, LONG, assert, call, deep, drained, holder, holderIn, isTimeIn, redact, said, sandbox, served, shop, shown, start, startInstalled, textTimeIn, until, wait } from './helpers.mjs';

/** Whether a refusal names a time the drain lapses in [from, to]: epoch, ISO, a UTC clock time with seconds, or "in N s". */
function lapseIn(error, from, to, now) {
  const text = JSON.stringify(error);
  const walk = (v) => (typeof v === 'object' && v ? Object.values(v).some(walk) : isTimeIn(v, from, to, 2000));
  if (walk(error)) return true;
  const stamps = new Set();
  for (let at = from - 2000; at <= to + 2000; at += 1000) stamps.add(new Date(at).toISOString().slice(11, 19));
  if ([...text.matchAll(/\b(\d{2}:\d{2}:\d{2})\b/g)].some(([, hms]) => stamps.has(hms))) return true;
  return [...text.matchAll(/(\d+)\s*(s|sec|secs|seconds?)\b/gi)].some(([, n]) => now + Number(n) * 1000 >= from - 2000 && now + Number(n) * 1000 <= to + 2000);
}

test('#2974.2d1e88a4 while a drain holds, deep status and the hub\'s health name it, its holder\'s process and since when, and a refused start names the holder and when it lapses', LONG, async (t) => {
  const box = await sandbox(t);
  shop(box);
  await startInstalled(box);
  const before = await start(box);
  assert.ok(served(before), `BLOCKED: start.session wasn't served before any drain: ${said(before, box)}`);

  const renewing = holder(box, 'hub.drain', {}, { peer: true, every: 1000, span: 120_000 });
  const first = await until(() => renewing.calls()[0], 120_000, 50);
  assert.ok(first && typeof first.reply === 'object' && first.reply.result, `BLOCKED: hub.drain from a process holding the control token wasn't served: ${redact(JSON.stringify(first?.reply ?? renewing.err), box)}`);
  const pid = renewing.pid, mark = renewing.mark, since = first.t - 1000;
  await wait(3000);

  // The hub's health.
  const health = await call(box, 'hub.health', {}, { ms: 120_000 });
  assert.ok(typeof health === 'object' && health.result, `BLOCKED: hub.health wasn't answered: ${redact(JSON.stringify(health), box)}`);
  const inHealth = holderIn(health.result, pid, mark, since, Date.now());
  assert.ok(inHealth, `while a drain holds, the hub's health must name it: its holder's process, PID ${pid} with its command line (it holds ${mark}), and since when; hub.health reads ${redact(JSON.stringify(health.result), box).slice(0, 2500)}`);
  assert.match(JSON.stringify(inHealth), /paus|drain/i, `the hub's health must say session starts are paused by the drain; its holder reads ${redact(JSON.stringify(inHealth), box)}`);

  // deep status, the text you read.
  const status = await deep(box, ['status']);
  const block = status.stdout.split('\n').filter((l) => /paus|drain/i.test(l) || l.includes(String(pid)) || l.includes(mark)).join('\n');
  const named = /paus/i.test(block) && new RegExp(`\\b${pid}\\b`).test(block) && block.includes(mark) && textTimeIn(block, since, Date.now());
  assert.ok(status.status === 0 && named, `while a drain holds, deep status must say session starts are paused, naming the holder's process (PID ${pid} and its command line, which holds ${mark}) and since when; it printed ${shown(status, box)}`);

  // A start refused under it.
  const now = Date.now();
  const refused = await start(box);
  assert.ok(drained(refused), `BLOCKED: a start under the renewed drain wasn't refused by it: ${said(refused, box)}`);
  const error = refused.reply.error;
  assert.ok(new RegExp(`\\b${pid}\\b`).test(JSON.stringify(error)), `a start refused under the drain must name its holder, PID ${pid}; it reads ${said(refused, box)}`);
  // Renewed once a second, the drain lapses 30 s after its last renewal: 25 to 35 s from now.
  assert.ok(lapseIn(error, now + LAPSE_MS - 5000, refused.done + LAPSE_MS + 5000, now), `a start refused under the drain must say when the drain lapses, about ${LAPSE_MS / 1000} s after its last renewal; it reads ${said(refused, box)}`);
  assert.doesNotMatch(JSON.stringify(error), /promot/i, `a drain no deep hub promote holds must not read as a promotion's; the refusal reads ${said(refused, box)}`);
});
