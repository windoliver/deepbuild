// AC1 #2655: "The hub's main thread loads no module of `@deepbuild/evidence` and none of `@deepbuild/contracts` but the
// one it names, read from a load hook as `packages/hub/test/startup-memory.test.ts` reads its lists. On the merge base it
// loads both entries, and the test fails, naming the modules."
//
// A hub of the checkout under test starts on a fresh home with that test's own preload (a `load` hook that appends
// `<thread> <url>` for every module a thread loads), serves one session's first hooks as deep-hook sends them, and the
// list is read. The main thread is the one that loaded packages/hub/dist/server.js.
//   node --test tests/acceptance/2655/loads.test.mjs          (DEEP_2655_BASE=<built merge base> also prints its list)
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { BASE, exchange, hookLine, idOf, loaded, loadsPreload, needChange, payloadOf, seqOf, sleep, startHub, tempHome, unbuilt } from './lib.mjs';

const SESSION = '6f1c2b9e-1111-4222-8333-444455552655';

/** The load list of one hub of `checkout`, read after it started and served a session's first four hooks. */
async function loadList(checkout) {
  const home = tempHome('l');
  const log = join(home, 'loads.log');
  const hub = await startHub(checkout, { home, env: { NODE_OPTIONS: `--import=${loadsPreload(home)}`, DEEP_TEST_LOADS: log } });
  try {
    const hooks = [
      ['SessionStart', { source: 'startup' }],
      ['UserPromptSubmit', { prompt: 'list the source folder' }],
      ['PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls src' }, tool_use_id: 'call_2655_loads' }],
      ['PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls src' }, tool_use_id: 'call_2655_loads', tool_response: { stdout: 'a.ts\n', stderr: '' } }],
    ];
    for (const [n, [event, more]] of hooks.entries()) {
      const got = await exchange(hub.socket, hookLine({ id: idOf(n + 1), seq: seqOf(n + 1), event, payload: payloadOf(home, SESSION, event, more) }));
      if (!got.reply || got.reply.exit !== 0) throw Error(`BLOCKED: the hub didn't serve the session's ${event}: ${JSON.stringify(got.lines).slice(0, 300)}`);
    }
    await sleep(300);
    const rows = loaded(log);
    const main = rows.find((r) => r.url.endsWith('packages/hub/dist/server.js'))?.thread;
    if (main === undefined) throw Error('BLOCKED: no thread in the load list loaded packages/hub/dist/server.js, so the main thread can\'t be told');
    const of = (thread, pkg) => [...new Set(rows.filter((r) => r.thread === thread && r.url.startsWith(`packages/${pkg}/`)).map((r) => r.url))];
    const others = [...new Set(rows.map((r) => r.thread))].filter((t) => t !== main);
    return {
      main,
      evidence: of(main, 'evidence'),
      contracts: of(main, 'contracts'),
      // The scrubber and the validator still run somewhere: a list that shows them on no thread shows nothing.
      elsewhere: { evidence: others.flatMap((t) => of(t, 'evidence')).length, contracts: others.flatMap((t) => of(t, 'contracts')).length },
    };
  } finally {
    await hub.stop();
  }
}

test('AC1 #2655 the main thread loads no module of @deepbuild/evidence and none of @deepbuild/contracts but the one it names', { timeout: 300_000 }, async (t) => {
  const list = await loadList(needChange());
  t.diagnostic(`change, main thread ${list.main}: evidence [${list.evidence.join(', ')}]; contracts [${list.contracts.join(', ')}]`);
  // The Proof asks for the merge base's list beside the change's; it decides nothing here.
  if (BASE && !unbuilt(BASE)) {
    const base = await loadList(BASE);
    t.diagnostic(`merge base, main thread ${base.main}: evidence [${base.evidence.join(', ')}]; contracts [${base.contracts.join(', ')}]`);
  } else t.diagnostic('merge base: not read (DEEP_2655_BASE names no built checkout)');
  if (!list.elsewhere.evidence || !list.elsewhere.contracts) throw Error(`BLOCKED: the load list shows no other thread loading the scrubber (${list.elsewhere.evidence} modules of packages/evidence) or the validator (${list.elsewhere.contracts} of packages/contracts) though hooks were served, so it can't show the main thread loading neither`);
  const beyond = [...list.evidence, ...(list.contracts.length > 1 ? list.contracts : [])];
  assert.deepEqual(beyond, [], `the hub's main thread loaded ${list.evidence.length} modules of @deepbuild/evidence (none allowed) and ${list.contracts.length} of @deepbuild/contracts (the one it names allowed): ${beyond.join(', ')}`);
});
