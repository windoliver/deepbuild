// AC8 #3236.b9b04201: "On the reference Mac, the live tree read through AppKit holds the node's value, and the walk's
// announcements equal the replica's. If the platform can't be read, this criterion is BLOCKED, naming where it stopped"
//
// The replica: `deep-show run` with the fixture scatter shown, Tab and Right eleven times, then `see`: the scatter
// node's value and every announcement's text, in order. The live tree: `deep-show live` (#376's live window) on the same
// calls, started by this test and stopped by its PID, read from outside its process by appkit.swift as an assistive
// client reads it: the window's elements (AXIdentifier, AXValue, AXDescription, AXTitle), and the announcements the
// window asks for (AXAnnouncementRequested), observed while the window shows each frame it lists (6 s a frame) and 15 s
// more. The element whose AXIdentifier is `scatter` holds the replica's value as its AXValue, AXDescription or AXTitle,
// the same text; the announcements' texts equal the replica's, in order.
// BLOCKED, naming where it stopped, never a pass: off macOS; off the reference Macs (scripts/benchmark.mjs); no swiftc;
// this process not trusted for Accessibility; no window AppKit lists within 30 s; a window AppKit lists with no element
// that carries an identifier (the tree can't be read). The replica's own failures fail first, as they do everywhere.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { DOC, DRAWN, SCATTER, scatterDoc } from './fixtures.ts';
import {
  AC, REPO, Script, TIMEOUT, binOf, blocked, nodeOf, none, prebuild, presented, runShow, sameText, scenario, seenOf, show, useTemp, type JsonObject,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(8);
/** How long `deep-show live` shows each frame (crates/deep-show/src/live.rs `HOLD`). */
const HOLD_S = 6;

interface AxNode { role: string | null; title: string | null; description: string | null; value: string | null; identifier: string | null; children: AxNode[] }
interface Watched { window: boolean; start: AxNode[]; end: AxNode[]; announcements: { ms: number; text: string }[] }
const flat = (nodes: AxNode[]): AxNode[] => nodes.flatMap((n) => [n, ...flat(n.children ?? [])]);

/** The suite's assistive client, compiled into `dir`; BLOCKED where this machine can't build it or isn't trusted. */
function appkit(dir: string): string {
  const bin = join(dir, 'appkit');
  const made = spawnSync('swiftc', ['-O', '-o', bin, join(REPO, 'tests', 'acceptance', '3236', 'appkit.swift')], { encoding: 'utf8' });
  if (made.error || made.status !== 0 || !existsSync(bin)) blocked(`the AppKit client didn't build: swiftc ${made.error?.message ?? made.stderr.slice(-600)}. Unblock: install Xcode's command line tools`);
  const access = spawnSync(bin, ['access'], { encoding: 'utf8' });
  let ax = false;
  try { ax = (JSON.parse(access.stdout) as { ax: boolean }).ax; } catch { /* read as false */ }
  if (!ax) blocked('this process may not read other processes\' accessibility through AppKit (AXIsProcessTrusted is false). Unblock: give the terminal running the tests Accessibility in System Settings, Privacy & Security');
  return bin;
}

/** The scatter shown, Tab and Right over its eleven drawn rows: the calls both the replica and the live window play. */
function walkCalls(): { s: Script; seen: number } {
  const s = new Script();
  s.present(D, scatterDoc(D));
  s.scope();
  s.key('Tab');
  for (const _ of DRAWN) s.key('ArrowRight');
  return { s, seen: s.see() };
}

describe(`${AC[8]} the live tree, read through AppKit on the reference Mac, holds the node's value and the walk's announcements`, () => {
  it(`${AC[8]} on the reference Mac, the live tree read through AppKit holds the node's value, and the walk's announcements equal the replica's`, async () => {
    if (process.platform !== 'darwin') blocked(`the live tree is read through AppKit, on macOS; this is ${process.platform}`);
    const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => JsonObject; references: { model: string }[] };
    const model = String(bench.fingerprint()['model'] ?? 'unknown');
    if (!bench.references.some((m) => m.model === model)) blocked(`this Mac is ${model}, none of the reference Macs (${bench.references.map((m) => m.model).join(', ')})`);
    const client = appkit(temp());

    // The replica.
    const { s, seen } = walkCalls();
    const r = runShow(binOf(), scenario(temp(), [D], s.calls), 'AC8 the replica\'s walk over the scatter');
    presented(r[0]!, 'the fixture scatter');
    const replica = seenOf(r[seen]!, 'the replica\'s see');
    const value = nodeOf(replica, SCATTER)?.['value'];
    const f: string[] = [];
    if (typeof value !== 'string' || value.trim() === '') f.push(`the replica's node ${SCATTER} carries no value: ${show(nodeOf(replica, SCATTER), 400)}`);
    const said = replica.announcements.map((a) => a.text);
    if (!replica.announcements.some((a) => a.id.startsWith(`${SCATTER}#`))) f.push(`the replica announces no landing on the scatter's rows: ${show(replica.announcements, 600)}`);
    none(f, 'the replica');

    // The live window, read through AppKit.
    const live = spawn(binOf(), ['live'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      live.stdin.end(`${JSON.stringify(scenario(temp(), [D], s.calls.slice(0, seen)))}\n`);
      let out = '';
      let err = '';
      live.stderr.on('data', (d: Buffer) => { err += d.toString(); });
      const line = await new Promise<string>((done) => {
        live.stdout.on('data', (d: Buffer) => { out += d.toString(); if (out.includes('\n')) done(out.split('\n')[0]!); });
        live.on('exit', () => done(out));
        setTimeout(() => done(out), TIMEOUT / 3);
      });
      let reply: JsonObject = {};
      try { reply = JSON.parse(line) as JsonObject; } catch { /* below */ }
      if (reply['code'] === 'unsupported_platform') blocked(`deep-show live answers unsupported_platform: ${line.slice(0, 300)}`);
      if (reply['ok'] !== true) none([`deep-show live didn't open its window: ${line.slice(0, 600)} ${err.slice(-600)}`], 'the live window');
      const frames = Array.isArray(reply['shown']) ? reply['shown'].length : 1;
      const seconds = Math.min(240, Math.max(30, frames * HOLD_S + 15));
      const watch = spawnSync(client, ['watch', String(live.pid), String(seconds)], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: (seconds + 120) * 1000 });
      let w: Watched | null = null;
      try { w = JSON.parse(watch.stdout) as Watched; } catch { /* below */ }
      if (!w) blocked(`the AppKit client read nothing of deep-show live's window: ${watch.stderr.slice(-600)}`);
      if (!w!.window) blocked('AppKit lists no window of deep-show live within 30 s');
      const elements = flat(w!.start);
      if (!elements.some((n) => n.identifier)) {
        blocked(`AppKit reads deep-show live's window with no element that carries an identifier (its roles: ${show([...new Set(elements.map((n) => n.role))], 300)}): the live tree can't be read here`);
      }
      const node = elements.find((n) => n.identifier === SCATTER);
      if (!node) f.push(`the live tree read through AppKit has no element whose identifier is ${SCATTER}: ${show(elements.filter((n) => n.identifier).map((n) => n.identifier), 600)}`);
      else if (![node.value, node.description, node.title].some((t) => typeof t === 'string' && typeof value === 'string' && sameText(t, value))) {
        f.push(`the live tree's element ${SCATTER} holds value ${JSON.stringify(node.value)}, description ${JSON.stringify(node.description)}, title ${JSON.stringify(node.title)}: not the replica's value ${JSON.stringify(value)}`);
      }
      const heard = w!.announcements.map((a) => a.text);
      if (show(heard.map((t) => t.replace(/\s+/g, ' ').trim())) !== show(said.map((t) => t.replace(/\s+/g, ' ').trim()))) {
        f.push(`the live window's announcements through AppKit are ${show(heard, 1200)}; the replica's are ${show(said, 1200)}`);
      }
    } finally {
      if (live.pid && live.exitCode === null) { try { process.kill(live.pid, 'SIGKILL'); } catch { /* gone */ } }
    }
    none(f, 'the live tree against the replica');
  }, TIMEOUT);
});
