// #1296 AC2: a recorded session in the shadowed repo, which never sends `rate_limits` (Claude Code runs the repo's own
// status line there, not DeepBuild's forwarder), shows its five-hour window as unknown, naming the file. A hub that
// shows 0% (window-unknown-as-zero), or carries over another repo's last reading (window-carried-from-other-repo),
// fails, naming the session. The repo's settings file is byte-identical before and after setup and the doctor.
//
// The world is #19's (../19/doctor/helpers.ts): its working folder is the shadowed repo, its `.claude/settings.json`
// written before `deep setup` runs there; its session starts there through DeepBuild's entries. A second repo beside it
// has a session whose status line is the forwarder setup installed, run as Claude Code runs it, with a reading. The
// windows are read from `deep status` (README, The surface under test).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { childEnv, cleanup, deep, doctor, eventually, readSettings, run, shown, startSession, world, type Home } from '../19/doctor/helpers.ts';
import { AC2 } from './helpers.ts';

afterAll(cleanup, 60_000);

const FIVE_HOUR = /\b5 ?h\b|five[- _]?hour/i;
const PERCENT = /\d+(?:\.\d+)?\s*%/;

/** The lines `deep status` shows for one session: the row naming its ID's first 8 characters, and the indented lines under it. */
function blockOf(status: string, session: string, others: readonly string[]): string[] {
  const lines = status.split('\n');
  const at = lines.findIndex((l) => l.includes(session.slice(0, 8)));
  if (at < 0) return [];
  const out = [lines[at]!];
  for (const l of lines.slice(at + 1)) {
    if (!/^ {4,}\S/.test(l) || others.some((o) => l.includes(o.slice(0, 8)))) break;
    out.push(l);
  }
  return out;
}

interface Scene { h: Home; shadowed: string; file: string; mine: string; other: string; status: string; before: Buffer; after: Buffer }

/** The world with the shadowed repo, its session, the other repo's session and its reading; then the doctor and `deep status`. */
async function scene(plant?: string): Promise<Scene> {
  let before = Buffer.alloc(0);
  let file = '';
  const w = await world({
    ...(plant ? { plant } : {}),
    before: (_settings, h) => {
      mkdirSync(join(h.work, '.claude'), { recursive: true });
      file = join(h.work, '.claude', 'settings.json');
      writeFileSync(file, `${JSON.stringify({ statusLine: { type: 'command', command: 'node .claude/statusline.mjs' } }, null, 2)}\n`);
      writeFileSync(join(h.work, '.claude', 'statusline.mjs'), "process.stdout.write('repo line\\n');\n");
      before = readFileSync(file);
    },
  });
  const h = w.h;
  const mine = w.session!.s.id;
  // Another repo, with no status line of its own: there Claude Code runs the forwarder from your user settings.
  const otherRepo = join(h.tmp, 'other');
  mkdirSync(otherRepo, { recursive: true });
  execFileSync('git', ['init', '-q', otherRepo]);
  const other = await startSession(h, otherRepo);
  const command = readSettings(h).statusLine?.command;
  if (typeof command !== 'string') throw Error(`BLOCKED: setup must install the status line forwarder in ~/.claude/settings.json: ${JSON.stringify(readSettings(h).statusLine)}`);
  const resets = Math.floor(Date.now() / 1000) + 3 * 3600;
  const input = {
    hook_event_name: 'Status', session_id: other.s.id, transcript_path: other.s.transcript, cwd: otherRepo,
    model: { id: 'claude-haiku-4-5', display_name: 'Haiku 4.5' }, workspace: { current_dir: otherRepo, project_dir: otherRepo },
    rate_limits: { five_hour: { used_percentage: 31, resets_at: resets }, seven_day: { used_percentage: 12, resets_at: resets + 4 * 86400 } },
  };
  const line = await run('/bin/sh', ['-c', command], { env: childEnv(h), cwd: otherRepo, input: JSON.stringify(input) });
  if (line.code !== 0) throw Error(`BLOCKED: the forwarder must run as Claude Code runs it: ${shown(line)}`);
  // The doctor runs in the shadowed repo too, so the file is compared after setup and the doctor.
  await doctor(h, [], { cwd: h.work });
  let status = '';
  // The forwarder's sender reaches the hub on its own; wait until the other session's row shows a reading, or 15 s.
  await eventually(async () => {
    status = (await deep(h, ['status'], { cwd: h.work })).stdout;
    return blockOf(status, other.s.id, [mine]).some((l) => FIVE_HOUR.test(l) && PERCENT.test(l));
  }, 15_000);
  return { h, shadowed: h.work, file, mine, other: other.s.id, status, before, after: readFileSync(file) };
}

/** The shadowed repo's session shows its five-hour window as unknown, naming the file; the repo's file is untouched. */
function judge(sc: Scene): void {
  const block = blockOf(sc.status, sc.mine, [sc.other]);
  const who = `AC2 session ${sc.mine} in ${sc.shadowed}`;
  if (!block.length) expect.fail(`${who} must have a row in deep status: ${JSON.stringify(sc.status.slice(0, 2500))}`);
  const five = block.filter((l) => FIVE_HOUR.test(l));
  if (!five.length) expect.fail(`${who} must show its five-hour window: ${JSON.stringify(block)}`);
  const numbered = five.filter((l) => PERCENT.test(l));
  if (numbered.length) expect.fail(`${who} has no rate_limits, yet its five-hour window shows a percentage: ${JSON.stringify(numbered)}`);
  if (!five.some((l) => /unknown/i.test(l))) expect.fail(`${who} must show its five-hour window as unknown: ${JSON.stringify(five)}`);
  if (!block.join('\n').includes('.claude/settings.json')) expect.fail(`${who} must name the file that shadows the forwarder, ${sc.file}: ${JSON.stringify(block)}`);
  const control = blockOf(sc.status, sc.other, [sc.mine]).filter((l) => FIVE_HOUR.test(l) && PERCENT.test(l));
  if (!control.length) expect.fail(`AC2 (control) session ${sc.other}, whose forwarder sent a five-hour reading of 31% used, must show it: ${JSON.stringify(sc.status.slice(0, 2500))}`);
  if (!sc.before.equals(sc.after)) expect.fail(`AC2 ${sc.file} must be byte-identical before and after setup and the doctor: ${JSON.stringify(sc.before.toString())} became ${JSON.stringify(sc.after.toString())}`);
}

describe(`${AC2} a session in the shadowed repo shows its five-hour window as unknown, naming the file; 0% or another repo's reading fails, naming the session; the repo's settings file is untouched`, () => {
  it(`${AC2} the shadowed repo's session: five-hour window unknown, no percentage, the file named; the other repo's reading shown on its own row; the file byte-identical`, async () => {
    judge(await scene());
  }, 600_000);

  it(`${AC2} (wrong program) a hub that shows the unknown window as 0% (window-unknown-as-zero) fails, naming the session`, async () => {
    const sc = await scene('window-unknown-as-zero');
    expect(() => judge(sc)).toThrow(new RegExp(`AC2 session ${sc.mine} .*shows a percentage`));
  }, 600_000);

  it(`${AC2} (wrong program) a hub that carries over another repo's last reading (window-carried-from-other-repo) fails, naming the session`, async () => {
    const sc = await scene('window-carried-from-other-repo');
    expect(() => judge(sc)).toThrow(new RegExp(`AC2 session ${sc.mine} .*shows a percentage`));
  }, 600_000);
});
