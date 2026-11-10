// #245 AC3: "A planted record in which copy_on_write takes 0.6 × the one-instance time yields
// one_instance, and one at 0.4 × with 0.2 ms overhead yields copy_on_write", plus planted twins
// that a wrong rule (a strict "under half", "at most 0.3 ms", p50 only, reading the stored
// verdict, trusting a record off the reference Mac or with numbers missing) gets wrong.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clone, expectedVerdict, loadRule, planted } from './helpers.mjs';

// [name, record, expected]. Every case is also run through the test's own oracle, so the table
// and the oracle check each other.
const cases = [
  ['the issue: copy_on_write at 0.6x the one-instance time', planted({ ratio: 0.6, overhead: 0.2 }), 'one_instance'],
  ['the issue: copy_on_write at 0.4x with 0.2 ms overhead', planted({ ratio: 0.4, overhead: 0.2 }), 'copy_on_write'],
  ['0.4x with 0.35 ms overhead', planted({ ratio: 0.4, overhead: 0.35 }), 'one_instance'],
  ['exactly 0.5x ("at most half")', planted({ ratio: 0.5, overhead: 0.2 }), 'copy_on_write'],
  ['just over 0.5x', planted({ ratio: 0.5001, overhead: 0.2 }), 'one_instance'],
  ['0.4x with overhead exactly 0.3 ms ("under")', planted({ ratio: 0.4, overhead: 0.3 }), 'one_instance'],
  ['0.4x with overhead just under 0.3 ms', planted({ ratio: 0.4, overhead: 0.299 }), 'copy_on_write'],
  ['0.4x with no overhead at all', planted({ ratio: 0.4, overhead: 0 }), 'copy_on_write'],
  ['p50 at 0.4x but p95 at 0.6x', planted({ ratio: 0.4, ratio95: 0.6, overhead: 0.2 }), 'one_instance'],
  ['p50 at 0.6x but p95 at 0.4x', planted({ ratio: 0.6, ratio95: 0.4, overhead: 0.2 }), 'one_instance'],
  ['p50 at 0.4x, p95 exactly 0.5x', planted({ ratio: 0.4, ratio95: 0.5, overhead: 0.2 }), 'copy_on_write'],
  ['overhead 0.2 ms at p50 but 0.35 ms at p95', planted({ ratio: 0.4, overhead: 0.35, overhead50: 0.2 }), 'one_instance'],
  ['copy_on_write slower than one_instance', planted({ ratio: 2.5, overhead: 0.2 }), 'one_instance'],
  ['0.6x whose own verdict field says copy_on_write', planted({ ratio: 0.6, overhead: 0.2, verdict: 'copy_on_write' }), 'one_instance'],
  ['0.4x whose own verdict field says one_instance', planted({ ratio: 0.4, overhead: 0.2, verdict: 'one_instance' }), 'copy_on_write'],
];

