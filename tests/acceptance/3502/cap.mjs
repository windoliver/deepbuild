// Criterion 5's tools (README: The cap): #3441's tick lists, the pin's own cap read out of the vendored
// `gpui-pre` as text, and a small program built around that text that plays the lists through it and counts the
// ticks that present. The arithmetic that decides a tick is the pin's, compiled; nothing here copies it.
//
// The request-frame closure asks the clock itself (`Instant::now()`), so no window can be given ticks exactly
// 1/60 s apart. What is played is the rule the closure calls, with each tick's time handed to it:
// - from 0.3.11 (zed-industries/zed#63477), `FramePacer::should_defer(now, minimum_interval)` with
//   `FRAME_INTERVAL_TOLERANCE`, each item taken whole from `src/window.rs`, and the cap's interval as
//   `WindowOptions`' default gives it in `src/platform.rs`;
// - at 0.3.9, the closure's own test, `now.duration_since(last_frame) < min_interval`, and its thermal interval, each
//   taken as written from the closure in `src/window.rs`, set in the two statements the closure keeps them in.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { blocked, clip, read, releaseDir, REPO, tempDir, tilde, treeVersion } from './common.mjs';

const WINDOW = 'src/window.rs', PLATFORM = 'src/platform.rs';
/** The words a line of the cap's rule holds, in either shape: a carried change to such a line is a patch of ours for the cap. */
const CAP_LINE = /FramePacer|frame_pacer|should_defer|FRAME_INTERVAL_TOLERANCE|minimum_frame_interval|min_frame_interval|min_interval|frame_interval\b|last_frame_time|FrameRateLimit/;
const MARK = /DeepBuild patch/;

