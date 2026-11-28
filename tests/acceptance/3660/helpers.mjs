import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clock, dump, ended, endOf, log, refused, running, sandbox, since, startOf, stub, throttle, until } from '../3549/helpers.mjs';

export { build, clock, dump, ended, endOf, entryOf, log, refused, running, sandbox, since, startOf, stub, throttle, until } from '../3549/helpers.mjs';

export const POOL_OF_ONE = { cores: 2 };

export function table(box) {
  const file = join(box.table, 'table.json');
  if (!existsSync(file)) return { grants: [], requests: [] };
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function leftBy(box, child) {
  const { grants = [], requests = [] } = table(box);
  return [...grants, ...requests].filter((entry) => entry.pid === child.pid);
}

export const goneHolder = (box, child) => log(box).filter((entry) => entry.event === 'released' && entry.pid === child.pid && entry.reason === 'holder gone');

export async function leaked(box, child, ms = 3_000) {
  await until(() => goneHolder(box, child).length > 0, ms);
  return goneHolder(box, child);
}

export function timeline(box, zero, children) {
  return children.filter(Boolean).map(({ name, child }) => {
    const begun = startOf(box, name), over = endOf(box, name);
    const fate = child.ended === undefined ? 'still waiting' : `ended ${since(zero, child.ended)} with ${child.status}`;
    return `${name}: asked ${since(zero, child.asked)}, its command ${begun ? `started ${since(zero, begun.at)}` : 'never started'}${over ? ` and ended ${since(zero, over.at)}` : ''}; its throttle ${fate}`;
  }).join('\n');
}

export const all = (box, ...children) => () => dump(box, ...children);

export const HOLD_S = 300;
export const LATER_MS = 10_000;
export const WITHIN_MS = 90_000;
export const LIMIT_MS = 30_000;

export async function behindHolder(t, limit) {
  const box = sandbox(t, POOL_OF_ONE);
  const holder = throttle(box, 'build', ['--wait', '10'], stub(box, 'holder', 'sleep', String(HOLD_S)));
  await until(() => startOf(box, 'holder') || !running(holder), 120_000);
  const holding = Boolean(startOf(box, 'holder')) && running(holder);
  if (!holding) return { box, holder, holding, asker: null };
  await clock(holder.asked + LATER_MS);
  const asker = throttle(box, 'build', limit, stub(box, 'asker', 'exit'));
  await ended(asker, asker.asked + WITHIN_MS - Date.now());
  const left = running(asker) ? null : leftBy(box, asker);
  return { box, holder, holding, asker, left };
}

export function judgeTimeout(t, { box, holder, holding, asker, left }, { flag, words }) {
  const show = all(box, holder, asker);
  assert.ok(holding, `the first stub build, ${holder.named}, never held the pool's one token\n${show()}`);
  const story = timeline(box, holder.asked, [{ name: 'holder', child: holder }, { name: 'asker', child: asker }]);
  t.diagnostic(story);
  assert.ok(!running(asker), `the build asked with ${flag}, ${asker.named}, was still waiting ${WITHIN_MS / 1000} s after it asked: admitted, it waits for its turn of the pool past its own ${flag}\n${story}\n${show()}`);
  assert.ok(holder.ended === undefined || holder.ended > asker.ended, `the first stub build ended before the build asked with ${flag} did, so the pool's token was free\n${story}\n${show()}`);
  assert.equal(startOf(box, 'asker'), undefined, `the command of the build asked with ${flag}, ${asker.named}, started: it had a turn, though the first build held the pool's one token\n${story}\n${show()}`);
  assert.equal(asker.status, 3, `the build asked with ${flag}, ${asker.named}, exited ${asker.status}, not 3, an admission timeout's exit\n${show()}`);
  assert.ok(refused(asker), `the build asked with ${flag}, ${asker.named}, printed no line starting \`INCONCLUSIVE no grant: \`\n${show()}`);
  assert.match(asker.output(), words, `the build asked with ${flag}, ${asker.named}, didn't say ${words}\n${show()}`);
  assert.ok(asker.ended - asker.asked >= LIMIT_MS, `the build asked with ${flag}, ${asker.named}, gave up ${((asker.ended - asker.asked) / 1000).toFixed(1)} s after it asked, before its ${LIMIT_MS / 1000} s ran out\n${story}\n${show()}`);
  const entries = log(box), granted = entries.findIndex((e) => e.event === 'granted' && e.pid === asker.pid);
  const timedOut = entries.findIndex((e) => e.event === 'timeout' && e.pid === asker.pid);
  assert.ok(granted >= 0 && entries[granted].class === 'build', `the log holds no granted entry of class build for ${asker.named}: it was never admitted, though build slots were free\n${show()}`);
  assert.ok(timedOut > granted, `the log holds no timeout entry for ${asker.named} after its granted entry\n${show()}`);
  return { granted: entries[granted], timeout: entries[timedOut], show, story, left };
}

export async function judgeGivenBack(box, asker, left, show) {
  assert.deepEqual(left, [], `the table still held the grant or request of ${asker.named} once it had exited: its admission wasn't given back\n${show()}`);
  const pruned = await leaked(box, asker);
  assert.deepEqual(pruned, [], `the table gave back a grant of ${asker.named} only once it found its holder gone: the build left its admission behind when it exited\n${show()}`);
}
