// #2044 criterion 7: an SVG attribute's name is compared by characters, so a name such as `aé` changes nothing of
// the import, and a name such as `ONCLICK` is still refused as script.
// Run: node --test --test-concurrency=1 tests/acceptance/2044/svg.test.mjs   (README.md beside this file)
//
// Three fixtures, one SVG of one path whose root has an attribute named `aé`, no such attribute, or one named
// `ONCLICK` (make-fixtures.mjs). The reader imports each (`deep_canvas_vector::svg::import`, the honest importer, no
// part classes) in a process of its own under a deadline and prints what the import read, as its Debug text, or the
// refusal's code and what it found; the test reads that.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { answer, fixture, holds, imported, run, TEST_MS, tidy } from './helpers.mjs';

// The criterion's tag: `#2044.<first 8 hex digits of the SHA-256 of its text, trimmed, white space collapsed>`.
const AC7 = 'AC7 #2044.78e8c53e';

after(tidy);

test(`${AC7} an SVG whose root has an attribute named aé imports as the same file without that attribute does, and an attribute named ONCLICK is still refused as script`, { timeout: TEST_MS }, () => {
  const [named, plain, handler] = ['attribute.svg', 'attribute-none.svg', 'attribute-onclick.svg'].map(fixture);
  const text = ({ bytes }) => bytes.toString('utf8');
  const root = text(named).slice(0, text(named).indexOf('>') + 1);
  holds(root.startsWith('<svg ') && root.includes(' aé="1"'), `the root of ${named.shown} has no attribute named aé: ${root}`);
  holds(text(plain) === text(named).replace(' aé="1"', ''), `${plain.shown} is not ${named.shown} without its attribute named aé`);
  holds(text(handler) === text(named).replace(' aé="1"', ' ONCLICK="1"'), `${handler.shown} is not ${named.shown} with an attribute named ONCLICK in place of the one named aé`);

  const withName = imported(answer(run(['svg', named.file]), `the import of ${named.shown}, whose root has an attribute named aé,`), named.shown);
  const without = imported(answer(run(['svg', plain.file]), `the import of ${plain.shown}`), plain.shown);
  assert.ok(withName === without, `${named.shown}, whose root has an attribute named aé, doesn't import as the same file without that attribute does.\nWith it: ${withName.slice(0, 600)}\nWithout: ${without.slice(0, 600)}`);

  const got = answer(run(['svg', handler.file]), `the import of ${handler.shown}`);
  assert.ok(got?.refused?.code === 'svg_script', `${handler.shown}, whose root has an attribute named ONCLICK, is not refused as script (code svg_script): ${got?.refused ? `it is refused as ${JSON.stringify(got.refused)}` : 'it is imported'}`);
});
