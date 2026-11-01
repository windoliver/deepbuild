// Shared by the #358 acceptance tests: reads the panel host spike's record (docs/spikes/358/record.json) and
// recomputes from its raw data what a test can recompute instead of taking the spike's word: which nodes of an
// element tree leave the panel or touch the card, what a PNG holds, the cost verdict from raw update times
// against 4 ms, the 443 nodes from the tree, whether the JIT ran from the runtime's counters and the kernel's
// times, and the entitlements from codesign's own output. Each check returns a list of problems; an empty
// list means it holds. Nothing here builds or runs the spike: run.mjs does.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const RECORD = 'docs/spikes/358/record.json';
export const DESIGN = 'docs/technical-design.md';
export const DECISION_ROW = '| Where agent-built panels run |';

// Criterion IDs, by the rule in tests/acceptance/48/README.md.
export const RENDER = '#358.bdd2af21';
export const JIT = '#358.fc68d243';
export const COST = '#358.b02d1647';

export const BUDGET_MS = 4; // update_budget: ms ≤ 4
export const NODES = 443;
export const ROWS = 40; // gpui-shell's benchmark: 40 rows × 5 cells
export const COLUMNS = 5;
export const RUNS = 5;
export const UPDATES = 200; // gpui-shell's ACCEPTANCE_ITERATIONS, read as P99 by its benchmark
export const WARMUP = 64; // gpui-shell's JIT_WARMUP_RENDERS
export const WINDOW = { size: [1512, 982], scale: 2 };
// Entitlements that let a process write and run code, any of which is allow-jit by another name.
export const JIT_ENTITLEMENTS = ['com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory', 'com.apple.security.cs.disable-executable-page-protection'];
export const COMPUTE_ANSWER = 'layout:165580141'; // what gpui-shell's own benchmark asserts its numeric kernel draws

export const REFERENCES = [
  { name: 'Mac15,7 (M3 Pro, 36 GB)', model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30 },
  { name: 'Mac15,12 (M3, 16 GB)', model: 'Mac15,12', chip: 'Apple M3', memoryBytes: 16 * 2 ** 30 },
];
const CONDITIONS = { power: 'ac', lowPowerMode: false, thermalState: 'nominal' };

const list = (value) => (Array.isArray(value) ? value : []);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const squash = (text) => String(text).replace(/\s+/g, ' ').trim();

