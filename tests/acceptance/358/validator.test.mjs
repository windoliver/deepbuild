// Proves the #358 checks themselves: each planted wrong spike must be rejected and a right one must pass. These
// test the tests, so they pass on the base, with no spike present.
// Run: node --test tests/acceptance/358/validator.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { CASES, layout, panelSource } from './panels.mjs';
import {
  artifactFor, benchmarkTreeProblems, benchShapeProblems, BUDGET_MS, checkProblems, colorCounts, commandProblems, COLUMNS, costProblems, decisionProblems, DECISION_ROW, decodePng, entitlementFileProblems, escapes, flatten, jitProblems, machineProblems, p99, pixelProblems, REFERENCES, releaseProblems, ROWS, signatureProblems, signCommandProblems, verdict, WARMUP, WINDOW,
} from './validate.mjs';

const rejects = (problems, pattern) => assert.ok(problems.some((problem) => pattern.test(problem)), `expected a problem matching ${pattern}, got:\n${problems.join('\n') || '(none)'}`);
const holds = (problems) => assert.deepEqual(problems, [], `\n${problems.join('\n')}`);

// ------------------------------------------------------------------ the render check

const AREA = [100, 100, 500, 400], CARD = [800, 300, 480, 240], MARKER = 'ran:42';
const box = (bounds, children = [], text) => ({ kind: 'div', ...(text ? { text } : {}), bounds, children });
const inTree = () => box(AREA, [box([110, 110, 50, 20], [], MARKER)]);
const output = (trees, violations = [], extra = {}) => ({ result: violations.length ? 'fail' : 'pass', origin: 'agent_built', runtime: 'panel_host', appPid: 10, hostPid: 11, trees, violations, card: { question: 'Ship?' }, ...extra });
const wantPass = { pass: true, marker: MARKER, area: AREA, card: CARD, question: 'Ship?', updates: 3 };
const wantFail = (kinds) => ({ pass: false, kinds, marker: MARKER, area: AREA, card: CARD, question: 'Ship?', updates: 3 });
const escaped = (bounds) => box(AREA, [box([110, 110, 50, 20], [], MARKER), box(bounds)]);

