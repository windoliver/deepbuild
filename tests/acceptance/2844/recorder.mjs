// The recorder of the #2844 acceptance suite (README: How a frame is enumerated). It is test code: helpers.ts starts
// it, never a shipped program. While helpers.ts runs #2031's and #2032's test files, unchanged, this script stands in
// for the three programs those files start, so that every frame they ask for is seen where it is asked for:
//
//   recorder.mjs cargo <state> build --locked --bin <bin> [--bin <bin>]
//     in place of `cargo`, first on the inner run's PATH. Both suites build what they drive with exactly this
//     command (#467's `useBin`, #2031's `useMergeBase`) and copy it out of `$CARGO_TARGET_DIR/debug`. The binaries
//     are already built, by the same command, by the test that starts the run; this lays a stand-in for each named
//     binary where the suite will copy it from. Any other command, or another target folder, is refused (exit 101).
//   recorder.mjs call <state> <file> <head | base> <bin> <the binary's own arguments>
//     in place of `deep-gpu` or `deep-canvas-render`, the checkout's (`head`) or the merge base's (`base`). It runs
//     the real binary with the same arguments, input and folder, and hands its output, its errors and its exit on
//     untouched. Then it writes down what the call drew. For a call that draws (`deep-gpu run`, `deep-canvas-render
//     raster`) by the checkout's binary it also writes down what the merge base's binary draws for the same request,
//     without `--planted`: read from an earlier answer to that request when there is one, drawn now when there is not.
//
// A frame is `png <SHA-256 of the file's bytes>` for every file the answer names in its `out` folder (and each
// raster's `out` file), `pixel_hash <hash>` for every `pixel_hash` the answer holds, and `code <code> <path>` for
// every refusal; a run that exits other than 0, or answers no JSON, is `failed`. Nothing here judges: the test does.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';