export function loadRecord(path = join(root, RECORD)) {
  if (!existsSync(path)) assert.fail(`no spike record at ${RECORD}: the spike hasn't been recorded`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function machineProblems(machine) {
  const problems = [];
  if (!REFERENCES.some((each) => ['model', 'chip', 'memoryBytes'].every((key) => machine?.[key] === each[key]))) problems.push(`the machine ${JSON.stringify(machine?.model ?? null)} is neither reference Mac: the cost is INCONCLUSIVE`);
  for (const [key, value] of Object.entries(CONDITIONS)) if (machine?.[key] !== value) problems.push(`machine.${key} is ${JSON.stringify(machine?.[key] ?? null)}, not ${JSON.stringify(value)}: the cost is INCONCLUSIVE`);
  return problems;
}

// ------------------------------------------------------------------ element trees and rectangles

// A node is {kind, text?, bounds?: [x, y, w, h] in window points, children}; a string child is a node of its own,
// as gpui-shell's snapshot counts it.
export function flatten(tree) {
  const nodes = [];
  (function walk(node) {
    if (!isObject(node)) return;
    nodes.push(node);
    list(node.children).forEach(walk);
  })(tree);
  return nodes;
}
const isRect = (rect) => Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite) && rect[2] >= 0 && rect[3] >= 0;
const EPSILON = 0.5; // layout rounds to device pixels at scale 2
export const inside = ([x, y, w, h], [ax, ay, aw, ah]) => x >= ax - EPSILON && y >= ay - EPSILON && x + w <= ax + aw + EPSILON && y + h <= ay + ah + EPSILON;
export const intersects = ([x, y, w, h], [ax, ay, aw, ah]) => x < ax + aw - EPSILON && ax < x + w - EPSILON && y < ay + ah - EPSILON && ay < y + h - EPSILON;

// What the check must find, worked out from the laid-out trees: each drawn node beyond the panel or on the card.
export function escapes(trees, area, card) {
  const found = [];
  list(trees).forEach((tree, update) => {
    for (const node of flatten(tree)) {
      if (!isRect(node.bounds) || node.bounds[2] === 0 || node.bounds[3] === 0) continue;
      if (!inside(node.bounds, area)) found.push({ kind: 'outside_panel', update, bounds: node.bounds });
      if (card && intersects(node.bounds, card)) found.push({ kind: 'over_card', update, bounds: node.bounds });
    }
  });
  return found;
}

const sameRect = (a, b) => isRect(a) && isRect(b) && a.every((value, index) => Math.abs(value - b[index]) <= EPSILON);

/**
 * The headless render check's answer on one panel. `want` is the case: {pass, marker, area, card, question,
 * updates, kinds (the violation kinds it must name), firstUpdate (the first update that escapes)}.
 * `run` is {status, output}.
 */
export function checkProblems(id, want, { status, output }) {
  const problems = [];
  const say = (text) => problems.push(`${id}: ${text}`);
  if (status !== (want.pass ? 0 : 1)) say(`the check exited ${status}, not ${want.pass ? 0 : 1}`);
  if (!isObject(output)) { say('it wrote no JSON output'); return problems; }
  if (output.result !== (want.pass ? 'pass' : 'fail')) say(`result is ${JSON.stringify(output.result)}`);
  if (output.origin !== 'agent_built') say(`origin is ${JSON.stringify(output.origin)}, not agent_built`);
  if (output.runtime !== 'panel_host') say(`runtime is ${JSON.stringify(output.runtime)}, not panel_host`);
  if (!Number.isInteger(output.hostPid) || !Number.isInteger(output.appPid) || output.hostPid === output.appPid) say(`hostPid ${output.hostPid} and appPid ${output.appPid} aren't two processes`);
  const trees = list(output.trees);
  if (trees.length !== want.updates) say(`${trees.length} element trees, one per invalidation of ${want.updates}`);
  const texts = trees.map((tree) => flatten(tree).map((node) => node.text));
  if (!trees.length || !texts.every((each) => each.includes(want.marker))) say(`the panel's computed text ${want.marker} isn't in every tree: its script didn't run`);
  if (want.card && !String(output.card?.question ?? '').includes(want.question)) say(`the question card isn't up: output.card.question is ${JSON.stringify(output.card?.question ?? null)}`);
  const found = escapes(trees, want.area, want.card);
  const violations = list(output.violations);
  if (want.pass) {
    if (found.length) say(`a panel in bounds drew beyond them: ${JSON.stringify(found[0])}`);
    if (violations.length) say(`an in-bounds panel was refused: ${JSON.stringify(violations[0])}`);
    return problems;
  }
  if (!found.length) say(`the trees lay out inside the panel and off the card, so no refusal is proven`);
  for (const kind of want.kinds) {
    if (!found.some((each) => each.kind === kind)) say(`no node in the trees is ${kind}`);
    if (!violations.some((each) => each.kind === kind)) say(`the check doesn't name ${kind}`);
  }
  for (const violation of violations) if (!found.some((each) => each.kind === violation.kind && sameRect(each.bounds, violation.bounds))) say(`violation ${JSON.stringify(violation)} matches no node the trees place there`);
  if (want.firstUpdate !== undefined) {
    const first = Math.min(...found.map((each) => each.update));
    if (first !== want.firstUpdate) say(`the first escape is at update ${first}, not ${want.firstUpdate}`);
    if (!violations.some((each) => each.update === want.firstUpdate)) say(`no violation names update ${want.firstUpdate}`);
  }
  return problems;
}

// ------------------------------------------------------------------ PNG

export function decodePng(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(bytes.length > 33 && bytes.subarray(0, 8).equals(signature), 'not a PNG');
  let at = 8, width, height, depth, type, interlace;
  const data = [];
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at), name = bytes.subarray(at + 4, at + 8).toString('latin1'), body = bytes.subarray(at + 8, at + 8 + length);
    if (name === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    if (name === 'IDAT') data.push(body);
    at += 12 + length;
  }
  assert.ok(depth === 8 && (type === 6 || type === 2) && interlace === 0, `unsupported PNG: depth ${depth}, type ${type}, interlace ${interlace}`);
  const channels = type === 6 ? 4 : 3, raw = inflateSync(Buffer.concat(data)), stride = width * channels, pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0, b = y ? pixels[(y - 1) * stride + x] : 0, c = x >= channels && y ? pixels[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      pixels[y * stride + x] = (raw[line + x] + predictor) & 255;
    }
  }
  return { width, height, channels, pixels };
}
const hexRgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const TOLERANCE = 6;

