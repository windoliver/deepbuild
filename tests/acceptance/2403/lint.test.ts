// AC2: A lane fails a change that adds a literal the app draws outside the table, naming the file and line. A planted
// button whose label is a literal fails it.
// AC4, its wrong program: a planted sentence joined from a word and a number fails the lane, naming it.
//
// The lane is the lint lane of scripts/lanes.mjs (`checks`), whose command for this is `node scripts/app-copy-lint.mjs`
// (README, Surface 7). Each plant is one line appended to a file of a copy of the checkout's source under /tmp (#1458's
// `sourceCopy`: crates, scripts and contracts, no build output), and the lint runs from this checkout with `--root <copy>`,
// so the checkout never changes. The copy isn't compiled: a lint reads source. The button is written as the app writes
// "Set up" (welcome.rs, `control(id, Control, label, chrome)`); the sentence joins a number and a word the table gives,
// through `crate::copy::text` (README, Surface 5).
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, fails, ID, keysOf, lanes, LINT, lint, MIN, names, plant, runs, shown, sourceCopy, tables } from './helpers.ts';

afterAll(cleanup, 60_000);
const T = 20 * MIN;
const WELCOME = 'crates/deep-app/src/welcome.rs';
const VIEWS = 'crates/deep-app/src/views.rs';

describe('#2403 the lint lane keeps the app\'s own words in the table', () => {
  it(`AC2 ${ID.lint}: the lint lane runs the app's copy lint, which passes the checkout's source and fails a planted button whose label is a literal, naming the file and line`, async () => {
    const { checks } = await lanes();
    expect(runs(checks.filter((l) => l.name === 'lint'), [LINT]), `the lint lane in scripts/lanes.mjs runs node ${LINT}`).toBe(true);
    const control = await lint(sourceCopy());
    expect(control.code === 0 && fails(control).length === 0, `the lint passes an unplanted copy of the checkout: ${shown(control)}`).toBe(true);
    const root = sourceCopy();
    const line = plant(root, WELCOME, ['fn planted_2403_button(chrome: &chrome::Chrome) -> impl IntoElement { control("planted-2403", Control::Plain, "Archive every finished task", chrome) }']);
    const ran = await lint(root);
    expect(ran.code, `the lint exits 1 on the planted button: ${shown(ran)}`).toBe(1);
    expect(names(ran, WELCOME, line), `a FAIL line names ${WELCOME}:${line}: ${shown(ran)}`).toBe(true);
  }, T);

  it(`AC4 ${ID.counts}: a planted count's sentence joined from a word of the table and a number fails the lint, naming its file and line`, async () => {
    const t = tables();
    if (typeof t === 'string') expect.fail(t);
    const key = keysOf(t, 'Needs you').find((k) => typeof t.en[k] === 'string');
    expect(key, 'the English table has a key whose English is "Needs you"').toBeDefined();
    const control = await lint(sourceCopy());
    expect(control.code === 0 && fails(control).length === 0, `the lint passes an unplanted copy of the checkout: ${shown(control)}`).toBe(true);
    const root = sourceCopy();
    const line = plant(root, VIEWS, [`fn planted_2403_count(n: usize) -> String { format!("{n} {}", crate::copy::text(${JSON.stringify(key)})) }`]);
    const ran = await lint(root);
    expect(ran.code, `the lint exits 1 on the planted sentence: ${shown(ran)}`).toBe(1);
    expect(names(ran, VIEWS, line), `a FAIL line names ${VIEWS}:${line}: ${shown(ran)}`).toBe(true);
  }, T);
});
