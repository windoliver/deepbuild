// Isolated process hosting the real Canvas. No uncaughtException/error handler hides a crash.
import cp from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
const mode = process.argv[2];
const spawn = cp.spawn;
const exists = fs.existsSync;
const binary = fileURLToPath(new URL('../../../packages/hub/dist/deep-show', import.meta.url));
const standin = fileURLToPath(new URL('./canvas-core-standin.mjs', import.meta.url));
const children = new Set();
// Only binary discovery/launch is substituted; Canvas's pipes, listeners and call queue are real.
fs.existsSync = (path) => path === binary || exists(path);
cp.spawn = (file, args, options) => {
  if (file !== binary) return spawn(file, args, options);
  const child = mode === 'spawn-failure'
    ? spawn(`${process.argv[3]}/does-not-exist`, args, options)
    : spawn(process.execPath, [standin], options);
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
};
syncBuiltinESMExports();
process.on('exit', () => { for (const child of children) if (child.pid) child.kill('SIGKILL'); });
const { Canvas } = await import('../../../packages/hub/dist/canvas.js');
const canvas = new Canvas(process.argv[3]);
const world = { sessions: [], record: {}, file: {}, docs: [] };
const timeout = setTimeout(() => { console.error('Canvas call never settled'); process.exit(2); }, 5000);
try {
  if (mode === 'closed-pipe') {
    const first = await canvas.call(world, { call: 'first' });
    console.log('FIRST', JSON.stringify(first.reply));
  }
  try {
    await canvas.call(world, { call: 'next' });
    console.log('RESULT granted');
  } catch (error) {
    console.log('RESULT', error.refusal?.code ?? String(error));
  }
  // Error events queued by a write must have a chance to run before survival is reported.
  await new Promise((resolve) => setTimeout(resolve, 50));
  console.log('HOST still running');
} finally {
  clearTimeout(timeout);
  canvas.close();
}
