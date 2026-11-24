// `deep-show live`'s window read from outside its process while nobody can see it (#3236, criterion 8, whose blind test
// leaves the window in front): its tree and its announcements come from draws, and no display asks for a frame of a
// covered or minimized window. The client minimizes the window as soon as it lists, so everything read is a hidden
// window's. BLOCKED, never a pass, off macOS or where AppKit can't be read; it opens a real window for about 45 s.
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { DOC, DRAWN, SCATTER, scatterDoc } from './acceptance/3236/fixtures.ts';
import { REPO, Script, TIMEOUT, binOf, blocked, nodeOf, prebuild, presented, runShow, scenario, seenOf, useTemp } from './acceptance/3236/helpers.ts';

prebuild();
const temp = useTemp();
/** The walk's eleven announcements end 17 s after the window opens; the rest is a loaded machine's. */
const LISTEN_S = 35;

interface Gate { ax: boolean; locked: boolean; asleep: boolean }
interface Read { window: boolean; minimized: boolean; elements: { identifier: string; value: string }[]; heard: string[] }

it('a live window nobody can see holds the replica\'s value and says the replica\'s announcements', async () => {
  if (process.platform !== 'darwin') blocked(`the live window is read through AppKit, on macOS; this is ${process.platform}`);
  const client = join(temp(), 'hidden');
  const made = spawnSync('swiftc', ['-O', '-o', client, join(REPO, 'tests', 'live-window-hidden.swift')], { encoding: 'utf8' });
  if (made.status !== 0) blocked(`the AppKit client didn't build: ${made.error?.message ?? made.stderr.slice(-600)}`);
  const readable = (when: string): void => {
    const gate = JSON.parse(spawnSync(client, ['gate'], { encoding: 'utf8' }).stdout) as Gate;
    if (!gate.ax) blocked('this process may not read other processes\' accessibility (AXIsProcessTrusted is false)');
    if (gate.locked || gate.asleep) blocked(`${when}, the screen is ${gate.locked ? 'locked' : 'asleep'}, and AppKit answers every element of every window as its application`);
  };
  readable('before the window opens');

  const D = DOC(8);
  const s = new Script();
  s.present(D, scatterDoc(D));
  s.scope();
  s.key('Tab');
  for (const _ of DRAWN) s.key('ArrowRight');
  const see = s.see();
  const replies = runShow(binOf(), scenario(temp(), [D], s.calls), 'the replica\'s walk');
  presented(replies[0]!, 'the fixture scatter');
  const replica = seenOf(replies[see]!, 'the replica\'s see');
  const said = replica.announcements.map((a) => a.text);
  expect(said.length, 'the replica says each landing').toBe(DRAWN.length);

  const live = spawn(binOf(), ['live'], { cwd: REPO, stdio: ['pipe', 'pipe', 'ignore'] });
  try {
    live.stdin.end(`${JSON.stringify(scenario(temp(), [D], s.calls.slice(0, see)))}\n`);
    const line = await new Promise<string>((done) => {
      let out = '';
      live.stdout.on('data', (d: Buffer) => { out += d.toString(); if (out.includes('\n')) done(out); });
      live.on('exit', () => done(out));
    });
    expect(JSON.parse(line).ok, `deep-show live opens its window: ${line.slice(0, 300)}`).toBe(true);
    const watch = spawnSync(client, ['watch', String(live.pid), String(LISTEN_S)], { encoding: 'utf8', timeout: (LISTEN_S + 120) * 1000 });
    readable('after the read');
    const read = JSON.parse(watch.stdout) as Read;
    if (!read.window) blocked('AppKit lists no window of deep-show live within 30 s');
    if (!read.minimized) blocked('the window didn\'t stay minimized, so it wasn\'t hidden');
    expect({ value: read.elements.find((e) => e.identifier === SCATTER)?.value ?? null, heard: read.heard }, 'the hidden window against the replica')
      .toEqual({ value: nodeOf(replica, SCATTER)?.['value'], heard: said });
  } finally {
    live.kill('SIGKILL');
  }
}, TIMEOUT);
