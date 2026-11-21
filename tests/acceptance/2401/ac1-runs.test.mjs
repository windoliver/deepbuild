// #2401 AC1: "The 40 runs are on the record, each with its label, its tokens, the window before and after, and Claude
// Code's version. A run during which the window moved by more than the run's own use is left out, and the write-up
// says how many were". Scope: one fixed read-only job (the review check's shape), 20 runs under each of two labels,
// one account and model, interleaved; tokens by kind from each run's stream; the 5-hour and the weekly window.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AC, ENTRYPOINT, LABELS, RECORD, RUNS_PER_LABEL, SECRETS, WRITE_UP, finite, iso, loadFacts, loadRecord, obj, readText, runs, whyLeftOut,
} from './helpers.mjs';

test(`${AC[1]} the 40 runs are on the record: 20 under each label, interleaved, one job, account, model and Claude Code version, each with its tokens from its stream and both windows before and after`, () => {
  const r = loadRecord();
  const list = runs(r);
  assert.equal(list.length, 2 * RUNS_PER_LABEL, `${RECORD}: 40 runs, found ${list.length}`);
  for (const label of LABELS) assert.equal(list.filter((x) => x.label === label).length, RUNS_PER_LABEL, `${RECORD}: 20 runs under ${label}`);

  // One fixed read-only job, the review check's shape: the adapter's readOnlyJob launch, its model maybe set.
  const job = loadFacts().launch.readOnlyJob.args;
  assert.ok(obj(r.job) && Array.isArray(r.job.args), `${RECORD}: job.args, the one command line every run started with`);
  const m = job.indexOf('--model');
  job.forEach((a, i) => {
    if (i !== m + 1 || m < 0) assert.equal(r.job.args[i], a, `${RECORD}: job.args starts with the facts' readOnlyJob args (${job.join(' ')}); at ${i}: ${JSON.stringify(r.job.args[i])}`);
  });
  assert.ok(typeof r.job.prompt_sha256 === 'string' && /^[0-9a-f]{64}$/.test(r.job.prompt_sha256), `${RECORD}: job.prompt_sha256, the one prompt every run read on stdin`);

  // One account, never its ID; on a plan, not an API key.
  assert.equal(r.accounts, 1, `${RECORD}: accounts, the number of distinct accounts the runs ran under, is 1: ${JSON.stringify(r.accounts)}`);
  const version = r.claude_code_version;
  assert.ok(typeof version === 'string' && /^\d+\.\d+\.\d+/.test(version), `${RECORD}: claude_code_version: ${JSON.stringify(version)}`);
  const model = list[0].first_entry.model;
  assert.ok(typeof model === 'string' && model.trim(), `${RECORD} run 1: the first entry names its model`);

  const hashes = new Set();
  for (const [i, run] of list.entries()) {
    const at = `${RECORD} run ${run.n}`;
    if (i > 0) assert.notEqual(run.label, list[i - 1].label, `${at}: the labels are interleaved, one after the other, but runs ${i} and ${run.n} are both ${run.label}`);
    assert.equal(run.entrypoint, ENTRYPOINT[run.label], `${at}: under ${run.label}, CLAUDE_CODE_ENTRYPOINT is ${JSON.stringify(ENTRYPOINT[run.label])} (null: not set): ${JSON.stringify(run.entrypoint)}`);
    assert.equal(run.account, 1, `${at}: account 1, the one account`);
    assert.equal(run.api_key_set, false, `${at}: ran on the plan, with no API key variable set`);
    assert.ok(iso(run.started_at) && iso(run.ended_at) && Date.parse(run.started_at) < Date.parse(run.ended_at), `${at}: started_at before ended_at, ISO 8601`);
    if (i > 0) assert.ok(Date.parse(run.started_at) >= Date.parse(list[i - 1].ended_at), `${at}: one run at a time: it started before run ${i} ended`);
    const f = run.first_entry;
    assert.ok(f.type === 'system' && f.subtype === 'init', `${at}: first_entry is the stream's first entry, system init: ${JSON.stringify({ type: f.type, subtype: f.subtype })}`);
    assert.equal(f.claude_code_version, version, `${at}: the first entry's Claude Code version is the record's`);
    assert.equal(f.model, model, `${at}: one model for all runs (${model}): ${JSON.stringify(f.model)}`);
    const res = run.result_entry;
    assert.ok(res.type === 'result' && obj(res.usage), `${at}: result_entry is the stream's result entry, with its usage`);
    const u = res.usage;
    assert.deepEqual(
      run.tokens,
      { input: u.input_tokens, output: u.output_tokens, cache_creation: u.cache_creation_input_tokens, cache_read: u.cache_read_input_tokens },
      `${at}: tokens by kind are the result entry's usage: ${JSON.stringify(u)}`,
    );
    assert.ok(typeof run.stream_sha256 === 'string' && /^[0-9a-f]{64}$/.test(run.stream_sha256) && !hashes.has(run.stream_sha256), `${at}: stream_sha256, its own stream's hash`);
    hashes.add(run.stream_sha256);
  }
});

test(`${AC[1]} a run whose 5-hour window moved by more than its own use is left out, and the record and the write-up say how many were`, () => {
  const r = loadRecord();
  const list = runs(r);
  const own = r.own_use;
  assert.ok(obj(own) && finite(own.max_pct_per_mtok) && own.max_pct_per_mtok > 0 && typeof own.basis === 'string' && own.basis.trim(), `${RECORD}: own_use {max_pct_per_mtok > 0, basis, fixed_at}: ${JSON.stringify(own)}`);
  assert.ok(iso(own.fixed_at) && Date.parse(own.fixed_at) <= Date.parse(list[0].started_at), `${RECORD}: own_use.fixed_at, before the first run started: ${JSON.stringify(own.fixed_at)}`);
  let out = 0;
  for (const run of list) {
    const why = whyLeftOut(r, run);
    if (why) out += 1;
    assert.equal(run.kept, why === null, `${RECORD} run ${run.n}: kept is ${run.kept}, but ${why ? `it must be left out: ${why}` : 'nothing leaves it out'}`);
    if (why) assert.ok(typeof run.left_out_because === 'string' && run.left_out_because.trim(), `${RECORD} run ${run.n}: left out, with left_out_because`);
    else assert.equal(run.left_out_because, null, `${RECORD} run ${run.n}: kept, so left_out_because is null`);
  }
  assert.equal(r.left_out, out, `${RECORD}: left_out is the number of runs left out (${out}): ${JSON.stringify(r.left_out)}`);
  const words = out === 0 ? '(?:0|no|none|zero)' : String(out);
  const text = readText(WRITE_UP, "the spike's write-up");
  const sentences = text.split(/(?<=[.!?])\s+|\n\s*\n/);
  assert.ok(
    sentences.some((s) => /left out/i.test(s) && new RegExp(`(^|[^\\d.,])${words}($|[^\\d.,])`, 'i').test(s)),
    `${WRITE_UP} says how many runs were left out (${out}) in a sentence with "left out"`,
  );
});

test(`${AC[1]} the record and the write-up hold no account ID, session ID, key, home path or email address`, () => {
  loadRecord();
  for (const [rel, what] of [[RECORD, 'the record of the 40 runs'], [WRITE_UP, "the spike's write-up"]]) {
    const text = readText(rel, what);
    for (const [name, re] of SECRETS) {
      const hit = text.match(re);
      assert.ok(!hit, `${rel} holds ${name}: ${hit?.[0].slice(0, 12)}…`);
    }
  }
});