/** The item that starts at the first match of `opening` in `source`, through its closing brace, with the attribute and doc lines right above it. */
function item(source, opening) {
  const found = opening.exec(source);
  if (!found) return null;
  let start = found.index;
  for (;;) {
    const before = source.lastIndexOf('\n', start - 2) + 1;
    if (start > 0 && /^\s*(?:#\[|\/\/\/)/.test(source.slice(before, start))) start = before;
    else break;
  }
  let depth = 0;
  for (let at = source.indexOf('{', found.index); at >= 0 && at < source.length; at += 1) {
    if (source[at] === '{') depth += 1;
    else if (source[at] === '}' && (depth -= 1) === 0) return source.slice(start, at + 1);
  }
  return null;
}

/**
 * The cap's rule in a `gpui-pre` tree, by the text of its two files: `{shape, rust, thermal, inactive}`, `rust` the
 * program's own lines that hold the rule, or null when neither shape is there.
 */
export function ruleOf(window, platform) {
  const interval = (name) => RegExp(`\\b${name}:\\s*Some\\(\\s*(Duration::[\\w:]+\\([\\d_]+\\))\\s*\\)`).exec(platform ?? '')?.[1] ?? null;
  const inactive = interval('inactive_frame_interval');
  const tolerance = /^const FRAME_INTERVAL_TOLERANCE: Duration = [^;]+;$/m.exec(window ?? '')?.[0];
  const pacer = item(window ?? '', /^struct FramePacer\b/m), methods = item(window ?? '', /^impl FramePacer\b/m);
  if (tolerance && pacer && methods && /fn should_defer\(&mut self, now: Instant, minimum_interval: Option<Duration>\) -> bool/.test(methods)) {
    const thermal = interval('thermal_frame_interval');
    if (!thermal || !inactive) return null;
    return { shape: 'pacer', thermal, inactive, items: [tolerance, pacer, methods], rust: `${tolerance}\n\n${pacer}\n\n${methods}\n\nfn play(start: Instant, ticks: &[u64], interval: Duration) -> usize {\n    let mut frame_pacer = FramePacer::default();\n    let mut presented = 0;\n    for tick in ticks {\n        let now = start + Duration::from_nanos(*tick);\n        if frame_pacer.should_defer(now, Some(interval)) {\n            continue;\n        }\n        presented += 1;\n    }\n    presented\n}\n` };
  }
  const thermal = /Some\(\(\s*(Duration::[\w:]+\([\d_]+\))\s*,\s*FrameRateLimit::Thermal\s*\)\)/.exec(window ?? '')?.[1];
  const test = /if let Some\(last_frame\) = last_frame_time\.get\(\)\s*&&\s*([^{}]+?)\s*\{/.exec(window ?? '')?.[1];
  if (!thermal || !inactive || !test || !/last_frame_time\.set\(Some\(now\)\);/.test(window)) return null;
  return { shape: 'threshold', thermal, inactive, items: [test, thermal], rust: `fn play(start: Instant, ticks: &[u64], min_interval: Duration) -> usize {\n    let mut last_frame_time: Option<Instant> = None;\n    let mut presented = 0;\n    for tick in ticks {\n        let now = start + Duration::from_nanos(*tick);\n        if let Some(last_frame) = last_frame_time\n            && ${test}\n        {\n            continue;\n        }\n        last_frame_time = Some(now);\n        presented += 1;\n    }\n    presented\n}\n` };
}

/** The whole program: the rule, and a `main` that reads one list a line, `<thermal|inactive> <tick ns> ...`, and prints each list's count. */
export function program(rule) {
  return `// Built by tests/acceptance/3502/cap.mjs around the cap's rule as vendor/gpui-pre writes it.\n#![allow(dead_code, unused_imports)]\nuse std::io::BufRead;\nuse std::time::{Duration, Instant};\n\n${rule.rust}\nfn main() {\n    let start = Instant::now();\n    for line in std::io::stdin().lock().lines() {\n        let line = line.expect("a list");\n        let mut words = line.split_whitespace();\n        let interval = match words.next() {\n            Some("thermal") => ${rule.thermal},\n            Some("inactive") => ${rule.inactive},\n            other => panic!("no such cap: {other:?}"),\n        };\n        let ticks: Vec<u64> = words.map(|word| word.parse().expect("a tick in ns")).collect();\n        println!("{}", play(start, &ticks, interval));\n    }\n}\n`;
}

// ---------------------------------------------------------------------------------------------------
// #3441's tick lists: its criteria's (600 ticks at 60 and 120 Hz under each cap, exact and with a seeded offset of up
// to 200 µs either way, five seeds) and the longer exact runs its comment of November 25 adds.

const JITTER_NS = 200_000;
export const SEEDS = [1, 2, 3, 4, 5];
/** The lists, each `{cap, hz, ticks, jitter_us, seed}`. */
export const LISTS = [
  ...['thermal', 'inactive'].flatMap((cap) => [60, 120].flatMap((hz) => [
    { cap, hz, ticks: 600, jitter_us: 0, seed: null },
    ...SEEDS.map((seed) => ({ cap, hz, ticks: 600, jitter_us: JITTER_NS / 1000, seed })),
  ])),
  { cap: 'thermal', hz: 60, ticks: 6_000, jitter_us: 0, seed: null },
  { cap: 'thermal', hz: 60, ticks: 60_000, jitter_us: 0, seed: null },
  { cap: 'thermal', hz: 120, ticks: 60_000, jitter_us: 0, seed: null },
];
export const listName = ({ cap, hz, ticks, jitter_us: jitter, seed }) => `${cap} cap, ${hz} Hz, ${ticks} ticks ${jitter ? `each moved by up to ${jitter} µs, seed ${seed}` : `exactly 1/${hz} s apart`}`;

/** A list's tick times in whole ns from its first: tick k at k/hz s, to the nearest ns, moved by its seeded offset. */
export function ticksOf({ hz, ticks, jitter_us: jitter, seed }) {
  let state = (seed ?? 0) >>> 0;
  const next = () => { // a 32-bit generator with a fixed sequence for each seed
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 2 ** 32;
  };
  const span = jitter * 1000;
  return Array.from({ length: ticks }, (_, k) => {
    const exact = (BigInt(k) * 1_000_000_000n + BigInt(hz / 2)) / BigInt(hz);
    // The first tick stays at 0 or later: a time is counted from the list's start.
    const moved = exact + BigInt(jitter ? Math.round((next() * 2 - 1) * span) : 0);
    return moved < 0n ? 0n : moved;
  });
}

/**
 * Plays `lists` through `rule`: builds the program with rustc, the toolchain's own compiler, in a temporary folder
 * and feeds it the lists. Returns each list's count of presented ticks, in order. BLOCKED when it can't be built or run.
 */
export function play(rule, lists, edition = '2024') {
  const dir = tempDir('cap');
  const [source, bin] = [join(dir, 'cap.rs'), join(dir, 'cap')];
  writeFileSync(source, program(rule));
  const made = spawnSync('rustc', ['--edition', edition, '-O', '-o', bin, source], { cwd: REPO, encoding: 'utf8' });
  if (made.error || made.status !== 0) blocked(`the cap's rule, taken from vendor/gpui-pre as ${rule.shape}, doesn't build on its own (rustc): ${made.error?.message ?? tilde(clip(made.stderr, 3000))}`);
  const run = spawnSync(bin, [], { input: `${lists.map((list) => `${list.cap} ${ticksOf(list).join(' ')}`).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 120_000 });
  const counts = (run.stdout ?? '').split('\n').filter(Boolean).map(Number);
  if (run.error || run.status !== 0 || counts.length !== lists.length || counts.some((count) => !Number.isSafeInteger(count))) blocked(`the program around the cap's rule didn't count the lists (${run.error?.message ?? `exit ${run.status}`}): ${tilde(clip(`${run.stdout ?? ''}${run.stderr ?? ''}`, 800))}`);
  return counts;
}

/** The lines of a file that hold the cap's rule, in order. */
const capLines = (text) => (text ?? '').split('\n').filter((line) => CAP_LINE.test(line));

/**
 * "With no patch of ours for it": every line of the vendored `src/window.rs` and `src/platform.rs` that holds the
 * cap's rule is a line of the pinned release, the same ones in the same order, and none carries our mark. BLOCKED
 * when this machine holds no pinned release to hold them against.
 */
export function judgeUnpatched(root = REPO) {
  const version = treeVersion(root, 'gpui-pre');
  const release = version && releaseDir('gpui-pre', version);
  if (!release) blocked(`no pinned release gpui-pre ${version} to hold the cap's lines against: run node scripts/vendor-rebase.mjs check once with the network, or set DEEP_VENDOR_RELEASES`);
  const failures = [];
  for (const path of [WINDOW, PLATFORM]) {
    const [ours, theirs] = [capLines(read(root, `vendor/gpui-pre/${path}`)), capLines(read(release, path))];
    if (!ours.length) failures.push(`vendor/gpui-pre/${path} holds no line of the cap's rule`);
    const marked = ours.find((line) => MARK.test(line));
    if (marked) failures.push(`vendor/gpui-pre/${path} carries our mark on a line of the cap's rule: ${marked.trim()}`);
    const at = ours.findIndex((line, index) => line !== theirs[index]);
    if (at >= 0 || ours.length !== theirs.length) failures.push(`vendor/gpui-pre/${path} differs from gpui-pre ${version} in the cap's rule: ${at >= 0 ? `ours has "${ours[at].trim()}" where the release has "${(theirs[at] ?? 'nothing').trim()}"` : `ours has ${ours.length} such lines, the release ${theirs.length}`}`);
  }
  return failures;
}

/** The cap's rule in the tree at `root`, and its manifest's edition; BLOCKED when vendor/gpui-pre holds it in neither shape. */
export function treeRule(root = REPO) {
  const rule = ruleOf(read(root, `vendor/gpui-pre/${WINDOW}`), read(root, `vendor/gpui-pre/${PLATFORM}`));
  if (!rule) blocked(`vendor/gpui-pre/${WINDOW} holds the cap's rule in neither shape this suite reads: FramePacer::should_defer with FRAME_INTERVAL_TOLERANCE (the issue's name for it, from 0.3.11), or the closure's own threshold (0.3.9)`);
  return { rule, edition: /^edition = "(\d+)"/m.exec(read(root, 'vendor/gpui-pre/Cargo.toml') ?? '')?.[1] ?? '2024' };
}