// Pixels of one exact color, by device pixel, counted inside and beyond a rectangle given in points.
export function colorCounts(png, color, [x, y, w, h], scale) {
  const [r, g, b] = hexRgb(color);
  let within = 0, beyond = 0;
  for (let py = 0; py < png.height; py++) for (let px = 0; px < png.width; px++) {
    const at = (py * png.width + px) * png.channels;
    if (Math.abs(png.pixels[at] - r) > TOLERANCE || Math.abs(png.pixels[at + 1] - g) > TOLERANCE || Math.abs(png.pixels[at + 2] - b) > TOLERANCE) continue;
    if (px >= x * scale && px < (x + w) * scale && py >= y * scale && py < (y + h) * scale) within++; else beyond++;
  }
  return { within, beyond };
}

// The render's pixels: the window's size; the panel's fill where the panel is when it passed; nothing an escaping
// panel chose beyond its area; and a card that is actually drawn, not one flat color.
export function pixelProblems(id, want, png) {
  const problems = [];
  const [w, h] = WINDOW.size.map((points) => points * WINDOW.scale);
  if (png.width !== w || png.height !== h) return [`${id}: the render is ${png.width} × ${png.height}, not ${w} × ${h}`];
  if (want.pass) {
    const fill = colorCounts(png, want.fill, want.area, WINDOW.scale);
    const areaPixels = want.area[2] * want.area[3] * WINDOW.scale ** 2;
    if (fill.within < areaPixels / 2) problems.push(`${id}: only ${fill.within} of ${areaPixels} panel pixels hold the panel's fill: the panel wasn't drawn where it belongs`);
    if (fill.beyond) problems.push(`${id}: ${fill.beyond} pixels of the panel's fill lie beyond its area`);
  } else {
    const drawn = colorCounts(png, want.escape, want.area, WINDOW.scale);
    if (drawn.beyond) problems.push(`${id}: ${drawn.beyond} pixels of what the refused panel drew lie beyond its area or on the card`);
  }
  if (want.card) {
    const [x, y, cw, ch] = want.card.map((value) => value * WINDOW.scale);
    const colors = new Set();
    for (let py = y; py < y + ch; py += 3) for (let px = x; px < x + cw; px += 3) {
      const at = (py * png.width + px) * png.channels;
      colors.add(png.pixels.readUIntBE(at, 3));
    }
    if (colors.size < 2) problems.push(`${id}: the question card's area is one flat color: no card was drawn`);
  }
  return problems;
}

// ------------------------------------------------------------------ the JIT

// `shipping` and `control` each come from running gpui-shell's numeric kernel: {jit: {nativeEnabled, installed,
// nativeEntries}, renderNs: [...], tree}. The control is the same host code with the switch flipped.
export function jitProblems(shipping, control) {
  const problems = [];
  const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];
  for (const [name, run] of [['the shipping host', shipping], ['the control', control]]) {
    if (!flatten(run?.tree).some((node) => node.text === COMPUTE_ANSWER)) problems.push(`${name} didn't draw the kernel's answer ${COMPUTE_ANSWER}`);
    if (list(run?.renderNs).length < 1000) problems.push(`${name} rendered ${list(run?.renderNs).length} times, not the 1,000 gpui-shell's benchmark allows to tier up`);
  }
  if (problems.length) return problems;
  if (shipping.jit?.nativeEnabled !== false) problems.push(`the shipping host's runtime has the JIT enabled: nativeEnabled is ${JSON.stringify(shipping.jit?.nativeEnabled)}`);
  if (shipping.jit?.installed !== 0 || shipping.jit?.nativeEntries !== 0) problems.push(`the shipping host ran native code: installed ${shipping.jit?.installed}, nativeEntries ${shipping.jit?.nativeEntries}`);
  if (control.jit?.nativeEnabled !== true || !(control.jit?.nativeEntries > 0)) problems.push(`the control never entered native code, so the counters and the switch prove nothing: ${JSON.stringify(control.jit)}`);
  const tail = (run) => median(run.renderNs.slice(-100));
  if (tail(shipping) < tail(control) * 1.2) problems.push(`the shipping host's kernel takes ${tail(shipping)} ns a render, not slower than the JIT's ${tail(control)} ns: it reads as compiled`);
  const early = median(shipping.renderNs.slice(100, 200));
  if (tail(shipping) < early * 0.7) problems.push(`the shipping host's kernel sped up from ${early} ns to ${tail(shipping)} ns as it warmed: it tiered up`);
  return problems;
}

