// The key planes' guard (#1462). It reads the app's action table, crates/deep-app/src/actions.json, and the last
// release's, scripts/actions-released.json (the same shape, rewritten at each release), and fails:
// - a chord with ⌥ whose `variant_of` isn't the action on the same chord without ⌥: ⌥ gives a variant of one action,
//   never another;
// - any ⌃ binding: ⌃ chords are left to terminals and editors;
// - two actions on one chord;
// - a chord the last release's table gives one action and this table another: a shipped chord never moves.
// One `FAIL keymap: <chord>: <why>` line per finding, the chord as the table writes it, or one `PASS keymap` line; exit
// 1 on a finding. `--root <dir>` checks another checkout.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TABLE = 'crates/deep-app/src/actions.json';
const RELEASED = 'scripts/actions-released.json';

const at = process.argv.indexOf('--root');
if (at !== -1 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--'))) {
  console.log('BLOCKED keymap: --root takes a folder\n  Fix: node scripts/keymap-guard.mjs [--root <checkout>]');
  process.exit(2);
}
const root = at === -1 ? fileURLToPath(new URL('../', import.meta.url)) : process.argv[at + 1];

/** The actions in `path` under the root; BLOCKED, exit 2, when it isn't there or isn't the table's shape. */
function read(path) {
  const file = join(root, path);
  if (!existsSync(file)) {
    console.log(`BLOCKED keymap: ${path} doesn't exist`);
    process.exit(2);
  }
  const actions = JSON.parse(readFileSync(file, 'utf8')).actions;
  if (!Array.isArray(actions)) {
    console.log(`BLOCKED keymap: ${path} holds no {"actions": [...]}`);
    process.exit(2);
  }
  return actions;
}

const MODS = ['ctrl', 'alt', 'shift', 'cmd'];
const ALIAS = { control: 'ctrl', option: 'alt', command: 'cmd', meta: 'cmd' };
/** A keystroke in GPUI's form, its modifiers in one order, so `cmd-alt-x` and `alt-cmd-x` are one chord. */
function chord(key) {
  const k = key.trim().toLowerCase();
  const parts = k.endsWith('--') ? [...k.slice(0, -2).split('-'), '-'] : k.split('-');
  const last = parts.pop();
  const mods = new Set(parts.map((p) => ALIAS[p] ?? p));
  return { mods, key: last, canon: [...MODS.filter((m) => mods.has(m)), last].join('-') };
}

const table = read(TABLE);
const released = read(RELEASED);
const findings = [];
const fail = (key, why) => findings.push(`FAIL keymap: ${key}: ${why}`);

const byChord = new Map();
for (const action of table) {
  if (!action.key) continue;
  const c = chord(action.key);
  const other = byChord.get(c.canon);
  if (other) fail(action.key, `"${other.name}" and "${action.name}" are both on it`);
  else byChord.set(c.canon, action);
}

for (const action of table) {
  if (!action.key) continue;
  const c = chord(action.key);
  if (c.mods.has('ctrl')) fail(action.key, `"${action.name}" binds ⌃, which is left to terminals and editors`);
  if (c.mods.has('alt')) {
    const plain = [...MODS.filter((m) => m !== 'alt' && c.mods.has(m)), c.key].join('-');
    const base = byChord.get(plain);
    if (!base) fail(action.key, `"${action.name}" adds ⌥ to ${plain}, which no action is on, so it is no variant`);
    else if (action.variant_of !== base.name) {
      fail(action.key, `"${action.name}" adds ⌥ to ${base.key} ("${base.name}") but its variant_of is ${JSON.stringify(action.variant_of)}`);
    }
  }
}

for (const shipped of released) {
  if (!shipped.key) continue;
  const now = byChord.get(chord(shipped.key).canon);
  if (now && now.name !== shipped.name) {
    fail(shipped.key, `the last release gave it to "${shipped.name}" and this table gives it to "${now.name}"; a new action takes a free key`);
  }
}

if (findings.length) {
  console.log(findings.join('\n'));
  process.exit(1);
}
console.log(`PASS keymap: ${table.length} actions, ${byChord.size} chords, none moved since the last release`);
