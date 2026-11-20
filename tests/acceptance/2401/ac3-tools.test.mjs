// #2401 AC3: "The tool list of a run under each label is the same, read from each run's first entry, or the difference
// is listed by tool name with the job flag that removes it". Scope: what the label changes besides the rate is listed
// first, so a job gains no tool it didn't have.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AC, LABELS, RECORD, REMOVING_FLAG, loadRecord, obj, runs } from './helpers.mjs';

const sorted = (xs) => [...new Set(xs)].sort();

test(`${AC[3]} each label's tool list, read from every run's first entry, is the record's; the lists are the same, or each tool in one and not the other is listed with the job flag that removes it`, () => {
  const r = loadRecord();
  const list = runs(r);
  const read = {};
  for (const label of LABELS) {
    for (const run of list.filter((x) => x.label === label)) {
      const tools = run.first_entry.tools;
      assert.ok(Array.isArray(tools) && tools.length && tools.every((t) => typeof t === 'string' && t), `${RECORD} run ${run.n}: first_entry.tools, the tools Claude Code offered the run: ${JSON.stringify(tools)}`);
      const s = sorted(tools);
      if (!read[label]) read[label] = { tools: s, from: run.n };
      else assert.deepEqual(s, read[label].tools, `${RECORD}: under ${label}, run ${run.n} was offered other tools than run ${read[label].from}`);
    }
  }
  assert.ok(obj(r.tools), `${RECORD}: tools {default, deepbuild, differences}`);
  for (const label of LABELS) {
    assert.ok(Array.isArray(r.tools[label]), `${RECORD}: tools.${label}, the tool list under ${label}`);
    assert.deepEqual(sorted(r.tools[label]), read[label].tools, `${RECORD}: tools.${label} is what the runs' first entries read`);
  }
  const want = LABELS.flatMap((label) => {
    const other = LABELS.find((l) => l !== label);
    return read[label].tools.filter((t) => !read[other].tools.includes(t)).map((tool) => `${tool} under ${label}`);
  }).sort();
  assert.ok(Array.isArray(r.tools.differences), `${RECORD}: tools.differences, empty when the lists are the same`);
  const listed = r.tools.differences.map((d) => {
    assert.ok(obj(d) && typeof d.tool === 'string' && LABELS.includes(d.under), `${RECORD}: a difference names its tool and the label it is offered under: ${JSON.stringify(d)}`);
    assert.ok(typeof d.flag === 'string' && REMOVING_FLAG.test(d.flag), `${RECORD}: the difference ${d.tool} names the job flag that removes it (--disallowedTools or --tools): ${JSON.stringify(d.flag)}`);
    return `${d.tool} under ${d.under}`;
  }).sort();
  assert.deepEqual(listed, want, `${RECORD}: tools.differences lists exactly the tools offered under one label and not the other`);
});
