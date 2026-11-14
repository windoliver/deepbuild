// AC1: "For every field typed `json` in the full build's dump, `op: field` gives at least one accepted form. A form
// printed for `slab@1.size`, fed back as the field's value with every number set to 1, passes the document check. A
// planted line that prints `json` alone fails, naming the field."
//
// asserts: the full build's `deep-show kinds --dump` (what `deep kinds --dump` runs) is walked field by field; for
// each field typed json, deep_kinds `{op: "field", path: "<kind>@<major>.<field>"}` on `deep-show run` answers one
// line that gives at least one form (its `forms`, `form` or `shape`; helpers.ts, formFailures; each failure names the
// field). Each form the line for slab@1.size gives is fed back as the size of a slab in a one-slab scene, with every
// number set to 1 (helpers.ts, fedBack), and the agent's deep_show of that scene passes the document check: presented,
// with no error issue. The same walk over `--planted field_size_json_alone` (slab@1.size's line gives type json and
// no form) fails, naming slab@1.size and no other field. The dump is always the unplanted build's.

import { describe, expect, it } from 'vitest';
import {
  PLANT_JSON_ALONE, SIZE_PATH, checkFailures, docId, dumpFields, failsNaming, fedBack, fieldCall, formFailures, formsOf, jsonFields, lineOf, none, run,
  show, showCall, showWorld, slabScene, useFullBuild, type DumpField, type JsonObject,
} from './helpers.ts';

const build = useFullBuild();

/** The full build's fields typed json, read once per file. */
let typed: DumpField[] | undefined;
const typedJson = (bin: string): DumpField[] => (typed ??= jsonFields(dumpFields(bin)));
/** op: field over every field typed json, on the build or its planted twin: the replies and AC1's form check. */
function walk(bin: string, planted?: string): { replies: JsonObject[]; failures: string[] } {
  const fields = typedJson(bin);
  const replies = run(bin, fields.map((f) => fieldCall(f.path)), planted);
  return { replies, failures: formFailures(fields, replies) };
}

describe('AC1 op: field gives each json field\'s accepted forms, and slab@1.size\'s form, fed back, passes the document check', () => {
  it('AC1 for every field typed json in the full build\'s dump, op: field gives at least one accepted form, and each form printed for slab@1.size, fed back with every number set to 1, passes the document check', () => {
    const bin = build();
    const fields = typedJson(bin);
    expect(fields.length, 'the full build\'s dump lists fields typed json').toBeGreaterThan(0);
    expect(fields.map((f) => f.path), `the dump lists ${SIZE_PATH} typed json`).toContain(SIZE_PATH);
    const { replies, failures } = walk(bin);

    const fed: string[] = [];
    const line = lineOf(replies[fields.findIndex((f) => f.path === SIZE_PATH)]!);
    const forms = typeof line === 'string' ? [] : formsOf(line);
    if (forms.length === 0) fed.push(`${SIZE_PATH}: op: field prints no form to feed back`);
    const values = forms.map((form) => ({ form, value: fedBack(form) }));
    for (const v of values.filter((x) => typeof x.value === 'string')) fed.push(`${SIZE_PATH}: ${String(v.value)}`);
    const read = values.filter((x) => typeof x.value !== 'string');
    if (read.length) {
      const docs = read.map((_, i) => docId(i + 1));
      const shown = run(bin, read.map((v, i) => showCall(docs[i]!, slabScene(v.value))), undefined, showWorld(docs));
      read.forEach((v, i) => fed.push(...checkFailures(shown[i]!, `${SIZE_PATH} fed back as ${show(v.value)} from the form ${show(v.form)}`)));
    }
    none([...failures, ...fed], `op: field over the ${fields.length} fields typed json, and ${SIZE_PATH}'s forms fed back`);
  }, 3_600_000);

  it('AC1 a planted line that prints json alone for slab@1.size fails, naming the field', () => {
    const { failures } = walk(build(), PLANT_JSON_ALONE);
    failsNaming(failures, [SIZE_PATH, 'no accepted form'], 'the line that prints json alone');
    expect(failures.filter((f) => !f.startsWith(`${SIZE_PATH} `)), 'the plant changes that one line and nothing else').toEqual([]);
  }, 3_600_000);
});
