// AC3 #1457: a frame of the shell does no file-system call, counted on the reference Mac. A planted exists() in render
// fails, naming the line. The count is the preflight's (FS_CALLS_PER_FRAME); the planted twins judge the lint statically.
import { describe, expect, it } from 'vitest';
import { copyApp, inconclusive, lint, plantIn, renderLints, REPO, twin } from './helpers.ts';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const RENDER = /^\s*fn render\b/;
/** The lints of the lint lane that name a render's file-system call at its line. */
async function names(root: string, line: number, file: string): Promise<boolean> {
  return (await renderLints()).some((s) => { const r = lint(s, root); return r.code === 1 && new RegExp(`^FAIL .*crates/deep-app/src/${file}:${line}\\b`, 'm').test(r.out); });
}

describe('#1457 AC3 a frame does no file-system call', () => {
  it('the preflight counted 0 file-system calls in a frame of the shell on the reference Mac (FS_CALLS_PER_FRAME)', () => {
    const v = process.env.FS_CALLS_PER_FRAME;
    if (v === undefined || v === '' || !Number.isFinite(Number(v))) inconclusive('FS_CALLS_PER_FRAME is not supplied by the local preflight');
    expect(Number(v)).toBe(0);
  });

  for (const [name, plant] of [['exists()', 'render-exists.rs.txt'], ['fs::read_to_string', 'render-read.rs.txt']] as const) {
    it(`a planted ${name} in the shell's render fails the lint, naming its file and line`, async () => {
      const root = copyApp();
      const line = plantIn(root, 'views.rs', RENDER, twin(plant));
      expect(await names(root, line, 'views.rs'), `a --root lint of the lint lane fails views.rs:${line}`).toBe(true);
    });
  }

  it('the app as it stands, and a render reading its own view state, pass', async () => {
    const root = copyApp();
    plantIn(root, 'views.rs', RENDER, twin('render-own-state.rs.txt'));
    for (const s of await renderLints()) expect(lint(s, root).code, s).toBe(0);
  });

  it('setup::count reads no disk: its source holds no file-system call', () => {
    expect(existsSync(join(REPO, 'crates/deep-app/src/setup.rs'))).toBe(true);
    const src = readFileSync(join(REPO, 'crates/deep-app/src/setup.rs'), 'utf8') as string;
    const body = /pub fn count\(\)[^{]*\{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
    expect(body.length, 'setup.rs has pub fn count()').toBeGreaterThan(0);
    expect(body).not.toMatch(/\.exists\(\)|\bfs::|\.is_file\(\)|\.is_dir\(\)|read_to_string|metadata\(/);
  });
});