test('a panel in bounds that passes holds; each way of not running it or refusing it is rejected', () => {
  const good = output([inTree(), inTree(), inTree()]);
  holds(checkProblems('c', wantPass, { status: 0, output: good }));
  rejects(checkProblems('c', wantPass, { status: 1, output: { ...good, result: 'fail', violations: [{ kind: 'outside_panel', bounds: AREA }] } }), /in-bounds panel was refused/);
  rejects(checkProblems('c', wantPass, { status: 101, output: undefined }), /no JSON output/);
  rejects(checkProblems('c', wantPass, { status: 0, output: { ...good, trees: [box(AREA), box(AREA), box(AREA)] } }), /script didn't run/);
  rejects(checkProblems('c', wantPass, { status: 0, output: { ...good, hostPid: 10 } }), /aren't two processes/);
  rejects(checkProblems('c', wantPass, { status: 0, output: { ...good, runtime: 'in_process' } }), /not panel_host/);
  rejects(checkProblems('c', wantPass, { status: 0, output: { ...good, trees: [inTree()] } }), /one per invalidation/);
  rejects(checkProblems('c', wantPass, { status: 0, output: { ...good, card: null } }), /question card isn't up/);
});

test('a panel drawing beyond its area must be refused, naming a node the trees really place there', () => {
  const bounds = [50, 110, 80, 80];
  const trees = [escaped(bounds), escaped(bounds), escaped(bounds)];
  const violation = { kind: 'outside_panel', bounds, update: 0 };
  holds(checkProblems('c', wantFail(['outside_panel']), { status: 1, output: output(trees, [violation]) }));
  rejects(checkProblems('c', wantFail(['outside_panel']), { status: 0, output: output(trees) }), /exited 0, not 1/);
  rejects(checkProblems('c', wantFail(['outside_panel']), { status: 1, output: output(trees, [{ kind: 'outside_panel', bounds: [0, 0, 1, 1] }]) }), /matches no node/);
  // A check refusing by reading the source: it never laid the panel out.
  rejects(checkProblems('c', wantFail(['outside_panel']), { status: 1, output: output([inTree(), inTree(), inTree()], [violation]) }), /no refusal is proven/);
  // A crash is no refusal.
  rejects(checkProblems('c', wantFail(['outside_panel']), { status: 101, output: output(trees, [violation]) }), /exited 101/);
});

test('reaching the card must name the card; a late escape must name its update', () => {
  const bounds = [810, 310, 100, 100];
  const trees = [escaped(bounds), escaped(bounds), escaped(bounds)];
  const out = { kind: 'outside_panel', bounds, update: 0 }, over = { kind: 'over_card', bounds, update: 0 };
  holds(checkProblems('c', wantFail(['outside_panel', 'over_card']), { status: 1, output: output(trees, [out, over]) }));
  rejects(checkProblems('c', wantFail(['outside_panel', 'over_card']), { status: 1, output: output(trees, [out]) }), /doesn't name over_card/);
  const late = [inTree(), escaped([50, 110, 80, 80]), escaped([50, 110, 80, 80])];
  const want = { ...wantFail(['outside_panel']), firstUpdate: 1 };
  holds(checkProblems('c', want, { status: 1, output: output(late, [{ kind: 'outside_panel', bounds: [50, 110, 80, 80], update: 1 }]) }));
  rejects(checkProblems('c', { ...want, firstUpdate: 0 }, { status: 1, output: output(late, [{ kind: 'outside_panel', bounds: [50, 110, 80, 80], update: 1 }]) }), /first escape is at update 1/);
});

test('geometry: edges touching the area or the card are in bounds and off the card; a zero-size node draws nothing', () => {
  assert.deepEqual(escapes([box(AREA)], AREA, CARD), []);
  assert.deepEqual(escapes([box([100, 100, 0, 900])], AREA, CARD), []);
  assert.deepEqual(escapes([box([800, 300, 480, 240])], [0, 0, 800, 982], CARD).map((each) => each.kind), ['outside_panel', 'over_card']);
  assert.deepEqual(escapes([box([700, 300, 100, 10])], [0, 0, 800, 982], CARD), []);
  assert.equal(flatten(box(AREA, [box(AREA, [box(AREA)])])).length, 3);
});

test('each panel case is valid source that draws the marker and uses computed coordinates', () => {
  const shape = layout();
  for (const id of Object.keys(CASES)) {
    const source = panelSource(id, shape);
    assert.ok(source.includes('ran:${a * b}'), id);
    assert.ok(!source.includes(shape.marker), `${id}: the marker appears in the source`);
    new Function(source.replace(/^import .*$/gm, '').replace('export default class', 'return class')); // parses
  }
});

// ------------------------------------------------------------------ PNG

function encode(width, height, paint) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) paint(x, y).forEach((value, c) => { raw[y * (width * 4 + 1) + 1 + x * 4 + c] = value; });
  }
  const chunk = (name, body) => { const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(name, 4, 'latin1'); return Buffer.concat([head, body, Buffer.alloc(4)]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const [PW, PH] = WINDOW.size.map((points) => points * WINDOW.scale);
const FILL = '#e01bf0', ESC = '#c805d2';
const within = (x, y, [ax, ay, aw, ah]) => x >= ax * 2 && x < (ax + aw) * 2 && y >= ay * 2 && y < (ay + ah) * 2;
function render({ fillArea = AREA, escapeAt = null, card = true } = {}) {
  return decodePng(encode(PW, PH, (x, y) => {
    if (card && within(x, y, CARD)) return [(x % 7) * 20, 90, 90, 255];
    if (escapeAt && within(x, y, escapeAt)) return [0xc8, 0x05, 0xd2, 255];
    if (fillArea && within(x, y, fillArea)) return [0xe0, 0x1b, 0xf0, 255];
    return [240, 240, 240, 255];
  }));
}

test('the render holds its fill where the panel is, and shows nothing an escape drew', () => {
  const pass = { pass: true, area: AREA, card: CARD, fill: FILL };
  holds(pixelProblems('c', pass, render()));
  rejects(pixelProblems('c', pass, render({ fillArea: null })), /panel wasn't drawn/);
  rejects(pixelProblems('c', pass, render({ fillArea: [100, 100, 700, 400] })), /beyond its area/);
  rejects(pixelProblems('c', pass, render({ card: false })), /no card was drawn/);
  const refuse = { pass: false, area: AREA, card: CARD, escape: ESC };
  holds(pixelProblems('c', refuse, render({ fillArea: null })));
  rejects(pixelProblems('c', refuse, render({ escapeAt: [50, 110, 80, 80] })), /beyond its area or on the card/);
  rejects(pixelProblems('c', { ...pass, fill: FILL }, decodePng(encode(100, 100, () => [0, 0, 0, 255]))), /not 3024 × 1964/);
  assert.equal(colorCounts(render(), FILL, AREA, 2).beyond, 0);
});

// ------------------------------------------------------------------ the JIT

const treeAnswer = { kind: 'div', children: [{ kind: 'text', text: 'layout:165580141', children: [] }] };
const kernel = (ns, jit) => ({ jit, tree: treeAnswer, renderNs: Array.from({ length: 1000 }, () => ns) });
const OFF = { nativeEnabled: false, installed: 0, nativeEntries: 0 }, ON = { nativeEnabled: true, installed: 1, nativeEntries: 900 };

test('the JIT is judged from the counters and the kernel\'s times, with the switch\'s control flipped', () => {
  holds(jitProblems(kernel(4000, OFF), kernel(1000, ON)));
  rejects(jitProblems(kernel(1000, ON), kernel(1000, ON)), /has the JIT enabled/);
  rejects(jitProblems(kernel(4000, { ...OFF, nativeEntries: 3 }), kernel(1000, ON)), /ran native code/);
  // Counters that say off with a kernel running as fast as compiled.
  rejects(jitProblems(kernel(1000, OFF), kernel(1000, ON)), /reads as compiled/);
  // A control with nothing to show: the switch does nothing.
  rejects(jitProblems(kernel(4000, OFF), kernel(4000, OFF)), /never entered native code/);
  // A kernel that sped up as it warmed.
  const warming = kernel(4000, OFF); warming.renderNs = warming.renderNs.map((_, n) => (n < 500 ? 4000 : 2000));
  rejects(jitProblems(warming, kernel(1000, ON)), /tiered up/);
  rejects(jitProblems({ ...kernel(4000, OFF), renderNs: [1] }, kernel(1000, ON)), /rendered 1 times/);
  rejects(jitProblems({ ...kernel(4000, OFF), tree: { kind: 'div', children: [] } }, kernel(1000, ON)), /kernel's answer/);
});

test('a debug-profile build is rejected from cargo\'s own message', () => {
  const message = (debug) => ({ reason: 'compiler-artifact', target: { name: 'h', kind: ['bin'] }, profile: { debug_assertions: debug }, executable: '/x/h' });
  holds(releaseProblems('h', artifactFor([message(false)], 'h')));
  rejects(releaseProblems('h', artifactFor([message(true)], 'h')), /debug assertions/);
  rejects(releaseProblems('h', artifactFor([{ reason: 'compiler-artifact', target: { name: 'h', kind: ['lib'] } }], 'h')), /built no binary/);
});

test('entitlements and the hardened runtime are read from codesign itself, on a real binary', { skip: process.platform !== 'darwin' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-358-sign-'));
  const sign = (name, ...args) => {
    const path = join(dir, name);
    copyFileSync('/usr/bin/true', path);
    assert.equal(spawnSync('codesign', ['-f', '-s', '-', ...args, path], { encoding: 'utf8' }).status, 0);
    return {
      entitlements: spawnSync('codesign', ['-d', '--entitlements', '-', '--xml', path], { encoding: 'utf8' }).stdout,
      details: spawnSync('codesign', ['-d', '--verbose=4', path], { encoding: 'utf8' }).stderr,
      verified: spawnSync('codesign', ['--verify', '--strict', path], { encoding: 'utf8' }).status === 0,
    };
  };
  holds(signatureProblems('right', sign('right', '--options', 'runtime')));
  rejects(signatureProblems('plain', sign('plain')), /hardened runtime/);
  const plist = join(dir, 'jit.entitlements');
  writeFileSync(plist, '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>');
  rejects(signatureProblems('jit', sign('jit', '--options', 'runtime', '--entitlements', plist)), /allow-jit/);
  rejects(signatureProblems('v', { entitlements: '', details: 'flags=0x10000(runtime)', verified: false }), /doesn't verify/);
});

test('a tracked entitlements file with allow-jit is found; the sign command must take the binary', () => {
  const repo = mkdtempSync(join(tmpdir(), 'deep-358-repo-'));
  const g = (...args) => assert.equal(spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, encoding: 'utf8' }).status, 0);
  g('init', '-q');
  mkdirSync(join(repo, 'app'));
  writeFileSync(join(repo, 'app/a.entitlements'), '<key>com.apple.security.get-task-allow</key>');
  g('add', '.');
  holds(entitlementFileProblems(repo));
  writeFileSync(join(repo, 'app/b.plist'), '<key>com.apple.security.cs.allow-unsigned-executable-memory</key>');
  g('add', '.');
  rejects(entitlementFileProblems(repo), /b\.plist carries .*allow-unsigned/);
  rejects(signCommandProblems({ sign: { command: ['codesign', '-s', '-', 'target/x'] } }), /\{binary\}/);
  holds(signCommandProblems({ sign: { command: ['codesign', '-f', '-s', '-', '--options', 'runtime', '{binary}'] } }));
});

// ------------------------------------------------------------------ the cost and the decision

const machine = { model: REFERENCES[1].model, chip: REFERENCES[1].chip, memoryBytes: REFERENCES[1].memoryBytes, power: 'ac', lowPowerMode: false, thermalState: 'nominal' };
function grid() {
  const cells = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLUMNS; c++) row.push({ kind: 'div', children: [{ kind: 'text', text: `${r}:${c}`, children: [] }] });
    cells.push({ kind: 'h_flex', children: row });
  }
  return { kind: 'v_flex', children: [...cells, { kind: 'button', children: [{ kind: 'text', text: 'Refresh', children: [] }] }] };
}
const oneRun = (ms, spikes = []) => {
  const totalNs = Array.from({ length: 200 }, (_, n) => (spikes.includes(n) ? 50e6 : ms * 1e6));
  return { warmup: WARMUP, totalNs, scriptNs: totalNs.map((t) => t * 0.6), ipcNs: totalNs.map((t) => t * 0.2) };
};
const cost = (ms, over = {}) => {
  const runs = Array.from({ length: 5 }, () => oneRun(ms));
  return { runs, jit: { nativeEnabled: false, nativeEntries: 0 }, hostPid: 2, appPid: 1, tree: grid(), ...verdict(runs), ...over };
};
const TEXT = (ms, tail) => `On gpui-shell's 443-node benchmark with the JIT off the panel host's element tree costs ${ms} ms an update, P99 of the worst of five runs, against the 4 ms budget${tail}`;
const designFor = (text) => `# D\n${DECISION_ROW} ${text} | The measured cost doesn't fit the budget |\n`;

test('p99 and the verdict come from raw times, and one outlier in two hundred stays out of P99, as gpui-shell counts it', () => {
  assert.equal(p99(Array.from({ length: 200 }, (_, n) => (n === 199 ? 1000 : 1))), 1);
  assert.equal(p99(Array.from({ length: 200 }, (_, n) => (n >= 197 ? 1000 : 1))), 1000);
  assert.deepEqual(verdict([oneRun(BUDGET_MS)]), { worstP99Ms: BUDGET_MS, fits: true });
  assert.equal(verdict([oneRun(1), oneRun(4.01)]).fits, false);
  assert.equal(verdict([oneRun(1, [0, 1, 2])]).fits, false);
});

test('a record that fits or doesn\'t is valid when it says what its runs say, and wrong when it doesn\'t', () => {
  holds(costProblems({ machine, cost: cost(1.9) }));
  // Doesn't fit: still a valid decision, since the runs say so.
  holds(costProblems({ machine, cost: cost(6.2) }));
  rejects(costProblems({ machine, cost: cost(6.2, { fits: true }) }), /gives false/);
  rejects(costProblems({ machine, cost: cost(1.9, { worstP99Ms: 0.9 }) }), /the runs give 1\.900/);
  rejects(costProblems({ machine: { ...machine, thermalState: 'fair' }, cost: cost(1.9) }), /INCONCLUSIVE/);
  rejects(costProblems({ machine: { ...machine, model: 'Mac14,2' }, cost: cost(1.9) }), /neither reference/);
  rejects(costProblems({ machine }), /record.cost is missing/);
});

test('the cost\'s shape: five runs of 200 after warm-up, through a process, with the JIT off, on the real grid', () => {
  holds(benchShapeProblems('c', cost(1.9)));
  rejects(benchShapeProblems('c', cost(1.9, { runs: [oneRun(1.9)] })), /1 runs, not 5/);
  rejects(benchShapeProblems('c', cost(1.9, { runs: Array.from({ length: 5 }, () => ({ ...oneRun(1.9), warmup: 1 })) })), /warmed up 1/);
  rejects(benchShapeProblems('c', cost(1.9, { runs: Array.from({ length: 5 }, () => ({ ...oneRun(1.9), totalNs: [1] })) })), /1 updates, not 200/);
  const noIpc = oneRun(1.9); noIpc.ipcNs = noIpc.ipcNs.map(() => 0);
  rejects(benchShapeProblems('c', cost(1.9, { runs: Array.from({ length: 5 }, () => noIpc) })), /didn't cross a process/);
  const under = oneRun(1.9); under.scriptNs = under.scriptNs.map((value) => value * 3);
  rejects(benchShapeProblems('c', cost(1.9, { runs: Array.from({ length: 5 }, () => under) })), /didn't cross a process/);
  rejects(benchShapeProblems('c', cost(1.9, { jit: { nativeEnabled: true, nativeEntries: 9 } })), /JIT wasn't off/);
  rejects(benchShapeProblems('c', cost(1.9, { hostPid: 1 })), /aren't two processes/);
  holds(benchmarkTreeProblems('c', grid()));
  assert.equal(flatten(grid()).length, 443);
  const short = grid(); short.children.pop();
  rejects(benchmarkTreeProblems('c', short), /441 nodes, not 443/);
  const wrong = grid(); wrong.children[3].children[2].children[0].text = 'other';
  rejects(benchmarkTreeProblems('c', wrong), /cell 3:2/);
  const lump = { kind: 'v', children: Array.from({ length: 442 }, () => ({ kind: 'd', children: [] })) };
  rejects(benchmarkTreeProblems('c', lump), /cell 0:0/);
});

test('the decision says what the runs say, in the Decided row', () => {
  const fits = { cost: cost(1.9), decision: { text: TEXT('1.90', '.') } };
  holds(decisionProblems(fits, designFor(fits.decision.text)));
  rejects(decisionProblems(fits, '# D\n'), /no Decided row/);
  rejects(decisionProblems(fits, designFor('something else')), /doesn't hold/);
  rejects(decisionProblems({ ...fits, decision: { text: TEXT('0.90', '.') } }, designFor(TEXT('0.90', '.'))), /measured 1\.90 ms/);
  rejects(decisionProblems({ ...fits, decision: { text: TEXT('1.90', ' and doesn\'t fit it.') } }, designFor(TEXT('1.90', ' and doesn\'t fit it.'))), /decision says they don't/);
  rejects(decisionProblems({ ...fits, decision: { text: 'It costs 1.90 ms with the JIT off against the 4 ms budget.' } }, designFor('It costs 1.90 ms with the JIT off against the 4 ms budget.')), /443-node/);
  rejects(decisionProblems({ ...fits, decision: { text: 'On 443 nodes it costs 1.90 ms against the 4 ms budget.' } }, designFor('On 443 nodes it costs 1.90 ms against the 4 ms budget.')), /JIT was off/);
  const over = { cost: cost(6.2), decision: { text: TEXT('6.20', '.') } };
  rejects(decisionProblems(over, designFor(over.decision.text)), /doesn't say it doesn't fit/);
  const honest = { cost: cost(6.2), decision: { text: TEXT('6.20', ', and it doesn\'t fit.') } };
  holds(decisionProblems(honest, designFor(honest.decision.text)));
  rejects(decisionProblems({ cost: cost(1.9), decision: {} }, ''), /text is missing/);
});

test('the record\'s commands: a release build, two binaries, a control', () => {
  const right = { build: ['cargo', 'build', '--release', '--locked'], check: ['{app}', 'panel-check'], run: ['{host}', 'run'], bench: ['{app}', 'panel-bench'], host: { bin: 'h' }, app: { bin: 'a' }, jit: { switch: 'crates/h/src/main.rs', control: ['cargo', 'test'] } };
  holds(commandProblems(right));
  rejects(commandProblems({ ...right, build: ['cargo', 'build'] }), /--release/);
  rejects(commandProblems({ ...right, check: ['sh', '-c', 'echo'] }), /check/);
  rejects(commandProblems({ ...right, host: { bin: 'a' } }), /one binary/);
  rejects(commandProblems({ ...right, jit: { switch: 'x' } }), /jit.control/);
  rejects(machineProblems(null), /neither reference/);
});
