// The panels the #358 tests hand the spike. They are written here, with numbers drawn per run, so nothing in the
// spike can special-case a file: every coordinate is computed by the script at run time, and each panel draws text
// it computes, which appears in no source, to prove the script really ran. All are gpui-shell scripts in the form
// crates/deep-app/panels/*/main.js uses.
import { randomInt } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const color = () => `#${[randomInt(200, 250), randomInt(0, 40), randomInt(200, 250)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;

// The panel's area and a card beside it, moved a little each run, in window points.
export function layout() {
  const area = [100 + randomInt(0, 50), 100 + randomInt(0, 50), 500, 400];
  const card = [800 + randomInt(0, 50), 300 + randomInt(0, 50), 480, 240];
  const a = randomInt(6, 12), b = randomInt(7, 13);
  return { area, card, a, b, marker: `ran:${a * b}`, question: `Ship build ${randomInt(1000, 9999)}?`, fill: color(), escape: color() };
}

const escaping = (at, { w = 80, h = 80 } = {}, extra = '') => `div().absolute().left(${at[0]}).top(${at[1]}).w(${w}).h(${h}).bg(ESCAPE)${extra}.child(\`esc:\${a + b}\`)`;

// Each draws by the same frame; `draw` is the expression of what it adds, in terms of the panel's own size.
export const CASES = {
  'in-bounds': { pass: true, draw: () => 'null' },
  'left': { pass: false, kinds: ['outside_panel'], draw: () => escaping(['-(a * b)', '10']) },
  'right': { pass: false, kinds: ['outside_panel'], draw: ({ area }) => escaping([`${area[2]} - a`, '10']) },
  'below': { pass: false, kinds: ['outside_panel'], draw: ({ area }) => escaping(['10', `${area[3]} - b`]) },
  // Inside its parent's box, beyond the panel's: only the laid-out tree shows it.
  'nested': { pass: false, kinds: ['outside_panel'], draw: ({ area }) => `div().absolute().left(${area[2] - 100}).top(10).w(80).h(80).child(${escaping(['a * b + 80', '0'])})` },
  // A panel reaching the card, the design's own "or over the card".
  'over-card': { pass: false, kinds: ['outside_panel', 'over_card'], draw: ({ area, card }) => escaping([`${card[0] - area[0]} + a`, `${card[1] - area[1]} + b`], { w: card[2] - 40, h: card[3] - 40 }) },
  // In bounds on its first tree and escaping on a later one: the check holds for every invalidation.
  'late': { pass: false, kinds: ['outside_panel'], firstUpdate: 1, draw: () => `this.n >= 2 ? ${escaping(['-(a * b)', '10'])} : null` },
};

export function panelSource(id, shape) {
  return `import { View, div } from "gpui-kit";

const ESCAPE = "${shape.escape}";

export default class Panel extends View {
  init() { this.n = 0; }
  render() {
    this.n += 1;
    const a = ${shape.a};
    const b = ${shape.b};
    const added = ${CASES[id].draw(shape)};
    const root = div().size_full().bg("${shape.fill}").child(\`ran:\${a * b}\`);
    return added ? root.child(added) : root;
  }
}
`;
}

export function writePanel(source, manifest) {
  const dir = mkdtempSync(join(tmpdir(), 'deep-358-panel-'));
  writeFileSync(join(dir, 'main.js'), source);
  if (manifest) writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 1));
  return dir;
}

// A panel that tries every way out it can name, each caught, then draws its computed text. Its reach goes to the
// test's own listener and its program to a canary file, so a success is seen outside the panel.
export function escapeArtist({ a, b, port, canary }) {
  return `import { View, div } from "gpui-kit";

export default class Artist extends View {
  init(_props, cx) {
    const url = "http://127.0.0.1:${port}/panel";
    const attempts = [
      () => fetch(url),
      () => new WebSocket("ws://127.0.0.1:${port}/panel"),
      () => { const x = new XMLHttpRequest(); x.open("GET", url); x.send(); },
      () => import("process").then((p) => p.default.run("/usr/bin/touch", [${JSON.stringify(canary)}])),
      () => import("process").then((p) => p.default.run("/bin/sh", ["-c", ${JSON.stringify(`touch ${canary}`)}])),
      () => import("child_process").then((p) => p.execSync("touch ${canary}")),
      () => import("net").then((n) => n.connect(${port}, "127.0.0.1")),
      () => cx.open_url(url),
    ];
    for (const attempt of attempts) {
      try { const p = attempt(); if (p && p.catch) p.catch(() => {}); } catch (_) {}
    }
    this.tried = attempts.length;
  }
  render() {
    const a = ${a};
    const b = ${b};
    return div().size_full().child(\`ran:\${a * b}\`).child(\`tried:\${this.tried}\`);
  }
}
`;
}

// The manifest gpui-shell would honor for those attempts, which an agent-built panel can write for itself:
// the policy is empty plus DeepBuild's modules, so asking changes nothing.
export function greedyManifest(port) {
  return {
    id: 'com.example.panel358', name: 'Greedy', version: '1.0.0', entry: 'main.js',
    capabilities: { network: { hosts: ['127.0.0.1'], http: [{ scheme: 'http', host: '127.0.0.1', port, methods: ['GET'], paths: ['/panel'] }] }, execute: true, process: true },
  };
}

export const gitManifest = (port) => ({ id: 'com.example.panel358git', name: 'Git', version: '1.0.0', entry: 'main.js', dependencies: { dep: { git: `http://127.0.0.1:${port}/dep.git` } } });

// Draws a rectangle and computed text, and burns `iterations` of a loop in each render.
export function burner({ a, b, iterations }) {
  return `import { View, div } from "gpui-kit";

export default class Burner extends View {
  render() {
    let x = ${a};
    for (let i = 0; i < ${iterations}; i += 1) { x = (x * 31 + i) & 65535; }
    return div().size_full().child(\`ran:\${${a} * ${b}}\`).child(\`x:\${x & 0}\`);
  }
}
`;
}

// Moves focus once from a timer no gesture started, and from a button; the button's press also tries again later,
// on the same gesture, once you've moved away.
export function focusPanel({ a, b }) {
  return `import { View, div } from "gpui-kit";
import { Button } from "gpui-base";

export default class Focus extends View {
  init(_props, cx) {
    this.focus = cx.focus_handle();
    cx.timer.after(50, () => { try { this.focus.focus(); } catch (_) {} });
    this.cx = cx;
  }
  render() {
    return div().size_full().track_focus(this.focus).child(\`ran:\${${a} * ${b}}\`).child(
      Button.new("go").w(100).h(40).child("go").on_click(() => {
        this.focus.focus();
        this.cx.timer.after(400, () => { try { this.focus.focus(); } catch (_) {} });
      }),
    );
  }
}
`;
}

export const scratch = () => { const dir = mkdtempSync(join(tmpdir(), 'deep-358-')); mkdirSync(dir, { recursive: true }); return dir; };
