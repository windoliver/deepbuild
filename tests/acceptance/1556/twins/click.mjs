#!/usr/bin/env node
// Planted wrong programs (and one right one) for #1556 (README: Wrong programs): each stands in for
// `deep-replica --first-screen --click "Set up" --out <dir> ...`. It runs `deep setup` from PATH, the planted `deep`, as
// the app's Set up does, and writes `<dir>/frames.jsonl`, one {"ms", "tree"} line per frame it "draws" after the click,
// ms on the wall clock from the click. Written models, not the app: they show the judges reject what they must.
//   right            setup off the UI thread: a frame every 16 ms reading "Setting up…", then the one line or the error
//   blocking         the base's logic: runs deep setup blocking, draws nothing until it ends, then the outcome
//   late             as right, but its first frame comes 150 ms after the click
//   no-working       frames on time, but they still show the Set up button, nothing saying it's working
//   draws-then-blocks  one "Setting up…" frame at once, then deep setup blocking, then the outcome
//   early-line       shows the one line at once, before setup ends
//   drops-error      as right, but a failing setup shows "Set up failed." without deep's line
//   error-two-lines  as right, but the error is shown over two lines in one node

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SET_UP_LINE = "DeepBuild added its hooks in watch-only mode, so no stop is held and no verdict blocks until you approve a repo's checks, and started the hub at login; deep setup --undo removes it all.";
const [mode, ...args] = process.argv.slice(2);
const out = args[args.indexOf('--out') + 1];
const t0 = performance.now();
const frames = [];
const node = (role, name) => ({ role, name, value: null, bounds: [0, 0, 100, 20], children: [] });
const tree = (children) => ({ role: 'window', name: 'DeepBuild', value: null, bounds: [0, 0, 1512, 982], children: [node('heading', 'Home'), ...children] });
const draw = (children) => frames.push({ ms: Math.round(performance.now() - t0), tree: tree(children) });
const working = () => [node('progressindicator', 'Setting up…')];
const button = () => [node('text', 'Not set up yet'), node('button', 'Set up')];
const said = (code, stderr) => {
  if (code === 0) return [node('text', SET_UP_LINE)];
  if (mode === 'drops-error') return [node('text', 'Set up failed.')];
  if (mode === 'error-two-lines') return [node('text', `deep setup failed (exit status: ${code}):\n${stderr.trim()}`)];
  return [node('text', `deep setup failed (exit status: ${code}): ${stderr.trim()}`)];
};
const finish = () => {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'frames.jsonl'), frames.map((f) => JSON.stringify(f)).join('\n') + '\n');
  process.exit(0);
};
const block = (ms) => { const until = performance.now() + ms; while (performance.now() < until) { /* the UI thread held */ } };

if (mode === 'blocking' || mode === 'draws-then-blocks') {
  if (mode === 'draws-then-blocks') draw(working());
  const r = spawnSync('deep', ['setup'], { encoding: 'utf8' });
  draw(said(r.status, r.stderr));
  finish();
} else {
  if (mode === 'late') block(150);
  let stderr = '';
  let done = null;
  const child = spawn('deep', ['setup'], { stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
  child.on('close', (code) => (done = code));
  const tick = () => {
    if (done !== null) {
      draw(said(done, stderr));
      return finish();
    }
    if (mode === 'early-line') draw(said(0, ''));
    else draw(mode === 'no-working' ? button() : working());
    setTimeout(tick, 16);
  };
  tick();
}
