// Issue #358, criterion d4ccff93: the values drawn per run, and the JavaScript test panel written from them.
import { randomBytes, randomInt } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ROWS = 1000;
export const REBUILDS = 100;
export const INSERT_AT = 50; // the rebuild that inserts the row, from the issue

const key = (kind) => `${kind}-${randomBytes(5).toString('hex')}`;

export function drawValues() {
  const before = [];
  const seen = new Set();
  while (before.length < ROWS) {
    const k = key('row');
    if (!seen.has(k)) { seen.add(k); before.push(k); }
  }
  const insertIndex = randomInt(1, 150); // always above the visible rows: the scroll stays at 200 or more
  const inserted = key('row');
  const after = [...before.slice(0, insertIndex), inserted, ...before.slice(insertIndex)];
  return {
    before, after, inserted, insertIndex,
    root: key('root'), list: key('list'), notice: key('notice'), field: key('field'),
    foldOpen: key('fold'), foldClosed: key('fold'),
    rowH: randomInt(18, 31),
    listH: randomInt(240, 420),
    salt: randomInt(1009, 99991),
    prime: 1000003,
    startIndex: randomInt(300, 700),
  };
}

// What the panel's script draws in a row at a given rebuild. The test computes it too, so a tree that
// did not come from this script at this rebuild does not match.
export const rowText = (v, k, rebuild) => `${k} ${(rebuild * v.salt) % v.prime}`;

export function writePanel(v) {
  const dir = mkdtempSync(join(tmpdir(), 'deep-358-keys-'));
  writeFileSync(join(dir, 'gpui-shell.json'), JSON.stringify({ id: `dev.deepbuild.keys.${v.root}`, name: 'Keys', version: '1.0.0', entry: 'main.js' }));
  writeFileSync(join(dir, 'main.js'), `import { View, div } from "gpui-kit";
import { v_flex, InputState, Input } from "gpui-base";
import { rebuild_count, fold } from "deepbuild";

const V = ${JSON.stringify(v)};

export default class KeysPanel extends View {
  init() {
    this.draft = InputState.new({ placeholder: V.field });
  }

  render() {
    const gen = rebuild_count();
    const rows = gen >= ${INSERT_AT} ? V.after : V.before;
    const stamp = (gen * V.salt) % V.prime;
    return v_flex()
      .id(V.root)
      .size_full()
      .child(
        v_flex()
          .id(V.list)
          .h(V.listH)
          .overflow_y_scroll()
          .children(rows.map((k) => div().id(k).h(V.rowH).child(k + " " + stamp))),
      )
      // The notice comes in with the row, directly above the folds and the field, so their places among
      // their siblings move at the same rebuild the list's do.
      .children(gen >= ${INSERT_AT} ? [div().id(V.notice).child(V.inserted)] : [])
      .child(fold(V.foldOpen, "open me", "body " + stamp))
      .child(fold(V.foldClosed, "leave me", "body " + stamp))
      .child(div().id(V.field).child(Input.new(this.draft)));
  }
}
`);
  return dir;
}
