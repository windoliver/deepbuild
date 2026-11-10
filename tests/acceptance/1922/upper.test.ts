// AC2: "A test plug-in registers the job kind test.upper through deep.registerJob, with a params schema, one text
// output, the key hash(tool@version, params, input hashes), the output check test.upper_only it registers through
// deep.registerCheck, and a qualification of three fixture texts with their expected bytes; after one approval
// deep_job lists the kind with its tool and runs it on "abc", returning "ABC" by hash with a receipt naming the kind,
// the tool and the key; and a rerun with the same inputs is a cache hit that starts no process"
//
// asserts: `deep install` of test/upper-kind (fixtures/kind: deep.registerCheck('test.upper_only'),
// deep.registerJob('test.upper', {schema, outputs, key, output_checks, qualification}) and
// deep.registerJobTool('test.upper', {tool: 'upper-a@1.0.0', ...})), confirmed once by the stubbed OS, loads it and
// raises no ask; deep_job {op: list} then lists test.upper, held by test/upper-kind, with upper-a@1.0.0; deep_job
// {op: run} on "abc" returns outputs.text.sha256 = SHA-256("ABC"), which the evidence store holds, with a receipt whose
// kind, tool and key are test.upper, upper-a@1.0.0 and a key, starting one process; and the same run again is a cache
// hit (receipt cache hit, the same key and output) that starts no process.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { asks, BASE_PARAMS, brief, done, HOLDER, input, KIND, kindPlugin, listKinds, mustInstall, openWorld, outputOf, proof, receiptOf, runJob, sha256, stored, TOOL_A } from './helpers.ts';

describe('#1922.08e9adc6 A test plug-in registers the job kind test.upper through deep.registerJob, with a params schema, one text output, the key hash(tool@version, params, input hashes), the output check test.upper_only it registers through deep.registerCheck, and a qualification of three fixture texts with their expected bytes; after one approval deep_job lists the kind with its tool and runs it on "abc", returning "ABC" by hash with a receipt naming the kind, the tool and the key; and a rerun with the same inputs is a cache hit that starts no process', () => {
  it('after its one install, deep_job lists test.upper with upper-a@1.0.0, runs it on "abc" to "ABC" by hash with a receipt, and the rerun is a hit that starts no process', async () => {
    const w = await openWorld();
    await mustInstall(w, kindPlugin(join(w.tmp, 'kind')));
    expect(await asks(w), 'the install\'s one confirmation is the only approval: no ask was raised').toEqual([]);
    const kinds = await listKinds(w);
    const kind = kinds.find((k) => k.kind === KIND);
    proof('ac2-list.json', kinds);
    expect(kind, `deep_job lists ${KIND}: ${JSON.stringify(kinds).slice(0, 1500)}`).toBeDefined();
    expect(kind!.plugin, `${KIND} is held by ${HOLDER}`).toBe(HOLDER);
    expect(((kind!.tools ?? []) as { tool: string }[]).map((t) => t.tool), `${KIND} lists its tool ${TOOL_A}`).toContain(TOOL_A);

    const file = input(w, 'in.txt', 'abc');
    const first = await runJob(w, TOOL_A, BASE_PARAMS, file);
    const rec = receiptOf(first.outcome);
    proof('ac2-run.json', { started: first.started, reply: first.outcome.value });
    expect(done(first.outcome), `deep_job runs ${TOOL_A} on "abc": ${brief(first)}`).toBe(true);
    expect(outputOf(first.outcome), 'the output is "ABC", by its hash').toBe(sha256('ABC'));
    expect(await stored(w, sha256('ABC')), 'the evidence store holds the output by that hash').toBeDefined();
    expect({ kind: rec.kind, tool: rec.tool }, 'the receipt names the kind and the tool').toEqual({ kind: KIND, tool: TOOL_A });
    expect(typeof rec.key === 'string' && rec.key.length > 0, `the receipt names the key: ${JSON.stringify(rec)}`).toBe(true);
    expect(rec.cache, 'the first run is a miss').toBe('miss');
    expect(first.started, 'the first run starts one process, outside the hub').toBe(1);

    const rerun = await runJob(w, TOOL_A, BASE_PARAMS, file);
    proof('ac2-rerun.json', { started: rerun.started, reply: rerun.outcome.value });
    expect(done(rerun.outcome), `the rerun is done: ${brief(rerun)}`).toBe(true);
    expect({ cache: receiptOf(rerun.outcome).cache, key: receiptOf(rerun.outcome).key, output: outputOf(rerun.outcome) }, 'the rerun is a cache hit under the same key, with the same output').toEqual({ cache: 'hit', key: rec.key, output: sha256('ABC') });
    expect(rerun.started, 'the cache hit starts no process').toBe(0);
  }, 900_000);
});