// Twins of the 0.4x / 0.2 ms record that must fall back to one_instance: off the reference Mac or
// its conditions, off the issue's parameters, or with a number missing or not a number.
const good = () => planted({ ratio: 0.4, overhead: 0.2 });
const twin = (name, edit) => {
  const r = good();
  edit(r);
  cases.push([name, r, 'one_instance']);
};
twin('a Mac that isn\'t a reference Mac', (r) => { r.host.model = 'Mac14,2'; });
twin('not macOS', (r) => { r.host.os = 'Linux'; });
twin('no host', (r) => { delete r.host; });
twin('no macOS build recorded', (r) => { delete r.host.os_build; });
twin('on battery', (r) => { r.host.power = 'battery'; });
twin('Low Power Mode on', (r) => { r.host.low_power_mode = true; });
twin('Low Power Mode not recorded', (r) => { delete r.host.low_power_mode; });
twin('thermal state not nominal', (r) => { r.host.thermal = 'fair'; });
twin('4,000 agents', (r) => { r.fixture.agents = 4000; });
twin('30 Hz', (r) => { r.fixture.rate_hz = 30; });
twin('4 blocks', (r) => { r.fixture.blocks = 4; });
twin('no fixture', (r) => { delete r.fixture; });
twin('copy_on_write on 8 threads', (r) => { r.forms.copy_on_write.threads = 8; });
twin('copy_on_write threads not recorded', (r) => { delete r.forms.copy_on_write.threads; });
twin('one_instance on 2 threads', (r) => { r.forms.one_instance.threads = 2; });
twin('only 100 steps of copy_on_write', (r) => { r.forms.copy_on_write.steps = 100; });
twin('one_instance steps not recorded', (r) => { delete r.forms.one_instance.steps; });
twin('no one_instance form', (r) => { delete r.forms.one_instance; });
twin('no copy_on_write form', (r) => { delete r.forms.copy_on_write; });
twin('one_instance overhead not recorded', (r) => { delete r.forms.one_instance.overhead_ms; });
twin('copy_on_write p50 above its p95', (r) => { r.forms.copy_on_write.wall_ms.p50 = 5; r.forms.copy_on_write.wall_ms.p95 = 4.8; });
twin('copy_on_write wall time zero', (r) => { r.forms.copy_on_write.wall_ms.p50 = 0; r.forms.copy_on_write.wall_ms.p95 = 0; });
twin('negative overhead', (r) => { r.forms.copy_on_write.overhead_ms.p50 = -0.1; r.forms.copy_on_write.overhead_ms.p95 = -0.1; });
for (const form of ['one_instance', 'copy_on_write']) {
  for (const key of ['wall_ms', 'overhead_ms']) {
    for (const p of ['p50', 'p95']) {
      twin(`${form}.${key}.${p} missing`, (r) => { delete r.forms[form][key][p]; });
      twin(`${form}.${key}.${p} NaN`, (r) => { r.forms[form][key][p] = Number.NaN; });
      twin(`${form}.${key}.${p} null`, (r) => { r.forms[form][key][p] = null; });
      twin(`${form}.${key}.${p} a string`, (r) => { r.forms[form][key][p] = String(r.forms[form][key][p]); });
    }
  }
}
twin('one_instance wall time Infinity', (r) => { r.forms.one_instance.wall_ms.p50 = Infinity; r.forms.one_instance.wall_ms.p95 = Infinity; });

test('#245 AC3 the test\'s own oracle agrees with every planted record\'s expected verdict', () => {
  for (const [name, r, want] of cases) assert.equal(expectedVerdict(clone(r)), want, `oracle on: ${name}`);
});

test('#245 AC3 the rule on the issue\'s two planted records: 0.6x yields one_instance, 0.4x with 0.2 ms yields copy_on_write', async () => {
  const verdict = await loadRule();
  assert.equal(verdict(planted({ ratio: 0.6, overhead: 0.2 })), 'one_instance');
  assert.equal(verdict(planted({ ratio: 0.4, overhead: 0.2 })), 'copy_on_write');
});

test('#245 AC3 the rule on planted twins at each threshold and with anything missing', async () => {
  const verdict = await loadRule();
  const wrong = [];
  for (const [name, r, want] of cases) {
    let got;
    try {
      got = verdict(clone(r));
    } catch (e) {
      got = `threw ${e.message}`;
    }
    if (got !== want) wrong.push(`${name}: want ${want}, got ${got}`);
  }
  assert.deepEqual(wrong, [], `the rule got ${wrong.length} of ${cases.length} planted records wrong`);
});

test('#245 AC3 the rule never yields copy_on_write for something that isn\'t a record', async () => {
  const verdict = await loadRule();
  for (const x of [undefined, null, {}, [], 'copy_on_write', 0, { verdict: 'copy_on_write' }]) {
    assert.equal(verdict(x), 'one_instance', `verdict(${JSON.stringify(x)})`);
  }
});