// What the build says of a target, from cargo's own compiler-artifact message: a debug build stays on the
// interpreter by itself (gpui-shell's shell_jit_config), so a debug host proves nothing.
export function artifactFor(messages, target) {
  return messages.find((message) => message.reason === 'compiler-artifact' && message.target?.name === target && message.target?.kind?.includes('bin'));
}
export function releaseProblems(name, artifact) {
  if (!artifact) return [`cargo built no binary ${name}`];
  const problems = [];
  if (artifact.profile?.debug_assertions !== false) problems.push(`${name} was built with debug assertions, where gpui-shell's JIT is off anyway: it proves nothing`);
  if (!nonEmpty(artifact.executable)) problems.push(`cargo reports no executable for ${name}`);
  return problems;
}

// ------------------------------------------------------------------ entitlements

// codesign -d --entitlements - --xml <binary> (stdout), and codesign -d --verbose=4 <binary> (stderr).
export function signatureProblems(name, { entitlements, details, verified }) {
  const problems = [];
  for (const key of JIT_ENTITLEMENTS) if (String(entitlements).includes(key)) problems.push(`${name} is signed with ${key}`);
  if (!/flags=0x[0-9a-f]*\([^)]*\bruntime\b[^)]*\)/.test(String(details))) problems.push(`${name} isn't signed with the hardened runtime, where allow-jit would mean nothing: ${String(details).match(/flags=\S+/)?.[0] ?? 'no flags'}`);
  if (verified !== true) problems.push(`${name}'s signature doesn't verify`);
  return problems;
}

// Every tracked entitlements file and property list holds none of them.
export function entitlementFileProblems(repo = root) {
  const files = spawnSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).stdout.split('\n').filter((file) => /\.(entitlements|plist)$/.test(file));
  return files.flatMap((file) => JIT_ENTITLEMENTS.filter((key) => readFileSync(join(repo, file), 'utf8').includes(key)).map((key) => `${file} carries ${key}`));
}

export function signCommandProblems(record) {
  const command = list(record?.sign?.command);
  const problems = [];
  if (!command.includes('{binary}')) problems.push('sign.command must name {binary}, the file to sign');
  if (command[0] !== 'codesign' && !nonEmpty(record?.sign?.script)) problems.push('sign.command is neither codesign nor a script record.sign.script names');
  return problems;
}

// ------------------------------------------------------------------ the cost

export function p99(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.99) - 1];
}

/** The verdict from raw runs: the worst run's 99th-percentile update, in ms, against the 4 ms. */
export function verdict(runs) {
  const worstP99Ms = Math.max(...list(runs).map((run) => p99(list(run.totalNs)) / 1e6));
  return { worstP99Ms, fits: worstP99Ms <= BUDGET_MS };
}

// One bench output: {runs: [{warmup, scriptNs: [], ipcNs: [], totalNs: []}], jit, hostPid, appPid, tree}.
export function benchShapeProblems(at, bench, { runs = RUNS, updates = UPDATES } = {}) {
  const problems = [];
  const say = (text) => problems.push(`${at}: ${text}`);
  if (!isObject(bench)) return [`${at}: no bench output`];
  if (list(bench.runs).length < runs) say(`${list(bench.runs).length} runs, not ${runs}`);
  list(bench.runs).forEach((run, index) => {
    const { scriptNs, ipcNs, totalNs } = run;
    if (!(run.warmup >= WARMUP)) say(`run ${index} warmed up ${run.warmup} renders, not ${WARMUP}`);
    if (list(totalNs).length < updates) say(`run ${index} has ${list(totalNs).length} updates, not ${updates}`);
    if (list(scriptNs).length !== list(totalNs).length || list(ipcNs).length !== list(totalNs).length) say(`run ${index}'s script, IPC and total times aren't one per update`);
    const flawed = list(totalNs).findIndex((total, at2) => !(scriptNs?.[at2] > 0) || !(ipcNs?.[at2] > 0) || !(total >= scriptNs[at2] + ipcNs[at2]));
    if (flawed >= 0) say(`run ${index} update ${flawed}: total ${totalNs[flawed]} ns isn't script ${scriptNs?.[flawed]} ns + IPC ${ipcNs?.[flawed]} ns or more, each above zero: the update didn't cross a process`);
  });
  if (bench.jit?.nativeEnabled !== false || bench.jit?.nativeEntries !== 0) say(`the JIT wasn't off: ${JSON.stringify(bench.jit ?? null)}`);
  if (!Number.isInteger(bench.hostPid) || !Number.isInteger(bench.appPid) || bench.hostPid === bench.appPid) say(`hostPid ${bench.hostPid} and appPid ${bench.appPid} aren't two processes`);
  return problems;
}