const BINS = ['deep-gpu', 'deep-canvas-render'];
const [mode, state, ...rest] = process.argv.slice(2);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A value as JSON with every object's keys in order, so two requests that say the same hash the same. */
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : isObject(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null');
const quoted = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;

/** All of `bytes` to the file descriptor, as a blocking write. */
function write(fd, bytes) {
  for (let at = 0; at < bytes.length;) {
    try {
      at += writeSync(fd, bytes, at);
    } catch (error) {
      if (error.code === 'EPIPE') return;
      if (error.code !== 'EAGAIN') throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// cargo

function cargo(args) {
  const target = process.env.CARGO_TARGET_DIR ?? '';
  const files = `${join(state, 'files')}/`;
  const at = target.startsWith(files) ? /^(\d+)\/target(\/acceptance-2031-base\/target)?$/.exec(target.slice(files.length)) : null;
  const bins = [];
  let known = args[0] === 'build' && args[1] === '--locked' && args.length > 2;
  for (let i = 2; known && i < args.length; i += 2) {
    if (args[i] === '--bin' && BINS.includes(args[i + 1])) bins.push(args[i + 1]);
    else known = false;
  }
  if (!at || !known) {
    write(2, Buffer.from(`error: #2844's recorder stands in for cargo only for \`cargo build --locked --bin <deep-gpu | deep-canvas-render>\` into the folder its run names; got \`cargo ${args.join(' ')}\` with CARGO_TARGET_DIR=${target || '(unset)'}\n`));
    process.exit(101);
  }
  const [, file, base] = at;
  const role = base ? 'base' : 'head';
  const config = JSON.parse(readFileSync(join(state, 'config.json'), 'utf8'));
  mkdirSync(join(target, 'debug'), { recursive: true });
  for (const bin of bins) {
    writeFileSync(join(target, 'debug', bin), `#!/bin/sh\nexec ${quoted(config.node)} ${quoted(config.recorder)} call ${quoted(state)} ${file} ${role} ${bin} "$@"\n`, { mode: 0o755 });
  }
  appendFileSync(join(state, 'files', file, 'builds.log'), `${role} ${bins.join(' ')}\n`);
}

// ---------------------------------------------------------------------------------------------------
// Frames

/** What the request asks for, for a frame's name: `window2d of lit-falloff`, `film2d of shadow-drift from frame 30`. */
function asked(call, i, verb = call?.call) {
  const doc = isObject(call?.doc) ? call.doc.id : undefined;
  const t = call?.t === undefined ? '' : ` at t=${call.t}`;
  const from = call?.from === undefined ? '' : ` from frame ${call.from}`;
  return `[${i}] ${verb} of ${doc ?? 'a document with no id'}${t}${from}`;
}

/** A frame set: each frame under a name of its own. */
function frameSet() {
  const frames = {};
  const put = (name, frame) => {
    let key = name;
    for (let n = 2; key in frames; n++) key = `${name} #${n}`;
    frames[key] = frame;
  };
  return { frames, put };
}

/** Every frame an answer holds: each file of `out` it names, each `pixel_hash`, each refusal. */
function walk(value, name, path, out, put) {
  if (typeof value === 'string') {
    for (const file of out.get(value) ?? []) put(`${name}: ${path}`, `${file.slice(value.length + 1) || 'file'} ${out.hash(file)}`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => {
      const own = isObject(v) ? (typeof v.frame === 'number' ? `frame ${v.frame}` : [v.layer, v.id].find((s) => typeof s === 'string')) : undefined;
      walk(v, name, `${path}[${own ?? i}]`, out, put);
    });
  } else if (isObject(value)) {
    if (typeof value.code === 'string') put(`${name}: ${path || 'the answer'}`, `code ${value.code} ${typeof value.path === 'string' ? value.path : ''}`.trim());
    for (const [k, v] of Object.entries(value)) {
      if (k === 'pixel_hash' && typeof v === 'string') put(`${name}: ${path ? `${path}.` : ''}pixel_hash`, `pixel_hash ${v}`);
      else walk(v, name, path ? `${path}.${k}` : k, out, put);
    }
  }
}

/** The files of an `out` folder by the name before their extension, and each one's SHA-256, read once. */
function folder(dir) {
  const byStem = new Map();
  let names = [];
  try { names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name); } catch { /* no folder: no file */ }
  for (const file of names) {
    const stem = file.replace(/\.[^.]*$/, '');
    byStem.set(stem, [...(byStem.get(stem) ?? []), file]);
  }
  const hashes = new Map();
  return {
    get: (stem) => byStem.get(stem),
    hash: (file) => hashes.get(file) ?? hashes.set(file, sha256(readFileSync(join(dir, file)))).get(file),
  };
}

const exited = (run) => (run.error ? `could not run (${run.error.code ?? run.error.message})` : run.signal ? `ended by ${run.signal}` : `exit ${run.status}`);
const answers = (run) => String(run.stdout ?? '').split('\n').filter((line) => line !== '');

/** `deep-gpu run`: one scenario line `{out, calls}` in, one answer `{ok, replies}` out. */
function runFrames(scenario, run) {
  const { frames, put } = frameSet();
  const lines = answers(run);
  let answer;
  try { answer = JSON.parse(lines[0]); } catch { /* judged below */ }
  if (run.error || run.status !== 0 || lines.length !== 1 || !isObject(answer)) put('the run', `failed: ${exited(run)}, ${lines.length} answer line(s)`);
  else if (answer.ok !== true || !Array.isArray(answer.replies)) put('the run', `code ${String(answer.code)} ${typeof answer.path === 'string' ? answer.path : ''}`.trim());
  else {
    const out = folder(scenario.out);
    scenario.calls.forEach((call, i) => walk(answer.replies[i], asked(call, i), '', out, put));
    if (answer.replies.length !== scenario.calls.length) put('the run', `failed: ${answer.replies.length} replies to ${scenario.calls.length} calls`);
  }
  return frames;
}

/** `deep-canvas-render raster`: one line `{out, doc, t, ...}` in and one answer out for each picture. */
function rasterFrames(lines, run) {
  const { frames, put } = frameSet();
  const got = answers(run);
  if (run.error || run.status !== 0 || got.length !== lines.length) {
    put('the run', `failed: ${exited(run)}, ${got.length} answer line(s) to ${lines.length}`);
    return frames;
  }
  lines.forEach((line, i) => {
    const name = `${asked(line, i, 'raster')}: the picture`;
    let answer;
    try { answer = JSON.parse(got[i]); } catch { /* judged below */ }
    if (!isObject(answer)) put(name, 'failed: an answer that is not JSON');
    else if (answer.ok !== true) put(name, `code ${String(answer.code)} ${typeof answer.path === 'string' ? answer.path : ''}`.trim());
    else if (typeof line.out !== 'string' || !existsSync(line.out)) put(name, 'failed: ok, and no file at out');
    else put(name, `png ${sha256(readFileSync(line.out))}`);
  });
  return frames;
}

// ---------------------------------------------------------------------------------------------------
// A call of deep-gpu or deep-canvas-render

// The suites give a call 30 minutes; the real binary gets 25 of them, and the merge base's draw what is left of 29,
// so a binary that hangs is stopped here, by this process, before the suite stops this process.
const LIMITS = { maxBuffer: 1024 * 1024 * 1024, timeout: 1_500_000, killSignal: 'SIGKILL' };
const started = Date.now();
const left = () => Math.max(1_000, Math.min(LIMITS.timeout, 1_740_000 - (Date.now() - started)));

function call([file, role, bin, ...args]) {
  const config = JSON.parse(readFileSync(join(state, 'config.json'), 'utf8'));
  const input = readFileSync(0);
  const run = spawnSync(config.real[role][bin], args, { input, ...LIMITS });
  const ms = Date.now() - started;
  write(1, run.stdout ?? Buffer.alloc(0));
  write(2, run.stderr ?? Buffer.alloc(0));

  const sub = args[0];
  const planted = args.includes('--planted') ? (args[args.indexOf('--planted') + 1] ?? '') : null;
  const draws = (bin === 'deep-gpu' && sub === 'run') || (bin === 'deep-canvas-render' && sub === 'raster');
  const record = { role, bin, sub, planted, draws, exit: exited(run), ms };
  try {
    if (draws) Object.assign(record, drawn(config, role, bin, sub, planted, input, run));
  } catch (error) {
    record.error = String(error?.stack ?? error);
  }
  const calls = join(state, 'files', file, 'calls');
  const seq = String(readdirSync(calls).length + 1).padStart(6, '0');
  writeFileSync(join(calls, `${seq}.json`), JSON.stringify(record));

  if (run.error) {
    write(2, Buffer.from(`#2844's recorder: ${config.real[role][bin]} ${exited(run)}\n`));
    process.exit(1);
  }
  if (run.signal) process.kill(process.pid, run.signal);
  process.exit(run.status ?? 1);
}

/** What a drawing call drew, and for the checkout's binary what the merge base draws for the same request. */
function drawn(config, role, bin, sub, planted, input, run) {
  const text = input.toString('utf8');
  const isRun = bin === 'deep-gpu';
  const request = isRun ? JSON.parse(text) : text.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
  if (isRun ? !(isObject(request) && typeof request.out === 'string' && Array.isArray(request.calls)) : !request.every(isObject)) throw Error(`the recorder can't read this ${bin} ${sub} request`);
  const frames = isRun ? runFrames(request, run) : rasterFrames(request, run);
  const verbs = isRun ? request.calls.map((c) => String(c?.call)) : request.map(() => 'raster');
  // The same request, whatever folder its pictures go to.
  const digest = sha256(canonical({ bin, sub, request: isRun ? request.calls : request.map(({ out: _, ...line }) => line) }));
  const kept = join(state, 'base-frames', `${digest}.json`);
  if (role === 'base') {
    if (planted === null) writeFileSync(kept, JSON.stringify(frames));
    return { verbs, frames };
  }
  if (existsSync(kept)) return { verbs, frames, base: JSON.parse(readFileSync(kept, 'utf8')), baseMs: 0 };
  // Not asked of the merge base yet: its binary draws the request now, into a folder of its own.
  const scratch = mkdtempSync(join(state, 'scratch', 'base-'));
  try {
    const again = isRun ? { ...request, out: scratch } : request.map((line, i) => ({ ...line, out: join(scratch, `raster-${i}.png`) }));
    const lines = isRun ? `${JSON.stringify(again)}\n` : `${again.map((line) => JSON.stringify(line)).join('\n')}\n`;
    const from = Date.now();
    const base = spawnSync(config.real.base[bin], [sub], { input: lines, ...LIMITS, timeout: left() });
    const baseFrames = isRun ? runFrames(again, base) : rasterFrames(again, base);
    if (!base.error) writeFileSync(kept, JSON.stringify(baseFrames));
    return { verbs, frames, base: baseFrames, baseMs: Date.now() - from };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (mode === 'cargo' && state) cargo(rest);
else if (mode === 'call' && state && rest.length >= 3) call(rest);
else {
  write(2, Buffer.from('usage: recorder.mjs cargo <state> <cargo arguments> | recorder.mjs call <state> <file> <head | base> <bin> <arguments>\n'));
  process.exit(2);
}