// The tree really is gpui-shell's 40 × 5 grid of 443 nodes: every cell's text, the button's, and the count.
export function benchmarkTreeProblems(at, tree) {
  const problems = [];
  const nodes = flatten(tree);
  if (nodes.length !== NODES) problems.push(`${at}: the tree has ${nodes.length} nodes, not ${NODES}`);
  const texts = new Set(nodes.map((node) => node.text));
  for (let row = 0; row < ROWS; row++) for (let column = 0; column < COLUMNS; column++) if (!texts.has(`${row}:${column}`)) { problems.push(`${at}: the cell ${row}:${column} isn't in the tree: it isn't gpui-shell's benchmark`); return problems; }
  if (!texts.has('Refresh')) problems.push(`${at}: the Refresh button isn't in the tree`);
  return problems;
}

// The record's cost and decision, recomputed. Whatever the runs say goes: a decision that doesn't fit is valid
// when it says so (the Decided row's "The measured cost doesn't fit the budget").
export function costProblems(record) {
  const problems = [...machineProblems(record?.machine)];
  const cost = record?.cost;
  if (!isObject(cost)) return [...problems, 'record.cost is missing'];
  problems.push(...benchShapeProblems('record.cost', cost), ...benchmarkTreeProblems('record.cost', cost.tree));
  if (problems.length) return problems;
  const { worstP99Ms, fits } = verdict(cost.runs);
  if (cost.worstP99Ms === undefined || Math.abs(cost.worstP99Ms - worstP99Ms) > 0.005) problems.push(`record.cost.worstP99Ms is ${cost.worstP99Ms}, but the runs give ${worstP99Ms.toFixed(3)}`);
  if (cost.fits !== fits) problems.push(`record.cost.fits is ${cost.fits}, but the runs' worst P99 of ${worstP99Ms.toFixed(3)} ms against ${BUDGET_MS} ms gives ${fits}`);
  return problems;
}

export function decisionProblems(record, design) {
  const problems = [];
  const text = squash(record?.decision?.text ?? '');
  if (!text) return ['record.decision.text is missing'];
  const { worstP99Ms, fits } = verdict(record?.cost?.runs ?? []);
  if (!text.includes('443')) problems.push("the decision doesn't name the 443-node benchmark");
  if (!/\bJIT\b/.test(text)) problems.push("the decision doesn't say the JIT was off");
  if (!/\b4 ms\b/.test(text)) problems.push("the decision doesn't name the 4 ms budget");
  const costs = [...text.matchAll(/(\d+(?:\.\d+)?) ms\b/g)].map((match) => Number(match[1]));
  if (!costs.some((value) => Math.abs(value - worstP99Ms) <= 0.05)) problems.push(`the decision doesn't state the measured ${worstP99Ms.toFixed(2)} ms`);
  const saysMiss = /\b(?:doesn't|does not) fit\b/i.test(text);
  if (fits && saysMiss) problems.push('the runs fit the budget, but the decision says they don\'t');
  if (!fits && !saysMiss) problems.push(`the runs' ${worstP99Ms.toFixed(2)} ms is over 4 ms, and the decision doesn't say it doesn't fit`);
  const row = String(design).split('\n').find((line) => line.startsWith(DECISION_ROW));
  if (!row) problems.push(`the design has no Decided row ${DECISION_ROW}`);
  else if (!squash(row).includes(text)) problems.push(`the Decided row ${DECISION_ROW} doesn't hold the decision's text`);
  return problems;
}

// ------------------------------------------------------------------ the record's commands

export function commandProblems(record) {
  const problems = [];
  const build = list(record?.build);
  if (build[0] !== 'cargo' || build[1] !== 'build' || !build.includes('--release')) problems.push(`build ${JSON.stringify(record?.build)} isn't a cargo build --release`);
  for (const [name, command] of [['check', record?.check], ['run', record?.run], ['bench', record?.bench]]) if (!Array.isArray(command) || !/\{(app|host)\}/.test(String(command[0]))) problems.push(`${name} ${JSON.stringify(command)} doesn't start at {app} or {host}`);
  if (!nonEmpty(record?.host?.bin) || !nonEmpty(record?.app?.bin)) problems.push('host.bin and app.bin must name the binaries');
  if (record?.host?.bin === record?.app?.bin) problems.push(`the host and the app are one binary, ${record?.host?.bin}: a process of the app's own program`);
  if (!Array.isArray(record?.jit?.control)) problems.push('jit.control must name the command that runs the kernel with the switch flipped');
  if (!nonEmpty(record?.jit?.switch)) problems.push('jit.switch must say where the switch is');
  return problems;
}
